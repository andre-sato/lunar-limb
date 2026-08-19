/**
 * Coleta (§3, §12, §14, §15, §17).
 *
 * A única parte da camada de observabilidade que toca disco e chama as outras.
 * Tudo o que decide número, status e prioridade é puro e vive em `dimensions.ts`,
 * `staleness.ts`, `budget.ts`, `snapshots.ts` e `gaps.ts`.
 *
 * O §3 e os critérios de aceite são explícitos: **nenhuma medição é refeita
 * aqui**. A cobertura vem do Digital Twin, a integridade de contrato vem do
 * Contract Testing, a confiança vem do Trust, os defeitos vêm da Documentation
 * Test Suite. Este arquivo junta e nada mais — e quando uma dessas camadas falha,
 * a dimensão correspondente sai **não medida**, nunca zero, porque zero diria
 * "está ruim" quando o que houve foi "não deu para olhar".
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { lintDocument, summarizeWorkspace } from '../linter/lint';
import { loadConfig } from '../linter/config';
import { getGlossaryIndex } from '../glossary/loader';
import { setGlossaryIndex } from '../linter/rules/glossary';
import { CONTENT_ROOTS } from '../editor/content-fs';
import { getTrustIndex } from '../trust/load';
import { runDocumentationTests } from '../doctest/runner';
import { digitalTwin } from '../twin/service';
import { getTwin } from '../twin/load';
import { runContractTests } from '../contract/engine';
import { aggregateFeedback, listFeedback, MIN_VOTES_FOR_ATTENTION } from '../feedback/store';
import { loadHealthConfig } from './config';
import { summarizeAnalytics } from './analytics';
import { summarizeAudiences } from '../adaptive/analytics';
import { computeDimensions, evaluateSlo, overallHealth, worstSloStatus, type HealthInputs } from './dimensions';
import { detectGaps, type GapInputs } from './gaps';
import { assessStaleness, summarizeFreshness, type StalenessVerdict } from './staleness';
import { computePageHealth, evaluateBudgets, type PageHealth } from './budget';
import { correlateChanges, detectRegression, listSnapshots, saveSnapshot, snapshotNearest, type HealthRegression, type HealthSnapshot } from './snapshots';
import type { HealthReport, LintFindingLike, ReliabilityCounters } from './types';
import type { LintResult } from '../linter/types';

const run = promisify(execFile);

/**
 * Regras do linter que são de acessibilidade de fato.
 *
 * A lista é explícita em vez de derivada de categoria porque o linter não tem
 * categoria de acessibilidade — e inventar uma para este painel mudaria a nota
 * editorial de todo o portal.
 */
const ACCESSIBILITY_RULES = new Set(['IMAGE-001', 'IMAGE-002', 'LINK-001', 'STRUCTURE-001']);

async function walk(dir: string, base = ''): Promise<string[]> {
	const found: string[] = [];
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return found;
	}
	for (const entry of entries) {
		const relative = base ? `${base}/${entry.name}` : entry.name;
		if (entry.isDirectory()) found.push(...(await walk(path.join(dir, entry.name), relative)));
		else if (/\.mdx?$/.test(entry.name)) found.push(relative);
	}
	return found;
}

function accessibilityRatio(results: readonly LintResult[]): number | undefined {
	if (results.length === 0) return undefined;
	const clean = results.filter(
		(result) => !result.findings.some((finding: LintFindingLike) => ACCESSIBILITY_RULES.has(finding.ruleId))
	).length;
	return clean / results.length;
}

function consistencyAverage(results: readonly LintResult[]): number | undefined {
	if (results.length === 0) return undefined;
	return results.reduce((sum, result) => sum + result.categories.consistency, 0) / results.length;
}

// ---------------------------------------------------------------------------
// Git: idade das páginas e commits recentes
// ---------------------------------------------------------------------------

/**
 * Dias desde a última alteração de cada página, segundo o Git.
 *
 * Uma chamada só para o repositório inteiro: perguntar arquivo por arquivo num
 * portal com centenas de páginas leva minutos, e o painel deixa de ser aberto.
 */
export async function pageAges(): Promise<Map<string, number>> {
	const ages = new Map<string, number>();

	try {
		const { stdout } = await run(
			'git',
			['log', '--name-only', '--format=%ct', '--', 'src/content/docs'],
			{ cwd: process.cwd(), maxBuffer: 64 * 1024 * 1024 }
		);

		const now = Date.now();
		let timestamp: number | undefined;

		for (const line of stdout.split(/\r?\n/)) {
			const trimmed = line.trim();
			if (trimmed === '') continue;

			if (/^\d{9,}$/.test(trimmed)) {
				timestamp = Number.parseInt(trimmed, 10) * 1000;
				continue;
			}

			if (!timestamp || !trimmed.startsWith('src/content/docs/')) continue;

			const relative = trimmed.slice('src/content/docs/'.length);
			// O primeiro commit em que o arquivo aparece é o mais recente: `git log`
			// sai do mais novo para o mais velho.
			if (!ages.has(relative)) ages.set(relative, Math.floor((now - timestamp) / 86_400_000));
		}
	} catch {
		// Sem Git não há idade, e a dimensão de frescor dirá isso.
	}

	return ages;
}

async function recentCommits(limit = 30): Promise<Array<{ commit: string; subject: string; files: string[] }>> {
	try {
		const { stdout } = await run('git', ['log', `-${limit}`, '--name-only', '--format=%H%x1f%s'], {
			cwd: process.cwd(),
			maxBuffer: 32 * 1024 * 1024,
		});

		const commits: Array<{ commit: string; subject: string; files: string[] }> = [];
		let current: { commit: string; subject: string; files: string[] } | null = null;

		for (const line of stdout.split(/\r?\n/)) {
			if (line.includes('\x1f')) {
				const [commit, subject] = line.split('\x1f');
				current = { commit, subject, files: [] };
				commits.push(current);
				continue;
			}
			if (current && line.trim() !== '') current.files.push(line.trim());
		}

		return commits;
	} catch {
		return [];
	}
}

/** Quantas vezes as especificações mudaram desde uma data. */
async function specChangesSince(sinceDays: number): Promise<number> {
	try {
		const { stdout } = await run('git', ['log', `--since=${sinceDays}.days`, '--format=%H', '--', 'src/schemas'], {
			cwd: process.cwd(),
		});
		return stdout.split(/\r?\n/).filter((line) => line.trim() !== '').length;
	} catch {
		return 0;
	}
}

// ---------------------------------------------------------------------------
// Relatório
// ---------------------------------------------------------------------------

export interface HealthOptions {
	testProfile?: 'quick' | 'standard';
	/** Grava um snapshot ao final (§12). */
	snapshot?: boolean;
}

export interface ObservabilityReport extends HealthReport {
	reliability: ReliabilityCounters;
	budgets: ReturnType<typeof evaluateBudgets>;
	freshness: ReturnType<typeof summarizeFreshness>;
	staleness: StalenessVerdict[];
	pages: PageHealth[];
	regression: HealthRegression | null;
	changeCandidates: ReturnType<typeof correlateChanges>;
	history: HealthSnapshot[];
	analytics: Awaited<ReturnType<typeof summarizeAnalytics>>;
	audiences: Awaited<ReturnType<typeof summarizeAudiences>>;
	minimumHealthScore: number;
}

export async function collectHealth(options: HealthOptions = {}): Promise<ObservabilityReport> {
	const config = await loadHealthConfig();

	// --- linter -----------------------------------------------------------
	const lintConfig = await loadConfig('default');
	setGlossaryIndex(await getGlossaryIndex());

	const files = await walk(CONTENT_ROOTS.docs);
	const results: LintResult[] = [];

	for (const relative of files) {
		const raw = await readFile(path.resolve(CONTENT_ROOTS.docs, relative), 'utf-8');
		results.push(await lintDocument(raw, { path: relative, config: lintConfig }));
	}

	const lintSummary = summarizeWorkspace(results);

	// --- as outras camadas, em paralelo -----------------------------------
	const [trust, tests, coverage, contractReport, twin, feedbackEntries, analytics, audiences, ages, commits, snapshots] =
		await Promise.all([
			getTrustIndex({ fresh: true }).catch(() => null),
			runDocumentationTests({ profile: options.testProfile ?? 'standard' }).catch(() => null),
			// Cobertura vem do Digital Twin. Esta camada tinha o próprio cálculo, e
			// mantê-lo seria a duplicação que o §23 proíbe.
			digitalTwin.getCoverage().catch(() => null),
			runContractTests().catch(() => null),
			getTwin().catch(() => null),
			listFeedback().catch(() => []),
			summarizeAnalytics(config.storeQuestions),
			summarizeAudiences().catch(() => ({ total: 0, distribution: [] })),
			pageAges(),
			recentCommits(),
			listSnapshots(),
		]);

	const feedback = aggregateFeedback(feedbackEntries);
	const negativeByPage = new Map(feedback.needsAttention.map((page) => [page.path, page.down]));

	const brokenByPage = new Map<string, number>();
	const validByPage = new Map<string, number>();
	for (const contract of contractReport?.contracts ?? []) {
		for (const reference of contract.documentation) {
			if (contract.status === 'invalid') brokenByPage.set(reference.path, (brokenByPage.get(reference.path) ?? 0) + 1);
			else if (contract.status === 'valid') validByPage.set(reference.path, (validByPage.get(reference.path) ?? 0) + 1);
		}
	}

	const failuresByPage = new Map<string, number>();
	for (const result of tests?.results ?? []) {
		if (result.status !== 'fail' || !result.location?.path) continue;
		failuresByPage.set(result.location.path, (failuresByPage.get(result.location.path) ?? 0) + 1);
	}

	// --- frescor (§6.4, §7) -------------------------------------------------
	// Quantas vezes a API mudou recentemente: usado para cruzar com a idade da
	// página, porque idade sozinha não determina obsolescência.
	const specChanges = await specChangesSince(90);

	const documentsEndpoints = new Map<string, number>();
	for (const edge of twin?.graph.edges ?? []) {
		if (edge.relation !== 'documents') continue;
		const page = edge.from.replace(/^page:/, '');
		documentsEndpoints.set(page, (documentsEndpoints.get(page) ?? 0) + 1);
	}

	const staleness: StalenessVerdict[] = files.map((relative) => {
		const withoutExtension = relative.replace(/\.mdx?$/, '');
		const ageDays = ages.get(relative);
		const documents = documentsEndpoints.get(withoutExtension) ?? 0;

		return assessStaleness({
			path: relative,
			ageDays,
			// Só conta como mudança de produto quando a página **documenta** algum
			// endpoint: uma especificação alterada não envelhece um guia conceitual.
			productChangesSinceEdit: documents > 0 && ageDays !== undefined && ageDays > 30 ? specChanges : 0,
			brokenContracts: brokenByPage.get(relative) ?? 0,
			trust: trust?.byPath.get(relative)?.status,
			negativeVotes: negativeByPage.get(relative) ?? 0,
		});
	});

	const freshness = summarizeFreshness(staleness);

	// --- dimensões ----------------------------------------------------------
	const coveredPages = new Set(
		(tests?.results ?? [])
			.filter((result) => result.status !== 'skip' && result.location?.path)
			.map((result) => result.location!.path)
	);

	const brokenLinks = (tests?.results ?? []).filter(
		(result) => result.status === 'fail' && result.category === 'link'
	).length;

	const failedExamples = (tests?.results ?? []).filter(
		(result) => result.status === 'fail' && (result.category === 'api' || result.category === 'snippet')
	).length;

	const inputs: HealthInputs = {
		lint: {
			averageScore: lintSummary.averageScore,
			analyzed: lintSummary.analyzed,
			consistencyAverage: consistencyAverage(results),
			accessibilityRatio: accessibilityRatio(results),
		},
		trust: trust
			? {
					documented: trust.summary.documented,
					verified: trust.summary.verified,
					stale: trust.summary.stale,
					invalid: trust.summary.invalid,
					averageScore: trust.summary.averageScore,
					pages: trust.summary.pages,
				}
			: undefined,
		tests: tests
			? {
					total: tests.summary.total,
					passed: tests.summary.passed,
					failed: tests.summary.failed,
					pagesCovered: coveredPages.size,
					pages: files.length,
					brokenLinks,
				}
			: undefined,
		coverage: coverage
			? {
					endpoints: coverage.endpoints.percentage,
					schemas: coverage.schemas.percentage,
					examples: coverage.examples.percentage,
					features: coverage.features.percentage,
				}
			: undefined,
		contracts: contractReport?.counts,
		freshness: { score: freshness.score, measured: files.length - freshness.unknown, stale: freshness.stale },
		ai: {
			queries: analytics.counters.queries,
			highConfidence: analytics.counters.highConfidence,
			unanswered: analytics.counters.unanswered,
		},
	};

	const dimensions = computeDimensions(inputs);
	const slo = evaluateSlo(dimensions, config);
	const score = overallHealth(dimensions);

	// --- confiabilidade e orçamento (§8, §9) -------------------------------
	const reliability: ReliabilityCounters = {
		brokenLinks,
		failedTests: tests?.summary.failed ?? 0,
		brokenContracts: contractReport?.counts.invalid ?? 0,
		invalidPages: trust?.summary.invalid ?? 0,
		stalePages: freshness.stale,
	};

	const budgets = evaluateBudgets([
		{ name: 'Links quebrados', allowed: config.budgets.brokenLinks, used: reliability.brokenLinks },
		{ name: 'Contratos quebrados', allowed: config.budgets.contractFailures, used: reliability.brokenContracts },
		{ name: 'Exemplos reprovados', allowed: config.budgets.failedExamples, used: failedExamples },
		{ name: 'Conteúdo obsoleto', allowed: config.budgets.staleContent, used: reliability.stalePages },
	]);

	// --- saúde por página (§17) --------------------------------------------
	const stalenessByPath = new Map(staleness.map((verdict) => [verdict.path, verdict.status]));

	const pages: PageHealth[] = results.map((result) =>
		computePageHealth({
			path: result.path,
			quality: result.score,
			trust: trust?.byPath.get(result.path)?.score.value,
			contracts: {
				valid: validByPage.get(result.path) ?? 0,
				invalid: brokenByPage.get(result.path) ?? 0,
			},
			staleness: stalenessByPath.get(result.path),
			failures: failuresByPage.get(result.path) ?? 0,
			documentsEndpoints: documentsEndpoints.get(result.path.replace(/\.mdx?$/, '')) ?? 0,
		})
	);

	// --- histórico e regressão (§12, §13, §14) -----------------------------
	const previous = snapshotNearest(snapshots, 7);
	const current: HealthSnapshot = {
		at: new Date().toISOString(),
		score,
		dimensions: Object.fromEntries(
			dimensions.filter((dimension) => dimension.measured).map((dimension) => [dimension.dimension, dimension.value])
		),
		reliability: {
			brokenLinks: reliability.brokenLinks,
			failedTests: reliability.failedTests,
			brokenContracts: reliability.brokenContracts,
			invalidPages: reliability.invalidPages,
		},
		commit: commits[0]?.commit,
	};

	const regression = previous ? detectRegression(previous, current) : null;

	const affected = [
		...freshness.worst.map((verdict) => `src/content/docs/${verdict.path}`),
		...[...brokenByPage.keys()].map((page) => `src/content/docs/${page}`),
	];

	// --- lacunas ------------------------------------------------------------
	const gapInputs: GapInputs = {
		unanswered: analytics.topUnanswered.map((entry) => ({ question: entry.question, count: entry.count })),
		undocumentedEndpoints: [],
		negativePages: feedback.needsAttention.map((page) => ({ path: page.path, down: page.down, total: page.total })),
		failingPages: results.filter((result) => result.gate === 'fail').map((result) => ({ path: result.path, score: result.score })),
		untrustedPages: [...(trust?.byPath.values() ?? [])]
			.filter((page) => page.claims.length > 0 && (page.status === 'stale' || page.status === 'invalid'))
			.map((page) => ({ path: page.path, status: page.status as 'stale' | 'invalid' })),
		failingTests: (tests?.results ?? [])
			.filter((result) => result.status === 'fail')
			.map((result) => ({ id: result.id, name: result.name, path: result.location?.path })),
	};

	if (options.snapshot) await saveSnapshot(current);

	const byOwner = new Map<string, { pages: number; sum: number }>();
	for (const page of pages) {
		const owner = trust?.byPath.get(page.path)?.owner ?? 'Sem responsável';
		const entry = byOwner.get(owner) ?? { pages: 0, sum: 0 };
		entry.pages++;
		entry.sum += page.score ?? 0;
		byOwner.set(owner, entry);
	}

	return {
		overall: score,
		dimensions,
		slo,
		sloStatus: worstSloStatus(slo),
		gaps: detectGaps(gapInputs),
		reliability,
		budgets,
		freshness,
		staleness,
		pages: pages.sort((a, b) => (a.score ?? 101) - (b.score ?? 101)),
		regression,
		changeCandidates: regression && regression.delta < 0 ? correlateChanges(commits, affected) : [],
		history: snapshots,
		analytics,
		audiences,
		minimumHealthScore: config.minimumHealthScore,
		totals: {
			pages: files.length,
			endpoints: 0,
			documentedEndpoints: 0,
			tests: tests?.summary.total ?? 0,
			brokenLinks,
			stalePages: freshness.stale,
			unansweredQuestions: analytics.counters.unanswered,
		},
		teams: [...byOwner.entries()]
			.map(([owner, entry]) => ({ owner, pages: entry.pages, health: Math.round(entry.sum / entry.pages) }))
			.sort((a, b) => a.health - b.health),
		generatedAt: Date.now(),
	};
}

export { MIN_VOTES_FOR_ATTENTION };
