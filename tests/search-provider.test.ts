import { describe, it, expect, afterEach } from 'vitest';
import { algoliaCredentials } from '../src/config/search';

const KEYS = ['ALGOLIA_APP_ID', 'ALGOLIA_SEARCH_API_KEY', 'ALGOLIA_INDEX_NAME'] as const;

function setCredentials(values: Partial<Record<(typeof KEYS)[number], string>>): void {
	for (const key of KEYS) {
		if (values[key] === undefined) delete process.env[key];
		else process.env[key] = values[key];
	}
}

afterEach(() => setCredentials({}));

describe('escolha do provedor de busca', () => {
	it('sem variáveis, não há Algolia', () => {
		// O portal recém-clonado precisa ter busca funcionando: cai no Pagefind.
		expect(algoliaCredentials()).toBeNull();
	});

	it('com as três, devolve as credenciais', () => {
		setCredentials({
			ALGOLIA_APP_ID: 'APP123',
			ALGOLIA_SEARCH_API_KEY: 'chave-de-busca',
			ALGOLIA_INDEX_NAME: 'portal',
		});
		expect(algoliaCredentials()).toEqual({
			appId: 'APP123',
			apiKey: 'chave-de-busca',
			indexName: 'portal',
		});
	});

	it('é tudo ou nada', () => {
		// Com uma faltando, o widget carregaria e falharia na primeira busca.
		setCredentials({ ALGOLIA_APP_ID: 'APP123', ALGOLIA_SEARCH_API_KEY: 'chave' });
		expect(algoliaCredentials()).toBeNull();

		setCredentials({ ALGOLIA_APP_ID: 'APP123', ALGOLIA_INDEX_NAME: 'portal' });
		expect(algoliaCredentials()).toBeNull();
	});

	it('valor em branco conta como ausente', () => {
		setCredentials({
			ALGOLIA_APP_ID: 'APP123',
			ALGOLIA_SEARCH_API_KEY: '   ',
			ALGOLIA_INDEX_NAME: 'portal',
		});
		expect(algoliaCredentials()).toBeNull();
	});

	it('espaços em volta são removidos', () => {
		setCredentials({
			ALGOLIA_APP_ID: '  APP123 ',
			ALGOLIA_SEARCH_API_KEY: ' chave ',
			ALGOLIA_INDEX_NAME: ' portal ',
		});
		expect(algoliaCredentials()?.appId).toBe('APP123');
	});
});
