/**
 * Navegação por produto (issue #18).
 *
 * O que estes testes protegem, em ordem de gravidade do que aconteceria se
 * quebrassem:
 *
 * **Página compartilhada não pode sumir.** A maior parte da documentação não é
 * de produto nenhum — primeiros passos, glossário, autenticação. Se a ausência
 * de `products` no frontmatter passar a significar "não pertence a nenhum
 * produto" em vez de "pertence a todos", a escolha de um produto esvazia o
 * portal. É o defeito mais caro possível aqui, e o mais fácil de introduzir
 * numa refatoração distraída.
 *
 * **A URL do mapa tem de ser a URL da navegação.** A filtragem casa o `href` do
 * link com a chave do mapa. Uma página com `slug` no frontmatter, ou sob um
 * prefixo de idioma, é publicada num endereço que não é o caminho do arquivo —
 * e um mapa construído a partir do caminho erra silenciosamente: não esconde
 * nada, e ninguém descobre até alguém reclamar que o filtro "não funciona".
 *
 * **Produto desconhecido precisa gritar.** Um erro de digitação em `products:`
 * tira a página da navegação de todos os produtos, porque ela passa a pertencer
 * a um produto que não existe no seletor. O sintoma aparece longe da causa.
 */

import { describe, expect, it } from 'vitest';
import { buildRegistry, EMPTY_REGISTRY } from '../src/lib/products/registry';
import { belongsToProduct, normalizeHref, unknownProducts } from '../src/lib/products/scope';
import { parsePageMeta } from '../src/lib/adaptive/load';
import { pageUrlFor } from '../src/lib/editor/page-url';
import { groupByProduct } from '../src/lib/changelog/render';
import { productFor } from '../src/lib/changelog/classify';
import type { ChangelogEntry } from '../src/lib/changelog/types';

// ---------------------------------------------------------------------------
// Registro
// ---------------------------------------------------------------------------

describe('registro de produtos', () => {
	it('aceita o que tem id utilizável', () => {
		const registry = buildRegistry([
			{ id: 'portal', label: 'Portal' },
			{ id: 'payments', label: 'Pagamentos' },
		]);

		expect(registry.products.map((product) => product.id)).toEqual(['portal', 'payments']);
		expect(registry.byId.get('payments')?.label).toBe('Pagamentos');
	});

	it('recusa id que não sobreviveria à normalização do contexto', () => {
		// O produto vindo do cookie passa por `/^[A-Za-z0-9._-]+$/` em
		// `normalizeContext`. Um id fora desse alfabeto nunca casaria com a escolha
		// do leitor, e uma página presa a ele ficaria invisível para sempre.
		const registry = buildRegistry([
			{ id: 'com espaço', label: 'A' },
			{ id: 'acentuação', label: 'B' },
			{ id: 'a'.repeat(41), label: 'C' },
			{ id: 'valido-1.0', label: 'D' },
		]);

		expect(registry.products.map((product) => product.id)).toEqual(['valido-1.0']);
	});

	it('fica com a primeira declaração quando o id repete', () => {
		const registry = buildRegistry([
			{ id: 'portal', label: 'Primeiro' },
			{ id: 'portal', label: 'Segundo' },
		]);

		expect(registry.products).toHaveLength(1);
		expect(registry.byId.get('portal')?.label).toBe('Primeiro');
	});
});

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

describe('produtos declarados pela página', () => {
	it('lê a lista', () => {
		const meta = parsePageMeta(
			'guides/a.mdx',
			['---', 'title: A', 'products: [portal, payments]', '---', 'corpo'].join('\n')
		);

		expect(meta.products).toEqual(['portal', 'payments']);
	});

	it('continua aceitando o campo escalar que já existia', () => {
		const meta = parsePageMeta(
			'guides/a.mdx',
			['---', 'title: A', 'product: portal', '---', 'corpo'].join('\n')
		);

		expect(meta.products).toEqual(['portal']);
		// O escalar continua exposto: a pontuação da adaptação lê `product`.
		expect(meta.product).toBe('portal');
	});

	it('junta as duas formas sem repetir', () => {
		const meta = parsePageMeta(
			'guides/a.mdx',
			['---', 'title: A', 'product: portal', 'products: [portal, payments]', '---'].join('\n')
		);

		expect(meta.products).toEqual(['portal', 'payments']);
	});

	it('página sem o campo é compartilhada, não órfã', () => {
		const meta = parsePageMeta('guides/a.mdx', ['---', 'title: A', '---', 'corpo'].join('\n'));

		expect(meta.products).toEqual([]);
		expect(belongsToProduct(meta.products, 'portal')).toBe(true);
		expect(belongsToProduct(meta.products, 'payments')).toBe(true);
	});
});

describe('pertencimento', () => {
	it('sem produto escolhido, tudo pertence', () => {
		expect(belongsToProduct(['payments'], undefined)).toBe(true);
		expect(belongsToProduct(['payments'], '')).toBe(true);
	});

	it('página de outro produto não pertence', () => {
		expect(belongsToProduct(['payments'], 'portal')).toBe(false);
	});

	it('página de vários produtos pertence a cada um deles', () => {
		expect(belongsToProduct(['portal', 'payments'], 'portal')).toBe(true);
		expect(belongsToProduct(['portal', 'payments'], 'payments')).toBe(true);
		expect(belongsToProduct(['portal', 'payments'], 'billing')).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// URL
// ---------------------------------------------------------------------------

describe('a URL do mapa é a URL publicada', () => {
	it('respeita `slug` do frontmatter', () => {
		// O mapa é construído com `pageUrlFor(path, { slug })`. Sem o slug, a chave
		// seria `/guides/auth/` e o link da navegação apontaria para
		// `/autenticacao/` — o filtro não casaria e não esconderia nada.
		expect(pageUrlFor('guides/auth.md', { slug: 'autenticacao' })).toBe('/autenticacao/');
	});

	it('preserva o prefixo de idioma', () => {
		expect(pageUrlFor('en/guides/auth.md')).toBe('/en/guides/auth/');
	});

	it('trata index como raiz da pasta', () => {
		expect(pageUrlFor('guides/index.mdx')).toBe('/guides/');
	});
});

describe('normalização de href', () => {
	it('casa as formas que a navegação produz', () => {
		expect(normalizeHref('/guides/auth/')).toBe('/guides/auth/');
		expect(normalizeHref('/guides/auth')).toBe('/guides/auth/');
		expect(normalizeHref('https://portal.exemplo/guides/auth/')).toBe('/guides/auth/');
		expect(normalizeHref('/guides/auth/?x=1#topo')).toBe('/guides/auth/');
	});

	it('href vazio vira a raiz em vez de string vazia', () => {
		expect(normalizeHref('')).toBe('/');
	});
});

// ---------------------------------------------------------------------------
// Produto desconhecido
// ---------------------------------------------------------------------------

describe('produto declarado que não existe', () => {
	const registry = buildRegistry([{ id: 'portal', label: 'Portal' }]);

	it('é apontado com a página e o produto', () => {
		const problems = unknownProducts(
			[
				{ path: 'guides/a.mdx', products: ['portal'] },
				{ path: 'guides/b.mdx', products: ['paymnets'] },
			],
			registry
		);

		expect(problems).toEqual([{ path: 'guides/b.mdx', product: 'paymnets' }]);
	});

	it('cala quando não há produto declarado no registro', () => {
		// Portal sem produtos não é portal com tudo errado: acusar cada página
		// encheria o build de aviso para quem ainda nem usa a funcionalidade.
		expect(unknownProducts([{ path: 'guides/a.mdx', products: ['portal'] }], EMPTY_REGISTRY)).toEqual(
			[]
		);
	});
});

// ---------------------------------------------------------------------------
// Changelog
// ---------------------------------------------------------------------------

function entry(partial: Partial<ChangelogEntry> = {}): ChangelogEntry {
	return {
		commit: 'abc1234',
		date: '2026-08-01',
		category: 'feature',
		text: 'algo',
		original: 'feat: algo',
		breaking: false,
		endpoints: [],
		...partial,
	};
}

describe('produto de um commit', () => {
	it('vem do escopo quando o escopo é um produto', () => {
		expect(productFor('payments', ['portal', 'payments'])).toBe('payments');
	});

	it('escopo que não é produto continua sendo só escopo', () => {
		// `feat(editor)` é sobre o editor, que é parte do portal e não um produto.
		// Inventar produto a partir de escopo livre criaria seções que não
		// correspondem a nada no seletor.
		expect(productFor('editor', ['portal', 'payments'])).toBeUndefined();
	});

	it('sem escopo não há produto', () => {
		expect(productFor(undefined, ['portal'])).toBeUndefined();
	});
});

describe('agrupamento do changelog', () => {
	it('mantém as entradas sem produto primeiro e sem subtítulo', () => {
		const groups = groupByProduct([
			entry({ product: 'payments', text: 'b' }),
			entry({ text: 'transversal' }),
		]);

		expect(groups[0]?.product).toBeUndefined();
		expect(groups[0]?.entries[0]?.text).toBe('transversal');
		expect(groups[1]?.product).toBe('payments');
	});

	it('ordena os produtos por id, não por ordem no histórico', () => {
		// O mesmo mês precisa render o mesmo documento independentemente da ordem
		// em que os commits foram lidos.
		const groups = groupByProduct([
			entry({ product: 'portal' }),
			entry({ product: 'billing' }),
			entry({ product: 'payments' }),
		]);

		expect(groups.map((group) => group.product)).toEqual(['billing', 'payments', 'portal']);
	});

	it('um changelog sem produto nenhum continua sendo um grupo só', () => {
		const groups = groupByProduct([entry(), entry({ text: 'outro' })]);

		expect(groups).toHaveLength(1);
		expect(groups[0]?.product).toBeUndefined();
	});
});
