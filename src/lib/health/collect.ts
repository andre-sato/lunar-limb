/**
 * Coleta (§2, §3, §6, §11, §12).
 *
 * A única parte da camada de saúde que toca disco e chama as outras camadas.
 * Tudo o que decide número, status e prioridade é puro e vive em `dimensions.ts`
 * e `gaps.ts`.
 *
 * Nenhuma medição nova acontece aqui: o linter, a suíte de testes, o Trust e as
 * especificações de API já sabem o que sabem. Se uma dessas camadas falhar, a
 * dimensão correspondente sai **não medida** — e não como zero, porque zero
 * significaria "está ruim" quando o que houve foi "não deu para olhar".
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { lintDocument, summarizeWorkspace } from '../linter/lint';
import { loadConfig } from '../linter/config';
import { getGlossaryIndex } from '../glossary/loader';
import { setGlossaryIndex } from '../linter/rules/glossary';
import { CONTENT_ROOTS } from '../editor/content-fs';
import { getTrustIndex } from '../trust/load';
import { runDocumentationTests } from '../doctest/runner';
import { parseOpenApi } from '../api-explorer/model';
import { aggregateFeedback, listFeedback, MIN_VOTES_FOR_ATTENTION } from '../feedback/store';
import { loadHealthConfig } from './config';
import { summarizeAnalytics } from './analytics';
import { summarizeAudiences } from '../adaptive/analytics';
import { computeDimensions, evaluateSlo, overallHealth, worstSloStatus, type HealthInputs } from './dimensions';
import { detectGaps, type GapInputs } from './gaps';
import type { HealthReport, LintFindingLike } from './types';
import type { LintResult } from '../linter/types';

const SCHEMAS_ROOT = path.resolve(process.cwd(), 'src/schemas');

/**
 * Regras do linter que são de acessibilidade de fato.
 *
 * A lista é explícita em vez de derivada de categoria porque o linter não tem
 * categoria de acessibilidade — e inventar uma para este painel mudaria a nota
 * editorial de todo o portal. Cada uma destas tem consequência para quem usa
 * leitor de tela ou navega por teclado:
 *
 *   IMAGE-001     imagem sem texto alternativo
 *   IMAGE-002     texto alternativo genérico ou igual ao nome do arquivo
 *   LINK-001      texto de link sem valor descritivo ("clique aqui")
 *   STRUCTURE-001 hierarquia de títulos que pula nível
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

/** Endpoints declarados e quais deles alguma página documenta. */
async function apiCoverage(pageBodies: ReadonlyMap<string, string>): Promise<{
	endpoints: number;
	documented: number;
	undocumented: string[];
}> {
	let files: string[];
	try {
		files = (await readdir(SCHEMAS_ROOT)).filter((file) => /\.(ya?ml|json)$/i.test(file));
	} catch {
		return { endpoints: 0, documented: 0, undocumented: [] };
	}

	const endpoints: Array<{ key: string; operationId: string; schema: string; apiPath: string }> = [];

	for (const file of files) {
		const raw = await readFile(path.join(SCHEMAS_ROOT, file), 'utf-8');
		if (!/^\s*["']?(openapi|swagger)["']?\s*:/m.test(raw)) continue;
		try {
			const model = parseOpenApi(raw);
			for (const operation of model.operations) {
				endpoints.push({
					key: `${operation.method.toUpperCase()} ${operation.path}`,
					operationId: operation.id,
					schema: file,
					apiPath: operation.path,
				});
			}
		} catch {
			// Especificação inválida: os testes de documentação já reclamam dela.
		}
	}

	const undocumented: string[] = [];

	for (const endpoint of endpoints) {
		// Duas evidências de que a página documenta o endpoint, na mesma ordem de
		// confiança usada pelo Impact Engine: a declaração explícita do `<TryIt/>`
		// primeiro, o caminho literal no texto depois.
		const declared = new RegExp(
			`<TryIt\\b[^>]*schema=["'][^"']*${endpoint.schema.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}["'][^>]*operation=["']${endpoint.operationId}["']`
		);

		const covered = [...pageBodies.values()].some(
			(body) => declared.test(body) || body.includes(endpoint.apiPath)
		);

		if (!covered) undocumented.push(endpoint.key);
	}

	return { endpoints: endpoints.length, documented: endpoints.length - undocumented.length, undocumented };
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

export interface HealthOptions {
	/** Perfil da suíte de testes. `standard` é o que dá para rodar sem rede. */
	testProfile?: 'quick' | 'standard';
}

export async function collectHealth(options: HealthOptions = {}): Promise<
	HealthReport & {
		analytics: Awaited<ReturnType<typeof summarizeAnalytics>>;
		audiences: Awaited<ReturnType<typeof summarizeAudiences>>;
		backlogSource: ReturnType<typeof detectGaps>;
	}
> {
	const config = await loadHealthConfig();

	// --- linter -----------------------------------------------------------
	const lintConfig = await loadConfig('default');
	setGlossaryIndex(await getGlossaryIndex());

	const files = await walk(CONTENT_ROOTS.docs);
	const bodies = new Map<string, string>();
	const results: LintResult[] = [];

	for (const relative of files) {
		const raw = await readFile(path.resolve(CONTENT_ROOTS.docs, relative), 'utf-8');
		bodies.set(relative, raw);
		results.push(await lintDocument(raw, { path: relative, config: lintConfig }));
	}

	const lintSummary = summarizeWorkspace(results);

	// --- as outras camadas, em paralelo -----------------------------------
	const [trust, tests, api, feedbackEntries, analytics, audiences] = await Promise.all([
		getTrustIndex({ fresh: true }).catch(() => null),
		runDocumentationTests({ profile: options.testProfile ?? 'standard' }).catch(() => null),
		apiCoverage(bodies),
		listFeedback().catch(() => []),
		summarizeAnalytics(config.storeQuestions),
		// Distribuição por audiência (§13 de Adaptive Documentation, última linha:
		// "isso poderá alimentar o Documentation Health Center").
		summarizeAudiences().catch(() => ({ total: 0, distribution: [] })),
	]);

	const feedback = aggregateFeedback(feedbackEntries);

	// Páginas com ao menos um teste que não foi pulado: pulado não conta como
	// cobertura, pela mesma razão que não conta como aprovado.
	const coveredPages = new Set(
		(tests?.results ?? [])
			.filter((result) => result.status !== 'skip' && result.location?.path)
			.map((result) => result.location!.path)
	);

	const brokenLinks = (tests?.results ?? []).filter(
		(result) => result.status === 'fail' && result.category === 'link'
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
		api: { endpoints: api.endpoints, documented: api.documented },
	};

	const dimensions = computeDimensions(inputs);
	const slo = evaluateSlo(dimensions, config);

	// --- lacunas ----------------------------------------------------------
	const gapInputs: GapInputs = {
		unanswered: analytics.topUnanswered.map((entry) => ({ question: entry.question, count: entry.count })),
		undocumentedEndpoints: api.undocumented,
		negativePages: feedback.needsAttention.map((page) => ({
			path: page.path,
			down: page.down,
			total: page.total,
		})),
		failingPages: results
			.filter((result) => result.gate === 'fail')
			.map((result) => ({ path: result.path, score: result.score })),
		untrustedPages: [...(trust?.byPath.values() ?? [])]
			.filter((page) => page.claims.length > 0 && (page.status === 'stale' || page.status === 'invalid'))
			.map((page) => ({ path: page.path, status: page.status as 'stale' | 'invalid' })),
		failingTests: (tests?.results ?? [])
			.filter((result) => result.status === 'fail')
			.map((result) => ({ id: result.id, name: result.name, path: result.location?.path })),
	};

	const gaps = detectGaps(gapInputs);

	// --- visão por responsável (§12) --------------------------------------
	const byOwner = new Map<string, { pages: number; sum: number }>();
	for (const result of results) {
		const owner = trust?.byPath.get(result.path)?.owner ?? 'Sem responsável';
		const entry = byOwner.get(owner) ?? { pages: 0, sum: 0 };
		entry.pages++;
		entry.sum += result.score * 10;
		byOwner.set(owner, entry);
	}

	return {
		overall: overallHealth(dimensions),
		dimensions,
		slo,
		sloStatus: worstSloStatus(slo),
		gaps,
		backlogSource: gaps,
		analytics,
		audiences,
		totals: {
			pages: files.length,
			endpoints: api.endpoints,
			documentedEndpoints: api.documented,
			tests: tests?.summary.total ?? 0,
			brokenLinks,
			stalePages: trust?.summary.stale ?? 0,
			unansweredQuestions: analytics.counters.unanswered,
		},
		teams: [...byOwner.entries()]
			.map(([owner, entry]) => ({ owner, pages: entry.pages, health: Math.round(entry.sum / entry.pages) }))
			.sort((a, b) => a.health - b.health),
		generatedAt: Date.now(),
	};
}

export { MIN_VOTES_FOR_ATTENTION };
