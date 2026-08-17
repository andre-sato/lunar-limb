import { describe, it, expect } from 'vitest';
import { hasPublicPage, pageUrlFor } from '../src/lib/editor/page-url';

describe('URL pública de uma página', () => {
	it('deriva a rota do caminho do arquivo', () => {
		expect(pageUrlFor('guides/getting-started.md')).toBe('/guides/getting-started/');
		expect(pageUrlFor('api-reference/overview.mdx')).toBe('/api-reference/overview/');
	});

	it('trata index como a raiz da pasta', () => {
		expect(pageUrlFor('index.mdx')).toBe('/');
		expect(pageUrlFor('guides/index.md')).toBe('/guides/');
	});

	it('preserva o prefixo de idioma', () => {
		expect(pageUrlFor('en/guides/getting-started.md')).toBe('/en/guides/getting-started/');
		expect(pageUrlFor('es/index.mdx')).toBe('/es/');
	});

	it('o slug do frontmatter vence o caminho', () => {
		// Sem isto o editor abriria /guides/auth/, que dá 404.
		expect(pageUrlFor('guides/auth.md', { slug: 'autenticacao' })).toBe('/autenticacao/');
	});

	it('slug customizado é relativo à raiz do idioma', () => {
		expect(pageUrlFor('en/guides/auth.md', { slug: 'authentication' })).toBe('/en/authentication/');
	});

	it('ignora slug vazio ou de tipo errado', () => {
		expect(pageUrlFor('guides/auth.md', { slug: '   ' })).toBe('/guides/auth/');
		expect(pageUrlFor('guides/auth.md', { slug: 42 })).toBe('/guides/auth/');
		expect(pageUrlFor('guides/auth.md', {})).toBe('/guides/auth/');
	});

	it('normaliza barras do Windows e barras extras', () => {
		expect(pageUrlFor('guides\\auth.md')).toBe('/guides/auth/');
		expect(pageUrlFor('/guides/auth.md')).toBe('/guides/auth/');
		expect(pageUrlFor('guides/auth.md', { slug: '/autenticacao/' })).toBe('/autenticacao/');
	});

	it('uma pasta chamada `en` de verdade não é confundida com idioma', () => {
		// `en` só é prefixo de idioma quando há algo depois dele.
		expect(pageUrlFor('en.md')).toBe('/en/');
	});

	it('só documentos têm página; blocos reutilizáveis não', () => {
		expect(hasPublicPage('docs')).toBe(true);
		expect(hasPublicPage('snippets')).toBe(false);
	});
});
