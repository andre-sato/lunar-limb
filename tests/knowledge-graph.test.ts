import { describe, expect, it } from 'vitest';
import { fold, index, query, traverseImpact } from '../src/lib/graph/query';
import type { KnowledgeEdge, KnowledgeGraph, KnowledgeNode } from '../src/lib/graph/types';

function node(id: string, type: KnowledgeNode['type'], name: string, source?: string): KnowledgeNode {
	return { id, type, name, source };
}

function edge(from: string, to: string, relation: KnowledgeEdge['relation']): KnowledgeEdge {
	return { from, to, relation, origin: 'declared' };
}

/**
 * Um portal pequeno mas completo: um endpoint implementado por um arquivo,
 * documentado por duas páginas, validado por um contrato, com dono e lacuna.
 */
const graph: KnowledgeGraph = {
	nodes: [
		node('endpoint:POST /api/payments', 'endpoint', 'POST /api/payments'),
		node('endpoint:GET /api/payments', 'endpoint', 'GET /api/payments'),
		node('api:portal', 'api', 'Portal API'),
		node('code:src/pages/api/payments.ts', 'code', 'payments.ts', 'src/pages/api/payments.ts'),
		node('page:payments', 'page', 'Pagamentos', 'src/content/docs/payments.md'),
		node('page:checkout', 'page', 'Checkout', 'src/content/docs/checkout.md'),
		node('page:solta', 'page', 'Página solta', 'src/content/docs/solta.md'),
		node('team:payments', 'team', 'Time de Pagamentos'),
		node('contract:POST /api/payments', 'contract', 'POST /api/payments'),
		node('gap:refund', 'gap', 'como estornar um pagamento'),
	],
	edges: [
		edge('api:portal', 'endpoint:POST /api/payments', 'defines'),
		edge('api:portal', 'endpoint:GET /api/payments', 'defines'),
		edge('code:src/pages/api/payments.ts', 'endpoint:POST /api/payments', 'implements'),
		edge('page:payments', 'endpoint:POST /api/payments', 'documents'),
		edge('page:checkout', 'endpoint:POST /api/payments', 'documents'),
		edge('page:payments', 'team:payments', 'owned-by'),
		edge('page:payments', 'contract:POST /api/payments', 'validated-by'),
		edge('page:payments', 'gap:refund', 'affected-by'),
	],
};

// ---------------------------------------------------------------------------
// Índice e consulta
// ---------------------------------------------------------------------------

describe('index', () => {
	it('indexa as arestas nas duas direções', () => {
		const adjacency = index(graph);

		expect(adjacency.in.get('endpoint:POST /api/payments')).toHaveLength(4);
		expect(adjacency.out.get('page:payments')).toHaveLength(4);
	});
});

describe('fold', () => {
	it('ignora acento e caixa', () => {
		expect(fold('Página')).toBe(fold('pagina'));
	});
});

describe('query', () => {
	it('casa por nome', () => {
		expect(query(graph, 'Pagamentos').map((match) => match.node.id)).toContain('page:payments');
	});

	it('casa por arquivo de origem', () => {
		const matches = query(graph, 'src/pages/api/payments.ts');
		expect(matches[0].matchedOn).toBe('arquivo de origem');
	});

	it('casa por identificador', () => {
		expect(query(graph, 'gap:refund')[0].node.type).toBe('gap');
	});

	it('nome exato vem antes de casamento parcial', () => {
		// Quem procura `POST /api/payments` quer o nó, não as páginas que o citam.
		expect(query(graph, 'POST /api/payments')[0].node.name).toBe('POST /api/payments');
	});

	it('filtra por tipo', () => {
		const matches = query(graph, 'payments', { type: 'team' });
		expect(matches.every((match) => match.node.type === 'team')).toBe(true);
	});

	it('busca vazia não devolve o grafo inteiro', () => {
		expect(query(graph, '   ')).toEqual([]);
	});

	it('traz as relações de cada resultado nas duas direções', () => {
		const match = query(graph, 'Pagamentos').find((entry) => entry.node.id === 'page:payments')!;
		const relations = match.related.map((entry) => `${entry.direction}:${entry.relation}`);

		expect(relations).toContain('out:documents');
		expect(relations).toContain('out:owned-by');
	});
});

// ---------------------------------------------------------------------------
// Impacto
// ---------------------------------------------------------------------------

describe('traverseImpact', () => {
	it('alcança as páginas que documentam o endpoint', () => {
		const impact = traverseImpact(graph, 'endpoint:POST /api/payments');
		expect(impact.pages.sort()).toEqual(['src/content/docs/checkout.md', 'src/content/docs/payments.md']);
	});

	it('alcança o código que implementa', () => {
		const impact = traverseImpact(graph, 'endpoint:POST /api/payments');
		expect(impact.affected.some((entry) => entry.node.type === 'code')).toBe(true);
	});

	it('chega ao time por dois saltos e o reporta', () => {
		const impact = traverseImpact(graph, 'endpoint:POST /api/payments');

		expect(impact.teams).toEqual(['Time de Pagamentos']);
		expect(impact.affected.find((entry) => entry.node.type === 'team')?.distance).toBe(2);
	});

	it('não propaga pela especificação para os outros endpoints', () => {
		// Tratar o grafo como indireto faria uma mudança num endpoint "afetar" todos
		// os endpoints da mesma especificação — o mesmo erro que o Code Loop cometeu
		// ao marcar arquivo inteiro em vez de linha.
		const impact = traverseImpact(graph, 'endpoint:POST /api/payments');
		expect(impact.affected.some((entry) => entry.node.id === 'endpoint:GET /api/payments')).toBe(false);
	});

	it('não visita o mesmo nó duas vezes', () => {
		const impact = traverseImpact(graph, 'endpoint:POST /api/payments');
		const ids = impact.affected.map((entry) => entry.node.id);

		expect(ids.length).toBe(new Set(ids).size);
	});

	it('registra o caminho percorrido', () => {
		const impact = traverseImpact(graph, 'endpoint:POST /api/payments');
		expect(impact.affected.find((entry) => entry.node.type === 'team')?.via).toEqual(['documents', 'owned-by']);
	});

	it('respeita o limite de profundidade e avisa que parou', () => {
		const impact = traverseImpact(graph, 'endpoint:POST /api/payments', { maxDepth: 1 });

		expect(impact.teams).toEqual([]);
		expect(impact.truncated).toBe(true);
	});

	it('nó sem dependentes devolve lista vazia, não erro', () => {
		const impact = traverseImpact(graph, 'page:solta');

		expect(impact.origin?.id).toBe('page:solta');
		expect(impact.affected).toEqual([]);
	});

	it('nó inexistente devolve origem nula em vez de inventar um', () => {
		expect(traverseImpact(graph, 'endpoint:INVENTADO').origin).toBeNull();
	});

	it('ciclo não trava a travessia', () => {
		const cyclic: KnowledgeGraph = {
			nodes: [node('a', 'page', 'A'), node('b', 'page', 'B')],
			edges: [edge('a', 'b', 'documents'), edge('b', 'a', 'documents')],
		};

		expect(traverseImpact(cyclic, 'a').affected).toHaveLength(1);
	});
});
