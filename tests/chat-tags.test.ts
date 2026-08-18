import { describe, it, expect } from 'vitest';
import { chunkDocument, readFrontmatterTags, stem, tokenize } from '../src/lib/chat/retrieval';

describe('tags do frontmatter', () => {
	it('lê a forma em linha', () => {
		const raw = '---\ntitle: Autenticação\ntags: [api, seguranca, autenticacao]\n---\n\nTexto.';
		expect(readFrontmatterTags(raw)).toEqual(['api', 'seguranca', 'autenticacao']);
	});

	it('lê a forma em lista', () => {
		const raw = '---\ntitle: Erros\ntags:\n  - api\n  - erros\n---\n\nTexto.';
		expect(readFrontmatterTags(raw)).toEqual(['api', 'erros']);
	});

	it('tira aspas e espaços', () => {
		const raw = '---\ntitle: T\ntags: [ "api" , \'erros\' ]\n---\n\nTexto.';
		expect(readFrontmatterTags(raw)).toEqual(['api', 'erros']);
	});

	it('página sem tags devolve lista vazia', () => {
		expect(readFrontmatterTags('---\ntitle: T\n---\n\nTexto.')).toEqual([]);
		expect(readFrontmatterTags('Sem frontmatter nenhum.')).toEqual([]);
	});

	it('não confunde outro campo terminado em tags', () => {
		const raw = '---\ntitle: T\nmetatags: [x]\n---\n\nTexto.';
		expect(readFrontmatterTags(raw)).toEqual([]);
	});

	it('cada fragmento da página carrega as tags dela', () => {
		const raw = [
			'---',
			'title: Autenticação',
			'tags: [api, autenticacao]',
			'---',
			'',
			'## Chaves de API',
			'',
			'Envie a chave no header Authorization em toda requisição.',
			'',
			'## Expiração',
			'',
			'As chaves expiram em noventa dias e precisam ser renovadas.',
		].join('\n');

		const chunks = chunkDocument('api-reference/authentication.md', raw, 'page');
		expect(chunks.length).toBeGreaterThan(1);
		expect(chunks.every((chunk) => chunk.tags?.includes('api'))).toBe(true);
	});
});

describe('normalização de palavras', () => {
	it('dobra acentos: a tag sem acento casa com o texto acentuado', () => {
		// É o que faz `autenticacao` na tag encontrar "autenticação" na página.
		expect(tokenize('Autenticação')).toEqual(tokenize('autenticacao'));
		expect(tokenize('configuração')).toEqual(tokenize('configuracao'));
	});

	it('reduz formas da mesma palavra ao mesmo radical', () => {
		const radical = stem('autenticacao');
		expect(stem('autenticar')).toBe(radical);
		expect(stem('autenticado')).toBe(radical);
	});

	it('não mexe em palavra curta', () => {
		// Cortar sufixo de palavra curta junta o que não tem parentesco.
		for (const word of ['api', 'erro', 'json', 'token']) {
			expect(stem(word)).toBe(word);
		}
	});

	it('não corta quando sobraria um radical curto demais', () => {
		expect(stem('cidades').length).toBeGreaterThanOrEqual(4);
	});
});
