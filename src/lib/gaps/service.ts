/**
 * `DocumentationGapService` (§29) e o ciclo de vida (§20, §21, §22).
 *
 * A parte que toca disco: reúne os sinais, chama a busca para saber o que já
 * existe sobre cada assunto, consulta o Digital Twin e os contratos, e guarda o
 * estado dos gaps.
 *
 * O estado é a única coisa **persistida** aqui, e ele é pequeno de propósito:
 * status, quem reconheceu, e o sinal registrado no momento em que o trabalho
 * começou. Tudo o mais é recalculado a cada análise, porque tudo o mais é
 * derivado — e um gap congelado em arquivo seria mais uma verdade paralela.
 */

import { readJson, withFileLock, writeJson } from '../auth/store';
import { retrieveDocumentation } from '../chat/retrieval';
import { loadHealthConfig } from '../health/config';
import { aggregateFeedback, listFeedback } from '../feedback/store';
import { getTrustIndex } from '../trust/load';
import { getTwin } from '../twin/load';
import { findUndocumented } from '../twin/analysis';
import { runContractTests } from '../contract/engine';
import { documentationImpact } from '../codeloop/service';
import { clusterQueries, tokenize, type QueryCluster } from './cluster';
import { analyzeGaps, checkResolution, type ClusterAnalysis, type RetrievedPage } from './analyze';
import { readTelemetry } from './telemetry';
import type { DocumentationGap, GapFilters, GapReport, GapStatus } from './types';

const STATE_FILE = 'gap-state.json';

interface GapState {
	id: string;
	status: GapStatus;
	actorId?: string;
	updatedAt: string;
	baseline?: { searches: number; aiFailures: number; at: string };
}

interface StateFile {
	gaps: GapState[];
}

async function readState(): Promise<Map<string, GapState>> {
	const file = await readJson<StateFile>(STATE_FILE, { gaps: [] });
	return new Map((file.gaps ?? []).map((gap) => [gap.id, gap]));
}

async function writeState(id: string, patch: Partial<GapState>): Promise<void> {
	await withFileLock(STATE_FILE, async () => {
		const file = await readJson<StateFile>(STATE_FILE, { gaps: [] });
		const gaps = Array.isArray(file.gaps) ? file.gaps : [];

		const index = gaps.findIndex((gap) => gap.id === id);
		const next: GapState = {
			id,
			status: patch.status ?? gaps[index]?.status ?? 'new',
			actorId: patch.actorId ?? gaps[index]?.actorId,
			baseline: patch.baseline ?? gaps[index]?.baseline,
			updatedAt: new Date().toISOString(),
		};

		if (index >= 0) gaps[index] = next;
		else gaps.push(next);

		await writeJson(STATE_FILE, { gaps });
	});
}

// ---------------------------------------------------------------------------
// Análise
// ---------------------------------------------------------------------------

/**
 * Contradições entre páginas (§5.6).
 *
 * Deliberadamente estreita: procura afirmações numéricas sobre o mesmo assunto em
 * páginas diferentes — "tentativas: 3" numa, "tentativas: 5" noutra. Detectar
 * contradição semântica em geral exigiria um modelo e erraria muito; números
 * discordando sobre o mesmo termo são verificáveis, e é o caso que a spec ilustra.
 */
export function findContradictions(
	pages: ReadonlyArray<{ path: string; content: string }>,
	tokens: readonly string[]
): { pages: string[]; detail: string } | undefined {
	const claims = new Map<string, Array<{ path: string; value: string }>>();

	for (const page of pages) {
		for (const match of page.content.matchAll(/\b([A-Za-zÀ-ÿ]{4,})\s*(?:é|de|:|=)\s*(\d{1,4})\b/g)) {
			const subject = match[1]
				.toLowerCase()
				.normalize('NFD')
				.replace(/[̀-ͯ]/g, '');
			if (!tokens.some((token) => subject.startsWith(token.slice(0, 4)))) continue;

			const list = claims.get(subject) ?? [];
			list.push({ path: page.path, value: match[2] });
			claims.set(subject, list);
		}
	}

	for (const [subject, entries] of claims) {
		const values = new Set(entries.map((entry) => entry.value));
		if (values.size < 2) continue;

		const involved = [...new Set(entries.map((entry) => entry.path))];
		if (involved.length < 2) continue;

		return {
			pages: involved,
			detail: `As páginas discordam sobre \`${subject}\`: ${[...values].join(' e ')}.`,
		};
	}

	return undefined;
}

export interface AnalyzeOptions {
	/** Limite de agrupamentos analisados. */
	limit?: number;
}

export async function analyzeDocumentationGaps(options: AnalyzeOptions = {}): Promise<GapReport> {
	const [telemetry, config, state] = await Promise.all([readTelemetry(), loadHealthConfig(), readState()]);

	const [twin, trust, feedbackEntries, contracts] = await Promise.all([
		getTwin({ fresh: true }).catch(() => null),
		getTrustIndex().catch(() => null),
		listFeedback().catch(() => []),
		runContractTests().catch(() => null),
	]);

	const feedback = aggregateFeedback(feedbackEntries);
	const negativeByPage = new Map(feedback.needsAttention.map((page) => [page.path, page.down]));

	const brokenByPage = new Map<string, number>();
	for (const contract of contracts?.contracts ?? []) {
		if (contract.status !== 'invalid') continue;
		for (const reference of contract.documentation) {
			brokenByPage.set(reference.path, (brokenByPage.get(reference.path) ?? 0) + 1);
		}
	}

	// --- agrupamento -------------------------------------------------------
	const clusters = clusterQueries(
		telemetry.signals.map((signal) => ({ question: signal.question, count: signal.count }))
	).slice(0, options.limit ?? 50);

	const failuresByQuestion = new Map(telemetry.signals.map((signal) => [signal.question, signal.failures]));
	const originByQuestion = new Map(telemetry.signals.map((signal) => [signal.question, signal.origin]));

	const analyses: ClusterAnalysis[] = [];

	for (const cluster of clusters) {
		const found = await retrieveDocumentation(cluster.representative, { threshold: 0.1, maxChunks: 5 }).catch(() => []);

		const pages: RetrievedPage[] = [];
		const seen = new Set<string>();

		for (const chunk of found) {
			if (seen.has(chunk.path)) continue;
			seen.add(chunk.path);

			pages.push({
				path: chunk.path,
				title: chunk.title,
				relevance: chunk.score,
				termCoverage: termCoverageOf(cluster.terms, chunk.content),
				trust: trust?.byPath.get(chunk.path)?.status,
				negativeVotes: negativeByPage.get(chunk.path) ?? 0,
				brokenContracts: brokenByPage.get(chunk.path) ?? 0,
			});
		}

		const aiQuestions = cluster.variants.reduce(
			(sum, variant) => sum + (originByQuestion.get(variant) === 'assistant' ? 1 : 0),
			0
		);
		const mcpQueries = cluster.variants.reduce(
			(sum, variant) => sum + (originByQuestion.get(variant) === 'mcp' ? 1 : 0),
			0
		);
		const aiFailures = cluster.variants.reduce((sum, variant) => sum + (failuresByQuestion.get(variant) ?? 0), 0);

		analyses.push({
			cluster,
			pages,
			aiQuestions,
			mcpQueries,
			aiFailures,
			productNodes: relatedProductNodes(twin, cluster),
			contradiction: findContradictions(
				found.map((chunk) => ({ path: chunk.path, content: chunk.content })),
				cluster.tokens
			),
		});
	}

	// --- sinais que não dependem de texto ---------------------------------
	// Endpoint sem página é lacuna mesmo quando ninguém perguntou nada: o contrato
	// está publicado, e alguém vai chamá-lo. É o que mantém a camada útil com o
	// registro de perguntas desligado.
	if (twin) {
		const unmentioned = new Set<string>();

		for (const item of findUndocumented(twin.graph)) {
			unmentioned.add(item.node.name);
			analyses.push({
				cluster: {
					representative: `como usar ${item.node.name}`,
					variants: [],
					tokens: tokenize(item.node.name),
					terms: tokenize(item.node.name),
					count: 0,
				},
				pages: [],
				productNodes: [item.node.id],
			});
		}

		// Documentation-to-Code Loop (P2.2): entidade **mencionada** em alguma
		// página, mas sem vínculo declarado.
		//
		// É um sinal mais fraco que o de cima — o assunto existe no portal — e por
		// isso entra separado: quem lê a lista precisa distinguir "ninguém escreveu"
		// de "escreveram e ninguém assumiu a página como a referência". Tratar os
		// dois como o mesmo item mandaria a equipe reescrever conteúdo que já existe.
		const unbound = await documentationImpact.findUndocumented().catch(() => []);

		for (const entity of unbound) {
			if (unmentioned.has(entity.entityId)) continue;

			analyses.push({
				cluster: {
					representative: `qual página documenta ${entity.entityId}`,
					variants: [],
					tokens: tokenize(entity.entityId),
					terms: tokenize(entity.entityId),
					count: 0,
				},
				pages: [],
				productNodes: [],
			});
		}
	}

	const gaps = analyzeGaps({ analyses }).map((gap) => {
		const saved = state.get(gap.id);
		return saved ? { ...gap, status: saved.status, baseline: saved.baseline, updatedAt: saved.updatedAt } : gap;
	});

	const counts = { P0: 0, P1: 0, P2: 0, P3: 0 };
	for (const gap of gaps) counts[gap.priority]++;

	return {
		gaps,
		counts,
		limited: telemetry.limited || !config.storeQuestions,
		generatedAt: Date.now(),
	};
}

/**
 * Fração dos termos distintivos da pergunta que aparecem no trecho.
 *
 * Compara radicais, pelo mesmo motivo que o agrupamento compara: "rotacionar" e
 * "rotação" são a mesma ideia, e exigir a forma exata devolveria zero para
 * conteúdo que fala do assunto.
 */
export function termCoverageOf(tokens: readonly string[], content: string): number {
	if (tokens.length === 0) return 0;

	const haystack = new Set(tokenize(content));

	// A palavra da página precisa **começar** com o termo da pergunta, e não o
	// contrário. A regra frouxa dava um falso positivo caro neste portal: `rota`
	// (de rota HTTP, que aparece em todo lugar) casava com `rotacion`, e "como
	// rotacionar a chave" saía como assunto totalmente coberto.
	const present = tokens.filter((token) => [...haystack].some((word) => word.startsWith(token)));

	return present.length / tokens.length;
}

/** Nós do produto que o assunto toca (§24). */
function relatedProductNodes(twin: Awaited<ReturnType<typeof getTwin>> | null, cluster: QueryCluster): string[] {
	if (!twin) return [];

	return twin.graph.nodes
		.filter((node) => node.type === 'endpoint' || node.type === 'code')
		.filter((node) => {
			const name = node.name
				.toLowerCase()
				.normalize('NFD')
				.replace(/[̀-ͯ]/g, '');
			return cluster.terms.some((token) => token.length > 3 && name.includes(token));
		})
		.slice(0, 5)
		.map((node) => node.id);
}

// ---------------------------------------------------------------------------
// Serviço (§29)
// ---------------------------------------------------------------------------

export interface DocumentationGapService {
	analyze(): Promise<DocumentationGap[]>;
	list(filters?: GapFilters): Promise<DocumentationGap[]>;
	get(id: string): Promise<DocumentationGap | undefined>;
	acknowledge(id: string, actorId: string): Promise<void>;
	start(id: string, actorId: string): Promise<void>;
	resolve(id: string, actorId: string): Promise<{ resolved: boolean; reason: string }>;
	dismiss(id: string, actorId: string): Promise<void>;
}

export const documentationGaps: DocumentationGapService = {
	async analyze() {
		return (await analyzeDocumentationGaps()).gaps;
	},

	async list(filters) {
		const { gaps } = await analyzeDocumentationGaps();
		return gaps.filter(
			(gap) =>
				(!filters?.status || gap.status === filters.status) &&
				(!filters?.priority || gap.priority === filters.priority) &&
				(!filters?.category || gap.category === filters.category)
		);
	},

	async get(id) {
		return (await analyzeDocumentationGaps()).gaps.find((gap) => gap.id === id);
	},

	async acknowledge(id, actorId) {
		await writeState(id, { status: 'acknowledged', actorId });
	},

	async start(id, actorId) {
		// O sinal do momento em que o trabalho começa vira a linha de base contra a
		// qual a resolução será medida depois (§21).
		const gap = await documentationGaps.get(id);
		await writeState(id, {
			status: 'in-progress',
			actorId,
			baseline: {
				searches: gap?.evidence.searches ?? 0,
				aiFailures: gap?.evidence.aiFailures ?? 0,
				at: new Date().toISOString(),
			},
		});
	},

	/**
	 * Marcar como resolvido — se o sinal deixar.
	 *
	 * É aqui que mora a exigência mais importante da spec: **o sistema não deve
	 * considerar um gap resolvido simplesmente porque alguém criou uma página**.
	 * Sem linha de base não há como medir queda, e o pedido é recusado com essa
	 * explicação em vez de aceito por educação.
	 */
	async resolve(id, actorId) {
		const gap = await documentationGaps.get(id);
		if (!gap) return { resolved: false, reason: 'Gap não encontrado.' };

		if (!gap.baseline) {
			return {
				resolved: false,
				reason:
					'Este gap não foi marcado como em andamento, então não há linha de base para comparar. Publicar uma página não é evidência de que o gap sumiu — marque como em andamento, publique, e volte quando houver sinal novo.',
			};
		}

		const check = checkResolution(gap.baseline, {
			searches: gap.evidence.searches,
			aiFailures: gap.evidence.aiFailures,
		});

		if (check.resolved) await writeState(id, { status: 'resolved', actorId });

		return { resolved: check.resolved, reason: check.reason };
	},

	async dismiss(id, actorId) {
		await writeState(id, { status: 'dismissed', actorId });
	},
};
