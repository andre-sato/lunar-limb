/**
 * `DigitalTwinService` (§19) e busca em linguagem quase natural (§18).
 *
 * A interface da spec, sobre o grafo derivado. Nenhum método escreve: o Twin é
 * leitura de fontes de verdade que vivem no Git, e um `set` aqui seria a porta
 * pela qual ele viraria a segunda verdade que a §2 proíbe.
 */

import { analyzeTwinImpact, computeCoverage, findPotentiallyStale, findUndocumented, findVersionGaps } from './analysis';
import { getTwin } from './load';
import { twinId, type CoverageReport, type StaleDocumentationItem, type TwinEdge, type TwinNode, type TwinSummary, type UndocumentedItem } from './types';

export interface DigitalTwinService {
	getNode(id: string): Promise<TwinNode | undefined>;
	getRelations(id: string): Promise<TwinEdge[]>;
	getImpact(id: string): Promise<ReturnType<typeof analyzeTwinImpact>>;
	getCoverage(): Promise<CoverageReport>;
	getUndocumented(): Promise<UndocumentedItem[]>;
	getStaleDocumentation(): Promise<StaleDocumentationItem[]>;
	getSummary(): Promise<TwinSummary>;
}

export const digitalTwin: DigitalTwinService = {
	async getNode(id) {
		return (await getTwin()).graph.nodes.find((node) => node.id === id);
	},

	async getRelations(id) {
		const { graph } = await getTwin();
		// As duas direções: o que este nó aponta e quem aponta para ele. Uma lista
		// só de saída responderia metade da pergunta em qualquer painel.
		return graph.edges.filter((edge) => edge.from === id || edge.to === id);
	},

	async getImpact(id) {
		return analyzeTwinImpact((await getTwin()).graph, id);
	},

	async getCoverage() {
		return computeCoverage((await getTwin()).graph);
	},

	async getUndocumented() {
		return findUndocumented((await getTwin()).graph);
	},

	async getStaleDocumentation() {
		const { graph, references } = await getTwin();
		return findPotentiallyStale(graph, references);
	},

	async getSummary() {
		const { graph, references } = await getTwin();

		const nodes: Record<string, number> = {};
		for (const node of graph.nodes) nodes[node.type] = (nodes[node.type] ?? 0) + 1;

		return {
			nodes,
			edges: graph.edges.length,
			coverage: computeCoverage(graph),
			undocumented: findUndocumented(graph),
			stale: findPotentiallyStale(graph, references),
			versionGaps: findVersionGaps(graph),
			generatedAt: graph.generatedAt,
		};
	},
};

// ---------------------------------------------------------------------------
// Busca (§18)
// ---------------------------------------------------------------------------

export type TwinQueryKind = 'undocumented' | 'stale' | 'coverage' | 'where-documented' | 'node';

export interface TwinQuery {
	kind: TwinQueryKind;
	/** Termo extraído da pergunta, quando ela cita um endpoint ou caminho. */
	subject?: string;
}

/**
 * Interpreta a pergunta.
 *
 * Reconhecimento de padrão, e não modelo de linguagem: as perguntas úteis aqui
 * são poucas e conhecidas ("quais APIs não estão documentadas", "onde está
 * documentado X"), e resolvê-las com um LLM traria custo, latência e uma chance
 * de errar em troca de nada. Pergunta não reconhecida devolve `null`, e a
 * interface diz o que ela sabe responder — em vez de adivinhar.
 */
export function parseTwinQuery(question: string): TwinQuery | null {
	const text = question
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.trim();

	const endpoint = question.match(/\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[A-Za-z0-9/_{}.:-]+)/i);

	if (/onde .*(documenta|esta documentad)/.test(text) || /where .*document/.test(text)) {
		return { kind: 'where-documented', subject: endpoint ? `${endpoint[1].toUpperCase()} ${endpoint[2]}` : undefined };
	}

	if (/(nao|não|sem).*(documentad|documenta)/.test(text) || /undocumented/.test(text)) {
		return { kind: 'undocumented' };
	}

	if (/(obsolet|desatualizad|orfa|órfã)/.test(text) || /stale|orphan/.test(text)) {
		return { kind: 'stale' };
	}

	if (/cobertura|coverage/.test(text)) return { kind: 'coverage' };

	if (endpoint) return { kind: 'node', subject: `${endpoint[1].toUpperCase()} ${endpoint[2]}` };

	return null;
}

export interface TwinAnswer {
	kind: TwinQueryKind;
	summary: string;
	items: Array<{ id: string; label: string; detail?: string }>;
}

export async function answerTwinQuery(question: string): Promise<TwinAnswer | null> {
	const query = parseTwinQuery(question);
	if (!query) return null;

	const { graph, references } = await getTwin();

	if (query.kind === 'undocumented') {
		const items = findUndocumented(graph);
		return {
			kind: query.kind,
			summary: `${items.length} endpoint(s) sem documentação`,
			items: items.map((item) => ({ id: item.node.id, label: item.node.name, detail: item.evidence.join(', ') })),
		};
	}

	if (query.kind === 'stale') {
		const items = findPotentiallyStale(graph, references);
		return {
			kind: query.kind,
			summary: `${items.length} referência(s) potencialmente obsoleta(s)`,
			items: items.map((item) => ({ id: item.node.id, label: item.node.name, detail: item.reference })),
		};
	}

	if (query.kind === 'coverage') {
		const coverage = computeCoverage(graph);
		return {
			kind: query.kind,
			summary: `Cobertura geral: ${coverage.overall ?? '—'}%`,
			items: [
				{ id: 'endpoints', label: 'Endpoints', detail: `${coverage.endpoints.percentage ?? '—'}%` },
				{ id: 'schemas', label: 'Schemas', detail: `${coverage.schemas.percentage ?? '—'}%` },
				{ id: 'examples', label: 'Exemplos', detail: `${coverage.examples.percentage ?? '—'}%` },
				{ id: 'features', label: 'Domínios', detail: `${coverage.features.percentage ?? '—'}%` },
			],
		};
	}

	if (!query.subject) {
		return { kind: query.kind, summary: 'Não identifiquei qual endpoint você quis dizer.', items: [] };
	}

	const endpointId = twinId.endpoint(query.subject);
	const pages = graph.edges
		.filter((edge) => edge.to === endpointId && edge.relation === 'documents')
		.map((edge) => graph.nodes.find((node) => node.id === edge.from))
		.filter((node): node is TwinNode => node !== undefined);

	if (query.kind === 'where-documented') {
		return {
			kind: query.kind,
			summary:
				pages.length === 0
					? `\`${query.subject}\` não é documentado em nenhuma página.`
					: `\`${query.subject}\` é documentado em ${pages.length} página(s)`,
			items: pages.map((page) => ({ id: page.id, label: page.name, detail: page.source })),
		};
	}

	const node = graph.nodes.find((candidate) => candidate.id === endpointId);
	if (!node) return { kind: 'node', summary: `\`${query.subject}\` não existe no Twin.`, items: [] };

	const relations = graph.edges.filter((edge) => edge.from === node.id || edge.to === node.id);
	return {
		kind: 'node',
		summary: `${node.name}: ${relations.length} relação(ões)`,
		items: relations.map((edge) => ({
			id: edge.from === node.id ? edge.to : edge.from,
			label: edge.relation,
			detail: edge.from === node.id ? edge.to : edge.from,
		})),
	};
}
