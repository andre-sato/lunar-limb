/**
 * Orquestrador do linter (§78).
 *
 * Junta as três camadas sem misturá-las: parseia, roda as regras habilitadas,
 * aplica supressões e entrega os findings ao motor de score.
 */

import { parseDocument, inferLanguage } from './parse';
import { ALL_RULES, computeReadability } from './rules';
import { buildSuppressionIndex, isSuppressed, profileFromFrontmatter, type SuppressionRecord } from './directives';
import { loadConfig, ruleSettings, type ResolvedConfig } from './config';
import { calculateScore, evaluateGate } from './score';
import type {
	LintFinding,
	LintResult,
	LintLanguage,
	ReportInput,
	WorkspaceLintResult,
	CategoryScores,
	Severity,
} from './types';
import { SCORED_CATEGORIES } from './types';

export interface LintOptions {
	/** Caminho relativo, usado para inferir idioma e identificar o documento. */
	path?: string;
	language?: LintLanguage;
	/** Força um profile, ignorando o frontmatter. */
	profile?: string;
	config?: ResolvedConfig;
}

export async function lintDocument(raw: string, options: LintOptions = {}): Promise<LintResult> {
	const parsed = parseDocument(raw, { path: options.path, language: options.language });

	const profile = options.profile ?? profileFromFrontmatter(parsed.frontmatter) ?? 'default';
	const config = options.config ?? (await loadConfig(profile));

	const language = options.language ?? parsed.language;
	const suppressions = buildSuppressionIndex(raw, parsed.frontmatter);

	const findings: LintFinding[] = [];
	const suppressed: SuppressionRecord[] = [];

	if (config.enabled) {
		let counter = 0;

		for (const rule of ALL_RULES) {
			const settings = ruleSettings(config, rule.id, rule.severity, rule.weight);
			if (!settings.enabled) continue;
			if (rule.languages && !rule.languages.includes(language)) continue;
			if (rule.pageTypes && (!parsed.pageType || !rule.pageTypes.includes(parsed.pageType))) continue;

			const report = (input: ReportInput) => {
				const line = input.location.startLine;

				const suppression = isSuppressed(suppressions, input.ruleId, line);
				if (suppression) {
					suppressed.push(suppression);
					return;
				}

				findings.push({
					id: `${rule.id}-${++counter}`,
					ruleId: input.ruleId,
					category: rule.category,
					severity: settings.severity,
					message: input.message,
					explanation: input.explanation,
					suggestion: input.suggestion,
					location: input.location,
					weight: input.weight ?? settings.weight,
					confidence: input.confidence,
					fix: input.fix,
				});
			};

			try {
				rule.run({ document: parsed, config, language, pageType: parsed.pageType, report });
			} catch (error) {
				// Uma regra com defeito não pode derrubar a análise inteira: o
				// autor perderia o resultado das outras vinte por causa dela.
				console.error(`[linter] regra ${rule.id} falhou:`, (error as Error).message);
			}
		}
	}

	findings.sort(
		(a, b) => a.location.startLine - b.location.startLine || a.location.startColumn - b.location.startColumn
	);

	const readability = computeReadability(parsed, language);
	const quality = calculateScore({
		findings,
		config,
		words: parsed.words,
		readingEase: readability.readingEase,
	});

	const gate = evaluateGate(quality.score, quality.counts, config);

	return {
		documentId: options.path ?? 'documento',
		path: options.path ?? '',
		language,
		pageType: parsed.pageType,
		profile: config.profile,
		score: quality.score,
		band: quality.band,
		categories: quality.categories,
		aiReadiness: quality.aiReadiness,
		findings,
		counts: quality.counts,
		suppressed,
		gate,
		passed: gate !== 'fail',
		words: parsed.words,
	};
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

export interface WorkspaceInput {
	path: string;
	content: string;
}

export async function lintWorkspace(
	documents: readonly WorkspaceInput[],
	options: LintOptions = {}
): Promise<WorkspaceLintResult> {
	const results: LintResult[] = [];
	for (const document of documents) {
		results.push(await lintDocument(document.content, { ...options, path: document.path }));
	}

	return summarizeWorkspace(results);
}

export function summarizeWorkspace(results: readonly LintResult[]): WorkspaceLintResult {
	const analyzed = results.length;
	const averageScore =
		analyzed > 0 ? Math.round((results.reduce((sum, r) => sum + r.score, 0) / analyzed) * 10) / 10 : 0;

	const bands: Record<string, number> = {};
	for (const result of results) bands[result.band] = (bands[result.band] ?? 0) + 1;

	const categoryAverages = {} as CategoryScores;
	for (const category of SCORED_CATEGORIES) {
		const total = results.reduce((sum, result) => sum + result.categories[category], 0);
		categoryAverages[category] = analyzed > 0 ? Math.round((total / analyzed) * 10) / 10 : 0;
	}

	// Problemas mais frequentes (§69): é o que transforma o linter em
	// ferramenta de governança em vez de corretor página a página.
	const byRule = new Map<string, { count: number; message: string }>();
	for (const result of results) {
		for (const finding of result.findings) {
			if (finding.severity === 'info') continue;
			const entry = byRule.get(finding.ruleId) ?? { count: 0, message: finding.message };
			entry.count++;
			byRule.set(finding.ruleId, entry);
		}
	}

	const topProblems = [...byRule.entries()]
		.map(([ruleId, entry]) => ({ ruleId, message: entry.message, count: entry.count }))
		.sort((a, b) => b.count - a.count)
		.slice(0, 12);

	const failing = results.filter((result) => !result.passed).length;
	const counts: Record<Severity, number> = { error: 0, warning: 0, suggestion: 0, info: 0 };
	for (const result of results) {
		for (const severity of Object.keys(counts) as Severity[]) counts[severity] += result.counts[severity];
	}

	return {
		pages: results.map((result) => ({
			path: result.path,
			score: result.score,
			band: result.band,
			gate: result.gate,
			counts: result.counts,
			passed: result.passed,
		})),
		averageScore,
		analyzed,
		passing: analyzed - failing,
		failing,
		bands,
		categoryAverages,
		topProblems,
		gate: failing > 0 ? 'fail' : counts.warning > 0 ? 'warning' : 'pass',
	};
}

export { inferLanguage };
