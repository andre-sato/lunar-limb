/**
 * Testes do Documentation Digital Twin.
 *
 * Dois comportamentos aqui valem mais que os outros, e os dois foram descobertos
 * medindo o portal de verdade em vez de só rodar os testes:
 *
 *  1. O mesmo endpoint visto pela especificação e pelo código precisa ser **um**
 *     nó. Sem juntar o prefixo do servidor, ele vira dois, e ambos aparecem como
 *     não documentados.
 *  2. Rota interna do portal não conta na cobertura. Com elas dentro, a primeira
 *     medição deu 6% — um número que a equipe aprende a ignorar.
 */

import { describe, it, expect } from 'vitest';
import { basePathOf, buildTwin, endpointKey, isInternal, normalizeEndpointPath } from '../src/lib/twin/build';
import {
	analyzeTwinImpact,
	computeCoverage,
	countsForCoverage,
	documentedEndpoints,
	findPotentiallyStale,
	findUndocumented,
	findVersionGaps,
} from '../src/lib/twin/analysis';
import { parseTwinQuery } from '../src/lib/twin/service';
import { extractEndpointMentions } from '../src/lib/twin/load';
import { twinId } from '../src/lib/twin/types';
import type { ApiModel, ApiOperation } from '../src/lib/api-explorer/model';
import type { ContentGraph } from '../src/lib/editor/graph-model';

function operation(partial: Partial<ApiOperation> = {}): ApiOperation {
	return {
		id: 'getUser',
		method: 'get',
		path: '/users/{id}',
		tags: ['usuarios'],
		parameters: [],
		responses: [{ status: '200', description: 'ok' }],
		security: [],
		deprecated: false,
		...partial,
	};
}

function model(operations: ApiOperation[], partial: Partial<ApiModel> = {}): ApiModel {
	return { title: 'API', version: '1.0.0', servers: ['/api'], operations, securitySchemes: [], schemas: [], ...partial };
}

function page(path: string, body = '', title?: string) {
	return { path, body, title };
}

// ---------------------------------------------------------------------------
// Identidade de endpoint
// ---------------------------------------------------------------------------

describe('identidade de endpoint', () => {
	it('normaliza as duas convenções de parâmetro', () => {
		// `{id}` é OpenAPI, `[id]` é roteamento por arquivo. Sem normalizar, todo
		// endpoint com parâmetro apareceria duas vezes.
		expect(normalizeEndpointPath('/users/[id]')).toBe('/users/{id}');
		expect(normalizeEndpointPath('/users/{id}')).toBe('/users/{id}');
		expect(normalizeEndpointPath('/users/[...rest]')).toBe('/users/{rest}');
	});

	it('remove barra final e duplicada', () => {
		expect(normalizeEndpointPath('/users//list/')).toBe('/users/list');
	});

	it('a chave junta método e caminho', () => {
		expect(endpointKey('get', '/users')).toBe('GET /users');
	});

	it('o prefixo do servidor relativo entra no caminho', () => {
		expect(basePathOf(model([]))).toBe('/api');
		expect(basePathOf(model([], { servers: ['https://api.exemplo.com'] }))).toBe('');
		expect(basePathOf(model([], { servers: [] }))).toBe('');
	});

	it('especificação e código produzem o mesmo nó para o mesmo endpoint', () => {
		// O defeito que a primeira medição real expôs: `GET /auth/me` da
		// especificação e `GET /api/auth/me` do código eram dois endpoints, e os
		// dois apareciam como não documentados.
		const graph = buildTwin({
			apis: [{ path: 'src/schemas/api.yaml', model: model([operation({ path: '/auth/me' })]), kind: 'openapi' }],
			routes: [{ file: 'src/pages/api/auth/me.ts', path: '/api/auth/me', methods: ['GET'] }],
		});

		const endpoints = graph.nodes.filter((node) => node.type === 'endpoint');
		expect(endpoints).toHaveLength(1);
		expect(endpoints[0].name).toBe('GET /api/auth/me');
	});
});

// ---------------------------------------------------------------------------
// Construção (§2, §6, §7)
// ---------------------------------------------------------------------------

describe('construção do grafo', () => {
	it('o código implementa o endpoint', () => {
		const graph = buildTwin({ routes: [{ file: 'src/pages/api/x.ts', path: '/api/x', methods: ['GET', 'POST'] }] });

		expect(graph.edges.filter((edge) => edge.relation === 'implements')).toHaveLength(2);
		// A relação vem da convenção do framework, não de alguém tê-la escrito.
		expect(graph.edges.every((edge) => edge.origin === 'derived')).toBe(true);
	});

	it('o Content Graph existente é preservado com as relações que tinha', () => {
		const content: ContentGraph = {
			nodes: [
				{ key: 'docs:a.mdx', id: 'a', type: 'page', root: 'docs', path: 'a.mdx' },
				{ key: 'snippets:b.md', id: 'b', type: 'block', root: 'snippets', path: 'b.md' },
			],
			edges: [
				{
					source: 'docs:a.mdx',
					sourceId: 'a',
					target: 'b',
					type: 'uses',
					refType: 'block',
					resolved: true,
					location: { line: 1, column: 1, offset: 0 },
				},
			],
			generatedAt: 0,
		};

		const graph = buildTwin({ graph: content });
		expect(graph.edges.some((edge) => edge.relation === 'uses')).toBe(true);
		expect(graph.edges.some((edge) => edge.relation === 'used-by')).toBe(true);
	});

	it('`<TryIt/>` é declaração explícita de que a página documenta a operação', () => {
		const graph = buildTwin({
			apis: [{ path: 'src/schemas/api.yaml', model: model([operation()]), kind: 'openapi' }],
			pages: [page('api/users.mdx', '<TryIt schema="api.yaml" operation="getUser" />')],
		});

		const edge = graph.edges.find((candidate) => candidate.relation === 'documents');
		expect(edge).toMatchObject({ origin: 'declared', to: twinId.endpoint('GET /api/users/{id}') });
	});

	it('o caminho literal no texto também documenta, mas como inferência', () => {
		const graph = buildTwin({
			apis: [{ path: 'src/schemas/api.yaml', model: model([operation()]), kind: 'openapi' }],
			pages: [page('api/users.mdx', 'Chame `/api/users/{id}` para ler um usuário.')],
		});

		expect(graph.edges.find((edge) => edge.relation === 'documents')?.origin).toBe('derived');
	});

	it('caminho curto demais não vira inferência', () => {
		// `/api` casaria com meio portal e encheria o grafo de relações falsas.
		const graph = buildTwin({
			apis: [{ path: 'a.yaml', model: model([operation({ path: '/' })], { servers: ['/api'] }), kind: 'openapi' }],
			pages: [page('qualquer.mdx', 'menciona /api de passagem')],
		});

		expect(graph.edges.some((edge) => edge.relation === 'documents')).toBe(false);
	});

	it('descobrir o mesmo nó duas vezes enriquece, não substitui', () => {
		const graph = buildTwin({
			routes: [{ file: 'src/pages/api/auth/me.ts', path: '/api/auth/me', methods: ['GET'] }],
			apis: [{ path: 'src/schemas/api.yaml', model: model([operation({ path: '/auth/me' })]), kind: 'openapi' }],
		});

		const endpoint = graph.nodes.find((node) => node.type === 'endpoint');
		expect(endpoint?.source).toBe('src/schemas/api.yaml');
		expect(endpoint?.metadata?.implemented).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Cobertura (§8, §9)
// ---------------------------------------------------------------------------

describe('cobertura', () => {
	const graphWith = (documented: boolean) =>
		buildTwin({
			apis: [
				{
					path: 'src/schemas/api.yaml',
					model: model([operation(), operation({ id: 'createUser', method: 'post', path: '/users' })]),
					kind: 'openapi',
				},
			],
			pages: documented
				? [page('api/users.mdx', '<TryIt schema="api.yaml" operation="getUser" />')]
				: [page('api/users.mdx', 'Sem referência.')],
		});

	it('conta endpoints documentados sobre o total', () => {
		expect(computeCoverage(graphWith(true)).endpoints).toMatchObject({ documented: 1, total: 2, percentage: 50 });
	});

	it('sem nada para medir, a fatia é nula em vez de zero', () => {
		// Zero significaria "está ruim"; nulo significa "não há o que medir", e as
		// duas coisas levam a decisões diferentes.
		expect(computeCoverage(buildTwin({})).endpoints.percentage).toBeNull();
	});

	it('rota interna do portal fica fora da conta', () => {
		const graph = buildTwin({
			internal: ['/api/editor/'],
			routes: [
				{ file: 'src/pages/api/editor/file.ts', path: '/api/editor/file', methods: ['GET'] },
				{ file: 'src/pages/api/publico.ts', path: '/api/publico', methods: ['GET'] },
			],
		});

		const coverage = computeCoverage(graph);
		expect(coverage.endpoints.total).toBe(1);
		expect(coverage.internal).toBe(1);
	});

	it('endpoint declarado numa especificação conta mesmo em caminho interno', () => {
		// Declarar o contrato **é** publicá-lo.
		const graph = buildTwin({
			internal: ['/api/editor/'],
			apis: [
				{
					path: 'src/schemas/api.yaml',
					model: model([operation({ path: '/editor/git/branches' })]),
					kind: 'openapi',
				},
			],
			routes: [{ file: 'src/pages/api/editor/git/branches.ts', path: '/api/editor/git/branches', methods: ['GET'] }],
		});

		expect(computeCoverage(graph).endpoints.total).toBe(1);
		expect(computeCoverage(graph).internal).toBe(0);
	});

	it('exemplo é medido sobre os documentados, não sobre todos', () => {
		// Cobrar exemplo de endpoint sem página seria cobrar duas coisas na mesma
		// linha e esconder qual delas falta.
		const coverage = computeCoverage(graphWith(false));
		expect(coverage.examples.total).toBe(0);
	});

	it('o domínio vem da tag da própria especificação', () => {
		const coverage = computeCoverage(graphWith(true));
		expect(coverage.byDomain.map((entry) => entry.domain)).toContain('usuarios');
	});
});

// ---------------------------------------------------------------------------
// As duas perguntas inversas (§10, §11)
// ---------------------------------------------------------------------------

describe('implementado e não documentado', () => {
	it('lista o endpoint e o que se sabe dele', () => {
		const graph = buildTwin({ routes: [{ file: 'src/pages/api/x.ts', path: '/api/x', methods: ['POST'] }] });
		const items = findUndocumented(graph);

		expect(items).toHaveLength(1);
		expect(items[0].evidence).toContain('implementado no código');
	});

	it('endpoint documentado não aparece', () => {
		const graph = buildTwin({
			apis: [{ path: 'src/schemas/api.yaml', model: model([operation()]), kind: 'openapi' }],
			pages: [page('api/users.mdx', '<TryIt schema="api.yaml" operation="getUser" />')],
		});
		expect(findUndocumented(graph)).toEqual([]);
	});

	it('rota interna só aparece quando pedida', () => {
		const graph = buildTwin({
			internal: ['/api/editor/'],
			routes: [{ file: 'src/pages/api/editor/x.ts', path: '/api/editor/x', methods: ['GET'] }],
		});

		expect(findUndocumented(graph)).toEqual([]);
		expect(findUndocumented(graph, { includeInternal: true })).toHaveLength(1);
	});
});

describe('documentação potencialmente obsoleta', () => {
	const graph = buildTwin({
		apis: [{ path: 'src/schemas/api.yaml', model: model([operation()]), kind: 'openapi' }],
		pages: [page('guides/pagamentos.md', 'Use `POST /payments/refund`.')],
	});

	it('acusa referência sem correspondente em nenhuma fonte', () => {
		const items = findPotentiallyStale(graph, new Map([['guides/pagamentos.md', ['POST /payments/refund']]]));
		expect(items).toHaveLength(1);
		expect(items[0].reference).toBe('POST /payments/refund');
	});

	it('nunca chama de erro — a palavra é "potencialmente"', () => {
		// A página pode documentar histórico, versão anterior, conceito ou algo
		// planejado. Um veredito automático transformaria isso em alarme falso.
		const items = findPotentiallyStale(graph, new Map([['guides/pagamentos.md', ['POST /payments/refund']]]));
		expect(items[0].reason).toContain('Pode ser');
		expect(items[0].reason).not.toMatch(/\berro\b/i);
	});

	it('referência que existe não é acusada', () => {
		expect(findPotentiallyStale(graph, new Map([['guides/pagamentos.md', ['GET /api/users/{id}']]]))).toEqual([]);
	});

	it('reconhece menções a endpoint no texto', () => {
		expect(extractEndpointMentions('Chame POST /payments/refund para estornar.')).toEqual(['POST /payments/refund']);
		expect(extractEndpointMentions('Sem endpoint aqui.')).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Versões e impacto (§12, §13)
// ---------------------------------------------------------------------------

describe('versões', () => {
	it('endpoint com versão e sem documentação vira lacuna de versão', () => {
		const graph = buildTwin({
			apis: [{ path: 'a.yaml', model: model([operation()], { version: 'v2' }), kind: 'openapi' }],
		});

		expect(findVersionGaps(graph)[0]).toMatchObject({ version: 'v2' });
	});
});

describe('impacto', () => {
	const graph = buildTwin({
		apis: [{ path: 'src/schemas/api.yaml', model: model([operation()]), kind: 'openapi' }],
		routes: [{ file: 'src/pages/api/users/[id].ts', path: '/api/users/[id]', methods: ['GET'] }],
		pages: [page('api/users.mdx', '<TryIt schema="api.yaml" operation="getUser" />', 'Usuários')],
	});

	it('encontra quem depende do endpoint', () => {
		const impact = analyzeTwinImpact(graph, twinId.endpoint('GET /api/users/{id}'));
		expect(impact?.affected.some((item) => item.node.type === 'page')).toBe(true);
		expect(impact?.byType.page).toBe(1);
	});

	it('nó inexistente devolve nulo em vez de um relatório vazio', () => {
		expect(analyzeTwinImpact(graph, 'endpoint:GET /nao-existe')).toBeNull();
	});

	it('registra o caminho percorrido', () => {
		const impact = analyzeTwinImpact(graph, twinId.endpoint('GET /api/users/{id}'));
		expect(impact?.affected[0].via.length).toBeGreaterThanOrEqual(2);
	});
});

// ---------------------------------------------------------------------------
// Busca (§18)
// ---------------------------------------------------------------------------

describe('perguntas ao Twin', () => {
	it('reconhece as perguntas conhecidas', () => {
		expect(parseTwinQuery('Quais APIs não estão documentadas?')?.kind).toBe('undocumented');
		expect(parseTwinQuery('Which APIs are undocumented?')?.kind).toBe('undocumented');
		expect(parseTwinQuery('qual é a cobertura?')?.kind).toBe('coverage');
		expect(parseTwinQuery('tem documentação obsoleta?')?.kind).toBe('stale');
	});

	it('extrai o endpoint da pergunta', () => {
		const query = parseTwinQuery('Onde está documentado POST /payments?');
		expect(query).toMatchObject({ kind: 'where-documented', subject: 'POST /payments' });
	});

	it('pergunta desconhecida devolve nulo em vez de um palpite', () => {
		expect(parseTwinQuery('qual o sentido da vida?')).toBeNull();
	});
});

describe('regras de apoio', () => {
	it('reconhece caminho interno por prefixo', () => {
		expect(isInternal('/api/editor/file', ['/api/editor/'])).toBe(true);
		expect(isInternal('/api/publico', ['/api/editor/'])).toBe(false);
		expect(isInternal('/api/x', undefined)).toBe(false);
	});

	it('nó com origem em especificação sempre conta', () => {
		expect(countsForCoverage({ id: 'x', type: 'endpoint', name: 'GET /x', source: 'a.yaml', metadata: { internal: true } })).toBe(true);
		expect(countsForCoverage({ id: 'x', type: 'endpoint', name: 'GET /x', metadata: { internal: true } })).toBe(false);
	});

	it('endpoints documentados são os alvos de `documents`', () => {
		const graph = buildTwin({
			apis: [{ path: 'src/schemas/api.yaml', model: model([operation()]), kind: 'openapi' }],
			pages: [page('api/users.mdx', '<TryIt schema="api.yaml" operation="getUser" />')],
		});
		expect(documentedEndpoints(graph).has(twinId.endpoint('GET /api/users/{id}'))).toBe(true);
	});
});
