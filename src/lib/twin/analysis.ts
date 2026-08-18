/**
 * Cobertura e as duas perguntas inversas (§8, §9, §10, §11, §12, §13).
 *
 * Tudo puro: recebe o grafo montado e devolve relatório. As duas perguntas que
 * dão nome à camada são simétricas e têm severidades muito diferentes:
 *
 *     implementação sem documentação  →  dívida certa
 *     documentação sem implementação  →  **potencialmente** obsoleta
 *
 * A assimetria é deliberada e está na §11. Uma página que cita um endpoint
 * inexistente pode estar documentando comportamento histórico, versão anterior,
 * conceito ou funcionalidade planejada. Marcá-la como erro automático
 * transformaria documentação legítima em alarme, e alarme falso é como se ensina
 * uma equipe a ignorar o painel.
 */

import { slice, twinId, type CoverageReport, type StaleDocumentationItem, type TwinGraph, type TwinNode, type UndocumentedItem } from './types';

function nodesOf(graph: TwinGraph, type: TwinNode['type']): TwinNode[] {
	return graph.nodes.filter((node) => node.type === type);
}

function hasIncoming(graph: TwinGraph, to: string, relation: string): boolean {
	return graph.edges.some((edge) => edge.to === to && edge.relation === relation);
}

function hasOutgoing(graph: TwinGraph, from: string, relation: string): boolean {
	return graph.edges.some((edge) => edge.from === from && edge.relation === relation);
}

/** Endpoints que alguma página documenta. */
export function documentedEndpoints(graph: TwinGraph): Set<string> {
	return new Set(graph.edges.filter((edge) => edge.relation === 'documents').map((edge) => edge.to));
}

// ---------------------------------------------------------------------------
// Cobertura (§8, §9)
// ---------------------------------------------------------------------------

/**
 * Um endpoint conta para a cobertura?
 *
 * Rota interna do portal — editor, painel administrativo — não é API de produto.
 * Cobrá-la aqui produziria um número que a equipe aprenderia a ignorar: a
 * primeira medição real deu 6% porque 45 rotas internas entraram na conta contra
 * 5 endpoints públicos.
 *
 * O critério de exceção é a publicação: endpoint declarado numa especificação é
 * público por definição — declarar o contrato **é** publicá-lo — e conta mesmo
 * que o caminho case com um prefixo interno.
 */
export function countsForCoverage(node: TwinNode): boolean {
	if (node.source) return true;
	return node.metadata?.internal !== true;
}

export function computeCoverage(graph: TwinGraph): CoverageReport {
	const all = nodesOf(graph, 'endpoint');
	const endpoints = all.filter(countsForCoverage);
	const documented = documentedEndpoints(graph);

	const schemas = nodesOf(graph, 'schema');
	const documentedSchemas = schemas.filter((schema) => hasIncoming(graph, schema.id, 'documents')).length;

	// Exemplo conta sobre os endpoints **documentados**, não sobre todos: cobrar
	// exemplo de endpoint que ainda não tem página seria cobrar duas coisas na
	// mesma linha e esconder qual delas falta.
	const documentedList = endpoints.filter((endpoint) => documented.has(endpoint.id));
	const withExample = documentedList.filter((endpoint) => hasOutgoing(graph, endpoint.id, 'contains')).length;

	// "Feature" aqui é o domínio declarado pela própria especificação — a tag da
	// operação. Inventar uma taxonomia de funcionalidades à parte criaria uma
	// segunda fonte de verdade, que é justamente o que o §2 proíbe.
	const domains = new Map<string, { documented: number; total: number }>();
	for (const endpoint of endpoints) {
		const tags = (endpoint.metadata?.tags as string[] | undefined) ?? [];
		const keys = tags.length > 0 ? tags : ['sem domínio'];
		for (const key of keys) {
			const entry = domains.get(key) ?? { documented: 0, total: 0 };
			entry.total++;
			if (documented.has(endpoint.id)) entry.documented++;
			domains.set(key, entry);
		}
	}

	const coveredDomains = [...domains.values()].filter((entry) => entry.documented === entry.total).length;

	const report: CoverageReport = {
		endpoints: slice(documentedList.length, endpoints.length),
		schemas: slice(documentedSchemas, schemas.length),
		examples: slice(withExample, documentedList.length),
		features: slice(coveredDomains, domains.size),
		byDomain: [...domains.entries()]
			.map(([domain, entry]) => ({
				domain,
				documented: entry.documented,
				total: entry.total,
				percentage: Math.round((entry.documented / entry.total) * 100),
			}))
			.sort((a, b) => a.percentage - b.percentage || a.domain.localeCompare(b.domain)),
		overall: null,
		internal: all.length - endpoints.length,
	};

	const measurable = [report.endpoints, report.schemas, report.examples, report.features]
		.map((entry) => entry.percentage)
		.filter((value): value is number => value !== null);

	report.overall =
		measurable.length === 0 ? null : Math.round(measurable.reduce((sum, value) => sum + value, 0) / measurable.length);

	return report;
}

// ---------------------------------------------------------------------------
// Implementação sem documentação (§10)
// ---------------------------------------------------------------------------

export function findUndocumented(graph: TwinGraph, options: { includeInternal?: boolean } = {}): UndocumentedItem[] {
	const documented = documentedEndpoints(graph);

	return nodesOf(graph, 'endpoint')
		.filter((endpoint) => options.includeInternal || countsForCoverage(endpoint))
		.filter((endpoint) => !documented.has(endpoint.id))
		.map((endpoint) => {
			const evidence: string[] = [];

			if (hasIncoming(graph, endpoint.id, 'implements')) evidence.push('implementado no código');
			if (hasIncoming(graph, endpoint.id, 'contains')) evidence.push('declarado na especificação');
			if (endpoint.metadata?.deprecated) evidence.push('marcado como obsoleto');
			if (endpoint.metadata?.internal) evidence.push('rota interna do portal');

			return {
				node: endpoint,
				evidence,
				suggestion: `Documente em \`src/content/docs/api-reference/\` ou use \`<TryIt/>\` numa página existente.`,
			};
		})
		.sort((a, b) => b.evidence.length - a.evidence.length || a.node.name.localeCompare(b.node.name));
}

// ---------------------------------------------------------------------------
// Documentação sem implementação (§11)
// ---------------------------------------------------------------------------

/**
 * Referências a endpoints citadas em páginas que não existem em lugar nenhum.
 *
 * `potentiallyStale`, e o nome é a política: isto é um sinal para uma pessoa
 * olhar, não um veredito.
 */
export function findPotentiallyStale(
	graph: TwinGraph,
	referencesByPage: ReadonlyMap<string, readonly string[]>
): StaleDocumentationItem[] {
	const known = new Set(nodesOf(graph, 'endpoint').map((endpoint) => endpoint.name));
	const items: StaleDocumentationItem[] = [];

	for (const [pagePath, references] of referencesByPage) {
		const node = graph.nodes.find((candidate) => candidate.id === twinId.page(pagePath));
		if (!node) continue;

		for (const reference of references) {
			if (known.has(reference)) continue;
			items.push({
				node,
				reference,
				reason:
					'A página cita este endpoint e ele não aparece em nenhuma especificação nem no código. Pode ser comportamento histórico, versão anterior, conceito ou algo ainda planejado — confira antes de tratar como defeito.',
			});
		}
	}

	return items;
}

// ---------------------------------------------------------------------------
// Versões (§12)
// ---------------------------------------------------------------------------

export function findVersionGaps(graph: TwinGraph): Array<{ endpoint: string; version: string; issue: string }> {
	const documented = documentedEndpoints(graph);
	const gaps: Array<{ endpoint: string; version: string; issue: string }> = [];

	for (const endpoint of nodesOf(graph, 'endpoint')) {
		if (!endpoint.version) continue;
		if (documented.has(endpoint.id)) continue;

		gaps.push({
			endpoint: endpoint.name,
			version: endpoint.version,
			issue: 'implementado nesta versão e sem documentação correspondente',
		});
	}

	return gaps;
}

// ---------------------------------------------------------------------------
// Impacto (§13)
// ---------------------------------------------------------------------------

export interface TwinImpact {
	node: TwinNode;
	/** Nós alcançados, com a distância e o caminho percorrido. */
	affected: Array<{ node: TwinNode; distance: number; via: string[] }>;
	/** Contagem por tipo, para a linha de resumo. */
	byType: Record<string, number>;
}

/**
 * O que é afetado por uma mudança neste nó.
 *
 * Caminha as arestas **para trás** — quem depende de quem — e em largura, para o
 * caminho registrado ser o mais curto. O conjunto de visitados também é a defesa
 * contra ciclo, que o grafo permite.
 */
export function analyzeTwinImpact(graph: TwinGraph, nodeId: string, maxDepth = 4): TwinImpact | null {
	const node = graph.nodes.find((candidate) => candidate.id === nodeId);
	if (!node) return null;

	const incoming = new Map<string, string[]>();
	for (const edge of graph.edges) {
		// `used-by` é a aresta espelho de `uses`; segui-la também duplicaria todo
		// caminho de conteúdo reutilizável.
		if (edge.relation === 'used-by') continue;
		const list = incoming.get(edge.to);
		if (list) list.push(edge.from);
		else incoming.set(edge.to, [edge.from]);
	}

	const affected: TwinImpact['affected'] = [];
	const seen = new Set([nodeId]);
	let frontier: Array<{ id: string; via: string[] }> = [{ id: nodeId, via: [nodeId] }];

	for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
		const next: typeof frontier = [];

		for (const current of frontier) {
			for (const from of incoming.get(current.id) ?? []) {
				if (seen.has(from)) continue;
				seen.add(from);

				const target = graph.nodes.find((candidate) => candidate.id === from);
				if (!target) continue;

				const via = [from, ...current.via];
				affected.push({ node: target, distance: depth, via });
				next.push({ id: from, via });
			}
		}

		frontier = next;
	}

	const byType: Record<string, number> = {};
	for (const item of affected) byType[item.node.type] = (byType[item.node.type] ?? 0) + 1;

	return { node, affected, byType };
}
