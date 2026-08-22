/**
 * Reescrita dos links internos para caminhos do bundle (issue #16).
 *
 * O corpo das páginas aponta para **rotas do portal** (`/guides/editor/`), que
 * é o certo para quem lê no site e o errado dentro de um bundle: ali o alvo é
 * `/guides/editor.md`. Sem esta tradução o bundle sai com o grafo partido —
 * cada link apontando para um lugar que não existe no material entregue — e o
 * grafo de conceitos é justamente o que o OKF entrega além de um monte de
 * markdown solto.
 *
 * A forma escolhida é a absoluta (começando com `/`), que a spec descreve como
 * estável quando documentos se movem. Link relativo sobreviveria igual, mas
 * quebraria no dia em que um conceito mudasse de diretório — e um bundle é
 * gerado justamente para ser reorganizado por quem consome.
 */

/** Rota pública → caminho no bundle. */
export type RouteMap = ReadonlyMap<string, string>;

function normalizeRoute(route: string): string {
	if (route === '') return '';
	const withLeading = route.startsWith('/') ? route : `/${route}`;
	return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

/**
 * Reescreve os links de um corpo.
 *
 * Só mexe no que reconhece. Um link para uma rota que não virou conceito —
 * `/settings/`, uma página de aplicação — fica como está: transformá-lo num
 * caminho de arquivo inexistente trocaria um link que funciona no portal por um
 * que não funciona em lugar nenhum.
 */
export function rewriteLinks(body: string, routes: RouteMap): string {
	return body.replace(/(\]\()([^)\s]+)(\))/g, (whole, open: string, href: string, close: string) => {
		// Endereço absoluto ou âncora na própria página não é link de conceito.
		if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#')) return whole;

		const hashIndex = href.indexOf('#');
		const target = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
		const hash = hashIndex >= 0 ? href.slice(hashIndex) : '';

		const mapped = routes.get(normalizeRoute(target));
		if (!mapped) return whole;

		return `${open}/${mapped}${hash}${close}`;
	});
}

/** Constrói o mapa a partir dos pares rota/caminho já conhecidos. */
export function buildRouteMap(pairs: ReadonlyArray<{ route: string; path: string }>): RouteMap {
	const map = new Map<string, string>();
	for (const pair of pairs) {
		if (pair.route === '') continue;
		map.set(normalizeRoute(pair.route), pair.path);
	}
	return map;
}
