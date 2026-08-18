/**
 * Testes do Documentation Impact Engine.
 *
 * O que se testa aqui é o **julgamento** do motor: dado o que mudou e quem
 * depende do que mudou, o que ele classifica como crítico, o que ele considera
 * ruído, e por onde ele diz que o impacto passou. Nada de Git e nada de disco —
 * essa parte é do `engine.ts`, e mantê-la fora é o que permite testar as regras
 * uma a uma em vez de só de ponta a ponta.
 */

import { describe, it, expect } from 'vitest';
import { diffApiModels, touchedOperations } from '../src/lib/impact/api-diff';
import { buildImpactGraph, dependentsOf, mentionsTerm, pageId, snippetId } from '../src/lib/impact/graph';
import { analyzeImpact, buildChecklist, scopeFor, scoreImpact, severityForDependent } from '../src/lib/impact/analyze';
import { classifyPath } from '../src/lib/impact/engine';
import type { ContentGraph } from '../src/lib/editor/graph-model';
import type { ApiModel, ApiOperation } from '../src/lib/api-explorer/model';
import type { GlossDef } from '../src/lib/glossary/types';
import type { Change } from '../src/lib/impact/types';

// ---------------------------------------------------------------------------
// Ajudantes
// ---------------------------------------------------------------------------

function operation(partial: Partial<ApiOperation> = {}): ApiOperation {
	return {
		id: 'getUser',
		method: 'get',
		path: '/users/{id}',
		tags: [],
		parameters: [{ name: 'id', location: 'path', required: true, type: 'string' }],
		responses: [{ status: '200', description: 'ok' }],
		security: [],
		deprecated: false,
		...partial,
	};
}

function model(operations: ApiOperation[], partial: Partial<ApiModel> = {}): ApiModel {
	return { title: 'API', version: '1.0.0', servers: ['/api'], operations, securitySchemes: [], ...partial };
}

/** Grafo de conteúdo: páginas e blocos, com quem inclui quem. */
function contentGraph(
	pages: string[],
	snippets: string[],
	uses: Array<[string, string, 'block' | 'page']>
): ContentGraph {
	const location = { line: 1, column: 1, offset: 0 };

	return {
		nodes: [
			...pages.map((path) => ({
				key: `docs:${path}`,
				id: path.replace(/\.mdx?$/, ''),
				type: 'page' as const,
				root: 'docs' as const,
				path,
			})),
			...snippets.map((path) => ({
				key: `snippets:${path}`,
				id: path.replace(/\.mdx?$/, ''),
				type: 'block' as const,
				root: 'snippets' as const,
				path,
			})),
		],
		edges: uses.map(([source, target, refType]) => ({
			source,
			sourceId: source.split(':')[1].replace(/\.mdx?$/, ''),
			target,
			type: 'uses' as const,
			refType,
			resolved: true,
			location,
		})),
		generatedAt: 0,
	};
}

function term(partial: Partial<GlossDef> = {}): GlossDef {
	return {
		id: 'api-key',
		term: 'API Key',
		aliases: ['chave de API'],
		definition: 'Credencial.',
		enabled: true,
		caseSensitive: false,
		matchWholeWord: true,
		deprecated: ['token de acesso'],
		...partial,
	};
}

// ---------------------------------------------------------------------------
// Diff de API (§6)
// ---------------------------------------------------------------------------

describe('diff de API', () => {
	it('operação removida é quebra', () => {
		const changes = diffApiModels(model([operation()]), model([]));
		expect(changes[0]).toMatchObject({ type: 'operation-removed', breaking: true });
	});

	it('operação nova não quebra ninguém', () => {
		const changes = diffApiModels(model([]), model([operation()]));
		expect(changes[0]).toMatchObject({ type: 'operation-added', breaking: false });
	});

	it('reconhece renome de parâmetro em vez de dizer removeu e adicionou', () => {
		// O caso da spec: `id` → `userId`. Uma linha no diff, quebra total.
		const before = model([operation()]);
		const after = model([
			operation({ parameters: [{ name: 'userId', location: 'path', required: true, type: 'string' }] }),
		]);

		const changes = diffApiModels(before, after);
		expect(changes).toHaveLength(1);
		expect(changes[0]).toMatchObject({ type: 'parameter-renamed', breaking: true });
		expect(changes[0].message).toContain('userId');
	});

	it('não inventa renome quando o parâmetro novo é diferente do que saiu', () => {
		const before = model([operation()]);
		const after = model([
			operation({ parameters: [{ name: 'filtro', location: 'query', required: false, type: 'string' }] }),
		]);

		const types = diffApiModels(before, after).map((change) => change.type);
		expect(types).toContain('parameter-removed');
		expect(types).toContain('parameter-added');
		expect(types).not.toContain('parameter-renamed');
	});

	it('parâmetro novo obrigatório quebra; opcional não', () => {
		const withRequired = diffApiModels(
			model([operation()]),
			model([
				operation({
					parameters: [
						{ name: 'id', location: 'path', required: true, type: 'string' },
						{ name: 'escopo', location: 'query', required: true, type: 'string' },
					],
				}),
			])
		);
		expect(withRequired[0].breaking).toBe(true);

		const withOptional = diffApiModels(
			model([operation()]),
			model([
				operation({
					parameters: [
						{ name: 'id', location: 'path', required: true, type: 'string' },
						{ name: 'escopo', location: 'query', required: false, type: 'string' },
					],
				}),
			])
		);
		expect(withOptional[0].breaking).toBe(false);
	});

	it('tornar obrigatório quebra; tornar opcional não', () => {
		const parameters = (required: boolean) => [{ name: 'id', location: 'query' as const, required, type: 'string' }];

		expect(
			diffApiModels(model([operation({ parameters: parameters(false) })]), model([operation({ parameters: parameters(true) })]))[0]
		).toMatchObject({ type: 'parameter-required', breaking: true });

		expect(
			diffApiModels(model([operation({ parameters: parameters(true) })]), model([operation({ parameters: parameters(false) })]))[0]
		).toMatchObject({ type: 'parameter-optional', breaking: false });
	});

	it('mudança de tipo quebra', () => {
		const changes = diffApiModels(
			model([operation()]),
			model([operation({ parameters: [{ name: 'id', location: 'path', required: true, type: 'integer' }] })])
		);
		expect(changes[0]).toMatchObject({ type: 'parameter-type', breaking: true });
	});

	it('mudança de autenticação quebra', () => {
		const changes = diffApiModels(
			model([operation()]),
			model([operation({ security: [{ id: 'bearerAuth', kind: 'http-bearer' }] })])
		);
		expect(changes.find((change) => change.type === 'security-changed')).toMatchObject({ breaking: true });
	});

	it('URL base diferente quebra: o exemplo publicado aponta para o lugar errado', () => {
		const changes = diffApiModels(model([operation()]), model([operation()], { servers: ['https://outro.exemplo'] }));
		expect(changes.find((change) => change.type === 'server-changed')).toMatchObject({ breaking: true });
	});

	it('resposta 2xx que sai de cena quebra; 4xx não', () => {
		const withoutSuccess = diffApiModels(
			model([operation()]),
			model([operation({ responses: [{ status: '404', description: 'não encontrado' }] })])
		);
		expect(withoutSuccess.find((change) => change.type === 'response-removed')).toMatchObject({ breaking: true });

		const withoutError = diffApiModels(
			model([operation({ responses: [{ status: '200', description: 'ok' }, { status: '404', description: 'x' }] })]),
			model([operation()])
		);
		expect(withoutError.find((change) => change.type === 'response-removed')).toMatchObject({ breaking: false });
	});

	it('depreciar avisa sem quebrar', () => {
		const changes = diffApiModels(model([operation()]), model([operation({ deprecated: true })]));
		expect(changes[0]).toMatchObject({ type: 'operation-deprecated', breaking: false });
	});

	it('nada mudou, nada é reportado', () => {
		expect(diffApiModels(model([operation()]), model([operation()]))).toEqual([]);
	});

	it('lista as operações tocadas sem repetição', () => {
		const changes = diffApiModels(
			model([operation()]),
			model([operation({ parameters: [], responses: [{ status: '201', description: 'criado' }] })])
		);
		expect(touchedOperations(changes)).toEqual(['GET /users/{id}']);
	});
});

// ---------------------------------------------------------------------------
// Travessia (§7)
// ---------------------------------------------------------------------------

describe('dependências', () => {
	// Página A inclui o bloco `aviso`; o bloco `aviso` inclui o bloco `base`.
	const graph = buildImpactGraph({
		graph: contentGraph(
			['guides/a.mdx', 'guides/b.mdx'],
			['aviso.md', 'base.md'],
			[
				['docs:guides/a.mdx', 'aviso', 'block'],
				['snippets:aviso.md', 'base', 'block'],
			]
		),
	});

	it('encontra o consumidor direto', () => {
		const found = dependentsOf(graph, snippetId('aviso'));
		expect(found.map((item) => item.id)).toContain(pageId('guides/a.mdx'));
	});

	it('encontra o consumidor indireto e mostra por onde passou', () => {
		// É o caso em que um motor de um salto responde "nenhuma página afetada"
		// com convicção e está errado.
		const found = dependentsOf(graph, snippetId('base'));
		const page = found.find((item) => item.id === pageId('guides/a.mdx'));
		expect(page).toBeDefined();
		expect(page!.via).toEqual([pageId('guides/a.mdx'), snippetId('aviso'), snippetId('base')]);
	});

	it('página que não inclui nada não aparece', () => {
		expect(dependentsOf(graph, snippetId('aviso')).map((item) => item.id)).not.toContain(pageId('guides/b.mdx'));
	});

	it('inclusão circular não trava a travessia', () => {
		const circular = buildImpactGraph({
			graph: contentGraph(
				[],
				['x.md', 'y.md'],
				[
					['snippets:x.md', 'y', 'block'],
					['snippets:y.md', 'x', 'block'],
				]
			),
		});
		expect(dependentsOf(circular, snippetId('x')).length).toBeLessThanOrEqual(2);
	});
});

describe('menção a termo do glossário', () => {
	it('encontra o termo canônico dobrando acento e caixa', () => {
		expect(mentionsTerm('Use a api key no header.', term())).toBe(true);
		// A dobra vale nos dois sentidos: o termo cadastrado com acento encontra a
		// página que escreveu sem, e vice-versa. É o mesmo cuidado que o glossário
		// já tem, e sem ele o motor perderia exatamente as páginas de português.
		const auth = term({ term: 'Autenticação', aliases: [], deprecated: [] });
		expect(mentionsTerm('Sobre autenticacao de API', auth)).toBe(true);
		expect(mentionsTerm('Sobre autenticação de API', auth)).toBe(true);
		expect(mentionsTerm('Sobre autorização de API', auth)).toBe(false);
	});

	it('encontra pelos aliases e pelas grafias desaconselhadas', () => {
		// São justamente as páginas que escrevem o termo "errado" — as que mais
		// precisam de revisão quando a terminologia muda.
		expect(mentionsTerm('Informe a chave de API.', term())).toBe(true);
		expect(mentionsTerm('Use seu token de acesso.', term())).toBe(true);
	});

	it('respeita palavra inteira', () => {
		expect(mentionsTerm('apikeys não conta', term({ term: 'api', aliases: [], deprecated: [] }))).toBe(false);
		expect(mentionsTerm('a api responde', term({ term: 'api', aliases: [], deprecated: [] }))).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Classificação (§5)
// ---------------------------------------------------------------------------

describe('severidade por distância', () => {
	it('consumidor direto herda a gravidade da origem', () => {
		expect(severityForDependent('critical', 1)).toBe('critical');
	});

	it('cai um nível por salto: longe da origem, provavelmente só menciona', () => {
		expect(severityForDependent('critical', 2)).toBe('high');
		expect(severityForDependent('critical', 3)).toBe('medium');
	});

	it('nunca desce abaixo de baixo', () => {
		expect(severityForDependent('low', 9)).toBe('low');
	});
});

describe('análise', () => {
	const graph = buildImpactGraph({
		graph: contentGraph(
			['guides/a.mdx', 'guides/b.mdx'],
			['aviso.md', 'base.md'],
			[
				['docs:guides/a.mdx', 'aviso', 'block'],
				['docs:guides/b.mdx', 'aviso', 'block'],
				['snippets:aviso.md', 'base', 'block'],
			]
		),
	});

	const snippetChange: Change = { kind: 'snippet', path: 'src/content/snippets/aviso.md', status: 'modified' };

	it('bloco alterado aponta as páginas consumidoras', () => {
		const report = analyzeImpact({ graph, changes: [snippetChange] });
		expect(report.items.map((item) => item.node.path).sort()).toEqual([
			'src/content/docs/guides/a.mdx',
			'src/content/docs/guides/b.mdx',
		]);
	});

	it('as páginas afetadas são marcadas como não visíveis no diff', () => {
		const report = analyzeImpact({ graph, changes: [snippetChange] });
		expect(report.items.every((item) => item.hidden)).toBe(true);
	});

	it('página que também foi editada não é marcada como escondida', () => {
		const report = analyzeImpact({
			graph,
			changes: [snippetChange, { kind: 'page', path: 'src/content/docs/guides/a.mdx', status: 'modified' }],
		});
		const edited = report.items.find((item) => item.node.path === 'src/content/docs/guides/a.mdx');
		expect(edited?.hidden).toBe(false);
	});

	it('bloco removido é crítico; alterado é alto', () => {
		const removed = analyzeImpact({ graph, changes: [{ ...snippetChange, status: 'removed' }] });
		expect(removed.highest).toBe('critical');

		const modified = analyzeImpact({ graph, changes: [snippetChange] });
		expect(modified.highest).toBe('high');
	});

	it('dependência indireta entra com severidade menor e caminho registrado', () => {
		const report = analyzeImpact({
			graph,
			changes: [{ kind: 'snippet', path: 'src/content/snippets/base.md', status: 'modified' }],
		});
		const item = report.items[0];
		expect(item.via.length).toBeGreaterThan(2);
		expect(item.severity).toBe('medium');
		expect(item.reason).toContain('níveis');
	});

	it('uma página aparece uma única vez, com a severidade mais alta', () => {
		// `guides/a.mdx` depende de `aviso` (direto) e de `base` (indireto).
		const report = analyzeImpact({
			graph,
			changes: [snippetChange, { kind: 'snippet', path: 'src/content/snippets/base.md', status: 'modified' }],
		});
		const occurrences = report.items.filter((item) => item.node.path === 'src/content/docs/guides/a.mdx');
		expect(occurrences).toHaveLength(1);
		expect(occurrences[0].severity).toBe('high');
	});

	it('mudança sem consequência não gera item nem score', () => {
		const report = analyzeImpact({ graph, changes: [{ kind: 'other', path: 'astro.config.mjs', status: 'modified' }] });
		expect(report.items).toEqual([]);
		expect(report.score.value).toBe(0);
		expect(report.scope).toBe('trivial');
	});

	it('endpoint removido chega às páginas que o documentam', () => {
		const withApi = buildImpactGraph({
			graph: contentGraph(['api-reference/users.mdx'], [], []),
			apis: [{ path: 'src/schemas/portal-api.yaml', model: model([operation()]) }],
			documents: [{ page: 'api-reference/users.mdx', operation: 'GET /users/{id}' }],
		});

		const report = analyzeImpact({
			graph: withApi,
			changes: [{ kind: 'api', path: 'src/schemas/portal-api.yaml', status: 'modified' }],
			apiChanges: diffApiModels(model([operation()]), model([])),
		});

		expect(report.items[0]).toMatchObject({ severity: 'critical' });
		expect(report.items[0].node.path).toBe('src/content/docs/api-reference/users.mdx');
		expect(report.api.breaking).toHaveLength(1);
	});

	it('termo do glossário renomeado alcança as páginas que o mencionam', () => {
		const withGlossary = buildImpactGraph({
			graph: contentGraph(['guides/auth.mdx'], [], []),
			glossary: [term()],
			pageBodies: new Map([['guides/auth.mdx', 'Use a chave de API no header.']]),
		});

		const report = analyzeImpact({
			graph: withGlossary,
			changes: [{ kind: 'glossary', path: 'src/content/glossary/api-key.md', status: 'modified' }],
			glossaryChanges: [{ id: 'api-key', term: 'API Key', renamed: true, removed: false }],
		});

		expect(report.items).toHaveLength(1);
		expect(report.glossaryTerms).toEqual(['API Key']);
	});
});

// ---------------------------------------------------------------------------
// Score e escopo (§12)
// ---------------------------------------------------------------------------

describe('impact score', () => {
	const item = (severity: 'critical' | 'high' | 'medium' | 'low', via = 2) => ({
		node: { id: 'page:x', type: 'page' as const, path: 'x.mdx' },
		severity,
		reason: '',
		origin: '',
		via: Array.from({ length: via }, (_, index) => `n${index}`),
		hidden: true,
	});

	it('cada fator diz quanto somou e por quê', () => {
		const score = scoreImpact({ changes: [], items: [item('critical')] });
		expect(score.factors.length).toBeGreaterThan(0);
		expect(score.factors.every((factor) => factor.detail !== '')).toBe(true);
		expect(score.value).toBe(score.factors.reduce((sum, factor) => sum + factor.points, 0));
	});

	it('crítico pesa mais que médio', () => {
		const critical = scoreImpact({ changes: [], items: [item('critical')] }).value;
		const medium = scoreImpact({ changes: [], items: [item('medium')] }).value;
		expect(critical).toBeGreaterThan(medium);
	});

	it('quebra de contrato de API entra no score', () => {
		const withBreaking = scoreImpact({
			changes: [],
			items: [],
			apiChanges: [{ type: 'operation-removed', subject: 'GET /x', message: '', breaking: true }],
		});
		expect(withBreaking.factors.some((factor) => factor.name.includes('API'))).toBe(true);
	});

	it('nunca passa de 100', () => {
		const many = Array.from({ length: 60 }, () => item('critical', 4));
		expect(scoreImpact({ changes: [], items: many }).value).toBeLessThanOrEqual(100);
	});

	it('nada mudou, score zero', () => {
		expect(scoreImpact({ changes: [], items: [] }).value).toBe(0);
	});

	it('escopo cresce com o score e com o número de itens', () => {
		expect(scopeFor(0, 0)).toBe('trivial');
		expect(scopeFor(10, 2)).toBe('small');
		expect(scopeFor(35, 3)).toBe('medium');
		expect(scopeFor(5, 20)).toBe('large');
	});
});

// ---------------------------------------------------------------------------
// Checklist (§11)
// ---------------------------------------------------------------------------

describe('checklist', () => {
	const pageItem = {
		node: { id: 'page:guides/a', type: 'page' as const, path: 'src/content/docs/guides/a.mdx' },
		severity: 'high' as const,
		reason: 'inclui o bloco `aviso`, que foi alterado.',
		origin: 'src/content/snippets/aviso.md',
		via: ['page:guides/a', 'snippet:aviso'],
		hidden: true,
	};

	it('cada item nomeia um arquivo conferível', () => {
		const checklist = buildChecklist({ changes: [], items: [pageItem] });
		expect(checklist[0].label).toContain('guides/a.mdx');
		expect(checklist[0].target).toBe('src/content/docs/guides/a.mdx');
	});

	it('impacto baixo não entra: item que não se marca treina a ignorar o checklist', () => {
		const checklist = buildChecklist({ changes: [], items: [{ ...pageItem, severity: 'low' }] });
		expect(checklist).toEqual([]);
	});

	it('quebra de API pede a conferência da referência e os testes', () => {
		const checklist = buildChecklist({
			changes: [],
			items: [],
			apiChanges: [{ type: 'operation-removed', subject: 'GET /x', message: '', breaking: true }],
		});
		expect(checklist.some((entry) => entry.label.includes('incompatível'))).toBe(true);
		expect(checklist.some((entry) => entry.label.includes('testes de documentação'))).toBe(true);
	});

	it('termo alterado pede a conferência das ocorrências', () => {
		const checklist = buildChecklist({ changes: [], items: [], glossaryChanges: [{ id: 'api-key', term: 'API Key' }] });
		expect(checklist[0].label).toContain('API Key');
	});

	it('nada a fazer, checklist vazio — e não um item genérico', () => {
		expect(buildChecklist({ changes: [], items: [] })).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Classificação de caminho (§3)
// ---------------------------------------------------------------------------

describe('classificação do arquivo alterado', () => {
	it('reconhece cada fonte de mudança', () => {
		expect(classifyPath('src/content/docs/guides/a.mdx')).toBe('page');
		expect(classifyPath('src/content/snippets/aviso.md')).toBe('snippet');
		expect(classifyPath('src/content/glossary/api-key.md')).toBe('glossary');
		expect(classifyPath('src/schemas/portal-api.yaml')).toBe('api');
		expect(classifyPath('versions.yml')).toBe('version');
		expect(classifyPath('astro.config.mjs')).toBe('other');
	});

	it('caminho do Windows é normalizado', () => {
		expect(classifyPath('src\\content\\docs\\guides\\a.mdx')).toBe('page');
	});

	it('arquivo que não é conteúdo dentro de docs não é página', () => {
		expect(classifyPath('src/content/docs/imagem.png')).toBe('other');
	});
});
