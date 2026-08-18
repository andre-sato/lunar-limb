/**
 * Provedor de busca.
 *
 * O portal usa o **Algolia DocSearch** quando as três credenciais estão no
 * ambiente, e o Pagefind quando não estão. A escolha é por ambiente, e não por
 * código, porque as credenciais são suas: elas não entram no repositório.
 *
 *   ALGOLIA_APP_ID
 *   ALGOLIA_SEARCH_API_KEY   (a chave **Search-Only**, que é pública)
 *   ALGOLIA_INDEX_NAME
 *
 * A chave de busca do Algolia é feita para ir ao navegador — é o par que o
 * widget usa para consultar o índice. A chave de **Admin** nunca deve ser usada
 * aqui: ela escreve no índice, e o widget é código que qualquer visitante lê.
 */

function read(name: string): string {
	return (process.env[name] ?? '').trim();
}

export interface AlgoliaCredentials {
	appId: string;
	apiKey: string;
	indexName: string;
}

/** Credenciais completas, ou `null` quando falta alguma. */
export function algoliaCredentials(): AlgoliaCredentials | null {
	const appId = read('ALGOLIA_APP_ID');
	const apiKey = read('ALGOLIA_SEARCH_API_KEY');
	const indexName = read('ALGOLIA_INDEX_NAME');

	// Tudo ou nada: com uma credencial faltando, o widget carrega e falha na
	// primeira busca. Melhor manter o Pagefind, que funciona.
	if (!appId || !apiKey || !indexName) return null;

	return { appId, apiKey, indexName };
}

export type SearchProvider = 'algolia' | 'pagefind';

export const searchProvider: SearchProvider = algoliaCredentials() ? 'algolia' : 'pagefind';
