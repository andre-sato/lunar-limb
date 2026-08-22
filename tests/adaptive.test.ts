/**
 * Testes de Adaptive Documentation.
 *
 * O que estes testes protegem, acima de tudo, é a §12: personalização não pode
 * remover informação, quebrar navegação, depender só de aparência nem impedir
 * acesso ao conteúdo completo. Vários casos abaixo existem para que "adaptar"
 * nunca vire "esconder" numa refatoração futura.
 */

import { describe, it, expect } from 'vitest';
import {
	audiencesOf,
	contextFromCookie,
	contextFromQuery,
	contextToCookie,
	mergeContext,
	normalizeContext,
	parseAudiences,
	scoreForContext,
} from '../src/lib/adaptive/context';
import { adaptNavigation, recommendPages } from '../src/lib/adaptive/recommend';
import { parsePageMeta } from '../src/lib/adaptive/load';
import { remarkAudience } from '../src/lib/adaptive/remark-audience';
import { AUDIENCES, DEFAULT_CONTEXT, type PageContextMeta } from '../src/lib/adaptive/types';

function page(partial: Partial<PageContextMeta> = {}): PageContextMeta {
	return {
		path: 'guides/a.mdx',
		title: 'A',
		url: '/guides/a/',
		audiences: [],
		tags: [],
		products: [],
		...partial,
	};
}

// ---------------------------------------------------------------------------
// Contexto (§2, §14)
// ---------------------------------------------------------------------------

describe('normalização do contexto', () => {
	it('aceita o que conhece', () => {
		expect(normalizeContext({ audience: 'support', experience: 'advanced' })).toEqual({
			audience: 'support',
			experience: 'advanced',
		});
	});

	it('descarta valor fora da lista', () => {
		// Audiência vem do navegador de quem lê e vira chave de comparação em
		// vários lugares; texto livre aqui acabaria em página, arquivo e log.
		expect(normalizeContext({ audience: 'marketing' })).toEqual({});
		expect(normalizeContext({ experience: 'expert' })).toEqual({});
	});

	it('limita versão, produto e idioma a texto simples', () => {
		expect(normalizeContext({ version: 'v2.1' }).version).toBe('v2.1');
		expect(normalizeContext({ version: '../../etc/passwd' }).version).toBeUndefined();
		expect(normalizeContext({ version: 'x'.repeat(200) }).version).toBeUndefined();
	});

	it('entrada inválida vira contexto vazio, que é um estado legítimo', () => {
		expect(normalizeContext(null)).toEqual(DEFAULT_CONTEXT);
		expect(normalizeContext(undefined)).toEqual(DEFAULT_CONTEXT);
	});
});

describe('cookie de contexto', () => {
	it('vai e volta', () => {
		const context = { audience: 'developer' as const, experience: 'beginner' as const };
		expect(contextFromCookie(contextToCookie(context))).toEqual(context);
	});

	it('cookie corrompido é o mesmo que cookie ausente', () => {
		// Preferência de leitura quebrada não pode derrubar a página de quem só
		// queria ler documentação.
		expect(contextFromCookie('não é json')).toEqual(DEFAULT_CONTEXT);
		expect(contextFromCookie(undefined)).toEqual(DEFAULT_CONTEXT);
	});

	it('cookie com valor inválido é filtrado, não aceito', () => {
		expect(contextFromCookie(encodeURIComponent(JSON.stringify({ audience: 'root' })))).toEqual({});
	});
});

describe('precedência', () => {
	it('a query ganha do cookie', () => {
		// É o link que alguém mandou — "veja isto na visão de suporte" — e ele
		// precisa funcionar para quem já tem preferência salva.
		const merged = mergeContext(
			contextFromQuery(new URLSearchParams('audience=support')),
			{ audience: 'developer' },
			{ role: 'viewer' }
		);
		expect(merged.audience).toBe('support');
		expect(merged.role).toBe('viewer');
	});

	it('fonte vazia não apaga o que já foi definido', () => {
		expect(mergeContext({ audience: 'developer' }, undefined, {}).audience).toBe('developer');
	});
});

// ---------------------------------------------------------------------------
// Frontmatter (§4, §6)
// ---------------------------------------------------------------------------

describe('audiências declaradas', () => {
	it('lê a lista simples', () => {
		expect(parseAudiences({ audiences: ['developer', 'support'] })).toEqual([
			{ audience: 'developer', priority: 'medium' },
			{ audience: 'support', priority: 'medium' },
		]);
	});

	it('lê o mapa com prioridade', () => {
		expect(parseAudiences({ audience: { developer: { priority: 'high' }, support: { priority: 'low' } } })).toEqual([
			{ audience: 'developer', priority: 'high' },
			{ audience: 'support', priority: 'low' },
		]);
	});

	it('aceita a forma de uma audiência só', () => {
		expect(parseAudiences({ audience: 'operations' })).toEqual([{ audience: 'operations', priority: 'medium' }]);
	});

	it('ignora audiência desconhecida em vez de aceitar', () => {
		expect(parseAudiences({ audiences: ['developer', 'marketing'] })).toEqual([
			{ audience: 'developer', priority: 'medium' },
		]);
	});

	it('página sem declaração não tem audiência — e isso não é defeito', () => {
		expect(parseAudiences({ title: 'X' })).toEqual([]);
		expect(parseAudiences(undefined)).toEqual([]);
	});

	it('lê os metadados do frontmatter de verdade', () => {
		const meta = parsePageMeta(
			'guides/a.mdx',
			['---', 'title: Autenticação', 'audiences: [developer]', 'tags: [api]', 'version: v2', '---', '', 'Texto.'].join('\n')
		);

		expect(meta).toMatchObject({ title: 'Autenticação', tags: ['api'], version: 'v2', url: '/guides/a/' });
		expect(meta.audiences).toEqual([{ audience: 'developer', priority: 'medium' }]);
	});

	it('frontmatter ilegível não derruba a página, só a tira da adaptação', () => {
		const meta = parsePageMeta('a.md', '---\ntitle: [\n---\n\nTexto.');
		expect(meta.path).toBe('a.md');
		expect(meta.audiences).toEqual([]);
	});

	it('index vira a URL da pasta', () => {
		expect(parsePageMeta('guides/index.md', '---\ntitle: X\n---\n').url).toBe('/guides/');
	});
});

// ---------------------------------------------------------------------------
// Pontuação (§7, §8)
// ---------------------------------------------------------------------------

describe('pontuação por contexto', () => {
	it('audiência declarada com prioridade alta pontua mais', () => {
		const high = scoreForContext(page({ audiences: [{ audience: 'developer', priority: 'high' }] }), {
			audience: 'developer',
		});
		const low = scoreForContext(page({ audiences: [{ audience: 'developer', priority: 'low' }] }), {
			audience: 'developer',
		});
		expect(high.score).toBeGreaterThan(low.score);
	});

	it('página sem audiência não é penalizada', () => {
		// A maior parte do portal é assim; empurrá-la para baixo transformaria a
		// adaptação numa reordenação silenciosa de quase tudo.
		expect(scoreForContext(page(), { audience: 'developer' }).score).toBe(0);
	});

	it('versão diferente desce, mas continua com motivo declarado', () => {
		const detail = scoreForContext(page({ version: 'v1' }), { version: 'v2' });
		expect(detail.score).toBeLessThan(0);
		expect(detail.reasons.join(' ')).toContain('v1');
	});

	it('versão igual soma', () => {
		expect(scoreForContext(page({ version: 'v2' }), { version: 'v2' }).score).toBeGreaterThan(0);
	});

	it('cada ponto ganho vem com o motivo', () => {
		const detail = scoreForContext(page({ audiences: [{ audience: 'support', priority: 'high' }], version: 'v2' }), {
			audience: 'support',
			version: 'v2',
		});
		expect(detail.reasons.length).toBeGreaterThanOrEqual(2);
	});

	it('lista as audiências em uso no portal', () => {
		const pages = [page({ audiences: [{ audience: 'support', priority: 'medium' }] }), page({ path: 'b.md' })];
		expect(audiencesOf(pages)).toEqual(['support']);
	});

	it('a lista de audiências conhecidas é fechada', () => {
		expect(AUDIENCES).toEqual(['developer', 'support', 'product', 'operations', 'ai-agent']);
	});
});

// ---------------------------------------------------------------------------
// Navegação e recomendações (§8, §9)
// ---------------------------------------------------------------------------

describe('navegação adaptada', () => {
	const pages = new Map<string, PageContextMeta>([
		['a.md', page({ path: 'a.md' })],
		['b.md', page({ path: 'b.md', audiences: [{ audience: 'support', priority: 'high' }] })],
	]);

	it('reordena e destaca', () => {
		const adapted = adaptNavigation([{ path: 'a.md' }, { path: 'b.md' }], pages, { audience: 'support' });
		expect(adapted[0].path).toBe('b.md');
		expect(adapted[0].highlighted).toBe(true);
	});

	it('nunca remove item — a página que some é a que ninguém sabe que existe', () => {
		const adapted = adaptNavigation([{ path: 'a.md' }, { path: 'b.md' }], pages, { audience: 'support' });
		expect(adapted).toHaveLength(2);
		expect(adapted.map((item) => item.path).sort()).toEqual(['a.md', 'b.md']);
	});

	it('sem contexto, a ordem é a do projeto', () => {
		const adapted = adaptNavigation([{ path: 'a.md' }, { path: 'b.md' }], pages, {});
		expect(adapted.map((item) => item.path)).toEqual(['a.md', 'b.md']);
		expect(adapted.every((item) => !item.highlighted)).toBe(true);
	});
});

describe('recomendações', () => {
	const current = page({ path: 'guides/auth.mdx', tags: ['api', 'seguranca'] });

	const pages = [
		current,
		page({ path: 'guides/keys.mdx', title: 'Chaves', tags: ['api'] }),
		page({ path: 'guides/webhooks.mdx', title: 'Webhooks', tags: ['eventos'] }),
		page({ path: 'guides/support.mdx', title: 'Suporte', audiences: [{ audience: 'support', priority: 'high' }] }),
	];

	it('vizinha no grafo vem na frente', () => {
		const result = recommendPages({
			current,
			pages,
			context: {},
			edges: [{ from: 'guides/auth.mdx', to: 'guides/webhooks.mdx' }],
		});
		expect(result[0].path).toBe('guides/webhooks.mdx');
		expect(result[0].reason).toContain('ligada');
	});

	it('mesmo assunto conta quando não há aresta', () => {
		const result = recommendPages({ current, pages, context: {} });
		expect(result[0].path).toBe('guides/keys.mdx');
	});

	it('cada recomendação diz por que apareceu', () => {
		const result = recommendPages({ current, pages, context: {} });
		expect(result.every((item) => item.reason.length > 0)).toBe(true);
	});

	it('a página atual nunca se recomenda', () => {
		const result = recommendPages({ current, pages, context: {} });
		expect(result.some((item) => item.path === current.path)).toBe(false);
	});

	it('o contexto muda a ordem, não o conjunto de candidatas', () => {
		const neutral = recommendPages({ current, pages, context: {}, limit: 10 });
		const support = recommendPages({ current, pages, context: { audience: 'support' }, limit: 10 });
		expect(support.length).toBeGreaterThanOrEqual(neutral.length);
		expect(support[0].path).toBe('guides/support.mdx');
	});

	it('popularidade entra com teto, para não recomendar sempre as mesmas', () => {
		const popular = recommendPages({
			current,
			pages,
			context: {},
			popularity: new Map([['guides/webhooks.mdx', 10_000]]),
		});
		// Mesmo com popularidade absurda, a página de mesmo assunto continua na
		// frente: popularidade mede o que já é encontrado.
		expect(popular[0].path).toBe('guides/keys.mdx');
	});
});

// ---------------------------------------------------------------------------
// Diretiva de conteúdo (§5, §12)
// ---------------------------------------------------------------------------

describe('diretiva de audiência', () => {
	function directive(attributes: Record<string, string>) {
		return {
			type: 'containerDirective',
			name: 'audience',
			attributes,
			children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Detalhe.' }] }],
		} as Record<string, unknown>;
	}

	function run(node: Record<string, unknown>) {
		const tree = { type: 'root', children: [node] } as never;
		remarkAudience()(tree);
		return node;
	}

	it('vira um details com rótulo e marca da audiência', () => {
		const node = run(directive({ type: 'developer' })) as { data: { hName: string; hProperties: Record<string, unknown> } };
		expect(node.data.hName).toBe('details');
		expect(node.data.hProperties['data-audience']).toBe('developer');
	});

	it('nasce aberto: sem JavaScript, a página mostra tudo', () => {
		// Adaptação é melhoria progressiva. O estado inicial precisa ser o mais
		// informativo, não o mais enxuto.
		const node = run(directive({ type: 'support' })) as { data: { hProperties: Record<string, unknown> } };
		expect(node.data.hProperties.open).toBe(true);
	});

	it('o rótulo entra como summary, alcançável por teclado e leitor de tela', () => {
		const node = run(directive({ type: 'support' })) as { children: Array<{ data?: { hName?: string } }> };
		expect(node.children[0].data?.hName).toBe('summary');
	});

	it('audiência desconhecida não some com o conteúdo', () => {
		// Sumir com texto por causa de um erro de digitação no atributo seria a
		// pior falha possível para esta camada.
		const node = run(directive({ type: 'marketing' })) as { data?: unknown; children: unknown[] };
		expect(node.data).toBeUndefined();
		expect(node.children).toHaveLength(1);
	});

	it('não toca em outras diretivas', () => {
		const aside = { type: 'containerDirective', name: 'note', attributes: {}, children: [] } as Record<string, unknown>;
		expect(run(aside).data).toBeUndefined();
	});
});
