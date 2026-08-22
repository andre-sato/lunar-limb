/**
 * De que produto é cada URL (issue #18).
 *
 * A filtragem acontece no navegador — as páginas de documentação são
 * pré-renderizadas (ver docs/adr/0003-renderizacao-hibrida.md), então não há
 * requisição por leitor em que o servidor pudesse decidir o que mostrar. O que o
 * servidor faz é publicar **o mapa**: URL pública → produtos. O script do
 * cliente lê o mapa, lê a escolha do leitor e esconde o que não pertence.
 *
 * Duas decisões que o mapa carrega:
 *
 * **URL ausente do mapa é compartilhada.** As páginas geradas de OpenAPI, a
 * capa, qualquer coisa fora de `src/content/docs` não declaram produto e não
 * podem sumir por isso. O fallback é permissivo de propósito: uma página a mais
 * na navegação é um incômodo, uma página a menos é conteúdo perdido.
 *
 * **Lista vazia também é compartilhada.** É o mesmo caso escrito de outro jeito,
 * e vale declarar porque a diferença entre "não declarou" e "declarou nenhum"
 * seria uma sutileza sem valor para quem escreve documentação.
 */

import { getAdaptiveIndex } from '../adaptive/load';
import { pageUrlFor } from '../editor/page-url';
import { loadProducts, type ProductRegistry } from './registry';

/** URL pública → produtos declarados. URL fora do mapa é compartilhada. */
export type ProductScopeMap = Record<string, string[]>;

/**
 * Monta o mapa a partir do índice de frontmatter que a adaptação já mantém em
 * memória. Só entram as páginas que declararam produto: publicar as demais com
 * lista vazia dobraria o tamanho do JSON para dizer o que a ausência já diz.
 */
let cache: ProductScopeMap | null = null;

export async function buildScopeMap(): Promise<ProductScopeMap> {
	// O mapa é o mesmo para todas as páginas, e o componente que o publica renderiza
	// em cada uma delas. Sem cache, um build de cem páginas montaria cem vezes o
	// mesmo objeto — e imprimiria cem vezes o mesmo aviso de produto desconhecido,
	// que é como um aviso útil vira ruído que ninguém lê.
	if (cache) return cache;

	const index = await getAdaptiveIndex();
	const registry = await loadProducts();
	const map: ProductScopeMap = {};

	for (const page of index.pages) {
		if (page.products.length === 0) continue;
		// `pageUrlFor` e não a URL do índice: ele respeita `slug` no frontmatter e
		// o prefixo de idioma, e é essa URL que aparece no `href` da navegação.
		// Casar por uma URL que a navegação não usa esconderia nada, em silêncio.
		map[pageUrlFor(page.path, { slug: page.slug })] = page.products;
	}

	for (const problem of unknownProducts(index.pages, registry)) {
		console.warn(
			`[products] ${problem.path} declara \`${problem.product}\`, que não está em organization.yml. ` +
				'A página não vai aparecer na navegação de nenhum produto.'
		);
	}

	cache = map;
	return map;
}

/**
 * Descarta o mapa, para quem precise remontá-lo sem reiniciar o processo.
 *
 * Espelha `invalidateAdaptiveCache`, e tem a mesma ressalva: o mapa é montado a
 * partir do índice adaptativo, então invalidar só este deixa o índice velho no
 * lugar. Quem quiser reler o disco precisa invalidar os dois.
 */
export function invalidateScopeCache(): void {
	cache = null;
}

/**
 * Páginas que declaram produto inexistente (issue #18).
 *
 * Este é o modo de falha que a funcionalidade introduz e que ninguém percebe
 * sozinho: um `products: [paymnets]` com erro de digitação não quebra o build,
 * não muda a página, e simplesmente tira o guia da navegação de todo mundo —
 * porque ele passa a pertencer a um produto que nenhum leitor pode selecionar.
 *
 * O sintoma ("sumiu da navegação") aparece longe da causa ("faltou uma letra no
 * frontmatter"), e é exatamente por isso que o build precisa dizer.
 */
export function unknownProducts(
	pages: readonly { path: string; products: string[] }[],
	registry: ProductRegistry
): Array<{ path: string; product: string }> {
	// Registro vazio significa portal sem produtos declarados, não portal com
	// tudo errado: aí `products:` no frontmatter é adiantamento de quem vai
	// declarar depois, e acusar cada página seria ruído em todo build.
	if (registry.products.length === 0) return [];

	const problems: Array<{ path: string; product: string }> = [];
	for (const page of pages) {
		for (const product of page.products) {
			if (!registry.byId.has(product)) problems.push({ path: page.path, product });
		}
	}
	return problems;
}

/** Normaliza para comparar `href` da navegação com chave do mapa. */
export function normalizeHref(href: string): string {
	const withoutOrigin = href.replace(/^https?:\/\/[^/]+/i, '');
	const withoutQuery = withoutOrigin.split(/[?#]/)[0] ?? '';
	if (withoutQuery === '') return '/';
	const withLeading = withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`;
	return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

/**
 * A página pertence ao produto ativo?
 *
 * Sem produto escolhido, tudo pertence — o padrão do portal é a documentação
 * inteira, e exigir uma escolha para navegar seria uma porteira na entrada.
 */
export function belongsToProduct(
	products: readonly string[] | undefined,
	active: string | undefined
): boolean {
	if (!active) return true;
	if (!products || products.length === 0) return true;
	return products.includes(active);
}
