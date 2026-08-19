/**
 * Consulta e travessia do Knowledge Graph (P3.4 — § Queries, § Impact analysis).
 *
 * Puro: recebe o grafo e a pergunta, devolve a resposta. Quem monta o grafo é
 * `build.ts`.
 */

import type { GraphImpact, ImpactNode, KnowledgeEdge, KnowledgeGraph, KnowledgeNode, KnowledgeRelation, QueryMatch } from './types';

/** Sem acento, sem caixa. */
export function fold(text: string): string {
	return text
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase();
}

export interface Adjacency {
	out: Map<string, KnowledgeEdge[]>;
	in: Map<string, KnowledgeEdge[]>;
	byId: Map<string, KnowledgeNode>;
}

export function index(graph: KnowledgeGraph): Adjacency {
	const out = new Map<string, KnowledgeEdge[]>();
	const incoming = new Map<string, KnowledgeEdge[]>();

	for (const edge of graph.edges) {
		out.set(edge.from, [...(out.get(edge.from) ?? []), edge]);
		incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge]);
	}

	return { out, in: incoming, byId: new Map(graph.nodes.map((node) => [node.id, node])) };
}

/**
 * Procura nós por texto.
 *
 * Casa por nome, por arquivo de origem e por id. Não há busca semântica aqui de
 * propósito: o grafo responde perguntas estruturais, e quem responde perguntas
 * em linguagem natural é o assistente, com a busca do portal. Misturar os dois
 * faria o grafo devolver resultados plausíveis e não verificáveis.
 */
export function query(graph: KnowledgeGraph, text: string, options: { type?: string; limit?: number } = {}): QueryMatch[] {
	const needle = fold(text.trim());
	if (needle === '') return [];

	const adjacency = index(graph);
	const matches: QueryMatch[] = [];

	for (const node of graph.nodes) {
		if (options.type && node.type !== options.type) continue;

		const matchedOn =
			fold(node.name).includes(needle)
				? 'nome'
				: node.source && fold(node.source).includes(needle)
					? 'arquivo de origem'
					: fold(node.id).includes(needle)
						? 'identificador'
						: null;

		if (!matchedOn) continue;

		const related = [
			...(adjacency.out.get(node.id) ?? []).map((edge) => ({
				node: adjacency.byId.get(edge.to),
				relation: edge.relation,
				direction: 'out' as const,
			})),
			...(adjacency.in.get(node.id) ?? []).map((edge) => ({
				node: adjacency.byId.get(edge.from),
				relation: edge.relation,
				direction: 'in' as const,
			})),
		].filter((entry): entry is { node: KnowledgeNode; relation: KnowledgeRelation; direction: 'out' | 'in' } => Boolean(entry.node));

		matches.push({ node, matchedOn, related });
	}

	// Nome exato primeiro, depois nome parcial, depois o resto: quem procura
	// `payments.create` quer o nó, não as vinte páginas que o mencionam.
	return matches
		.sort((a, b) => {
			const exact = Number(fold(b.node.name) === needle) - Number(fold(a.node.name) === needle);
			if (exact !== 0) return exact;
			const byName = Number(a.matchedOn !== 'nome') - Number(b.matchedOn !== 'nome');
			if (byName !== 0) return byName;
			return b.related.length - a.related.length;
		})
		.slice(0, options.limit ?? 20);
}

// ---------------------------------------------------------------------------
// Impacto
// ---------------------------------------------------------------------------

/**
 * As relações que propagam impacto, e a direção em que elas propagam.
 *
 * Nem toda aresta propaga. Se um endpoint muda, as páginas que o **documentam**
 * são afetadas; a especificação que o **define** não é. Tratar o grafo como
 * indireto faria uma mudança num endpoint "afetar" todos os endpoints da mesma
 * especificação — o mesmo erro que o Documentation-to-Code Loop cometeu ao
 * marcar arquivo inteiro em vez de linha.
 */
const PROPAGATES_IN: readonly KnowledgeRelation[] = ['documents', 'implements', 'validated-by', 'references', 'uses'];
const PROPAGATES_OUT: readonly KnowledgeRelation[] = ['contains', 'affected-by', 'owned-by'];

export interface ImpactOptions {
	maxDepth?: number;
	maxNodes?: number;
}

export function traverseImpact(graph: KnowledgeGraph, originId: string, options: ImpactOptions = {}): GraphImpact {
	const maxDepth = options.maxDepth ?? 3;
	const maxNodes = options.maxNodes ?? 200;

	const adjacency = index(graph);
	const origin = adjacency.byId.get(originId) ?? null;

	if (!origin) return { origin: null, affected: [], pages: [], teams: [], truncated: false };

	const seen = new Set<string>([originId]);
	const affected: ImpactNode[] = [];
	let queue: Array<{ id: string; distance: number; via: KnowledgeRelation[] }> = [{ id: originId, distance: 0, via: [] }];
	let truncated = false;

	while (queue.length > 0) {
		const next: typeof queue = [];

		for (const current of queue) {
			if (current.distance >= maxDepth) {
				truncated = true;
				continue;
			}

			const neighbours = [
				...(adjacency.in.get(current.id) ?? [])
					.filter((edge) => PROPAGATES_IN.includes(edge.relation))
					.map((edge) => ({ id: edge.from, relation: edge.relation })),
				...(adjacency.out.get(current.id) ?? [])
					.filter((edge) => PROPAGATES_OUT.includes(edge.relation))
					.map((edge) => ({ id: edge.to, relation: edge.relation })),
			];

			for (const neighbour of neighbours) {
				if (seen.has(neighbour.id)) continue;

				if (affected.length >= maxNodes) {
					truncated = true;
					break;
				}

				seen.add(neighbour.id);
				const node = adjacency.byId.get(neighbour.id);
				if (!node) continue;

				const via = [...current.via, neighbour.relation];
				affected.push({ node, distance: current.distance + 1, via });
				next.push({ id: neighbour.id, distance: current.distance + 1, via });
			}
		}

		queue = next;
	}

	return {
		origin,
		affected: affected.sort((a, b) => a.distance - b.distance || a.node.id.localeCompare(b.node.id)),
		pages: affected.filter((entry) => entry.node.type === 'page').map((entry) => entry.node.source ?? entry.node.name),
		teams: [...new Set(affected.filter((entry) => entry.node.type === 'team').map((entry) => entry.node.name))],
		truncated,
	};
}
