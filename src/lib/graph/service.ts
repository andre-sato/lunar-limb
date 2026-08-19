/**
 * `KnowledgeGraphService` (P3.4 — § CLI, § Graph freshness).
 *
 * O cache e os estados de frescor. Reconstruir o grafo custa: ele lê o Twin, a
 * governança, o Git, o Gap Mining e o Contract Testing. Guardar o resultado em
 * memória e declarar a idade é o que permite consultá-lo sem pagar isso a cada
 * pergunta — e declarar a idade é a parte que importa, porque um grafo velho
 * responde com a mesma confiança de um novo.
 */

import { buildKnowledgeGraph } from './build';
import { query, traverseImpact, type ImpactOptions } from './query';
import type { GraphImpact, GraphStatus, KnowledgeGraph, QueryMatch } from './types';

/** Depois disto o grafo em cache é declarado desatualizado. */
const STALE_AFTER_MS = 5 * 60_000;

interface CacheEntry {
	graph: KnowledgeGraph;
	status: GraphStatus;
	builtAt: number;
}

let cache: CacheEntry | null = null;
let building: Promise<CacheEntry> | null = null;

function withFreshness(entry: CacheEntry): GraphStatus {
	const ageMs = Date.now() - entry.builtAt;

	return {
		...entry.status,
		// Degradação vence idade: um grafo montado há dez segundos sem a governança
		// continua sendo um grafo incompleto, e chamá-lo de `fresh` esconderia isso.
		freshness: entry.status.degraded.length > 0 ? 'stale' : ageMs > STALE_AFTER_MS ? 'stale' : 'fresh',
		builtAt: entry.builtAt,
		ageSeconds: Math.round(ageMs / 1000),
	};
}

async function load(fresh = false): Promise<CacheEntry> {
	if (!fresh && cache && Date.now() - cache.builtAt <= STALE_AFTER_MS) return cache;

	// Uma construção por vez. Sem isto, duas requisições simultâneas leriam disco,
	// Git e contratos duas vezes para produzir o mesmo grafo.
	if (building) return building;

	building = buildKnowledgeGraph({ fresh })
		.then((result) => {
			cache = { graph: result.graph, status: result.status, builtAt: Date.now() };
			return cache;
		})
		.finally(() => {
			building = null;
		});

	return building;
}

export interface KnowledgeGraphService {
	status(): Promise<GraphStatus>;
	graph(): Promise<KnowledgeGraph>;
	query(text: string, options?: { type?: string; limit?: number }): Promise<QueryMatch[]>;
	impact(nodeId: string, options?: ImpactOptions): Promise<GraphImpact>;
	rebuild(): Promise<GraphStatus>;
}

export const knowledgeGraph: KnowledgeGraphService = {
	async status() {
		return withFreshness(await load());
	},

	async graph() {
		return (await load()).graph;
	},

	async query(text, options) {
		return query((await load()).graph, text, options);
	},

	async impact(nodeId, options) {
		return traverseImpact((await load()).graph, nodeId, options);
	},

	async rebuild() {
		return withFreshness(await load(true));
	},
};

/** Descarta o cache. Existe para os testes não herdarem grafo de outro teste. */
export function resetKnowledgeGraph(): void {
	cache = null;
	building = null;
}
