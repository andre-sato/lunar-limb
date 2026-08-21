import { describe, it, expect } from 'vitest';
import { rehype } from 'rehype';
import { normalizeBase, prefixUrl, rehypeBasePath } from '../src/lib/deploy/rehype-base-path';
import { serverFeatures, deployTarget } from '../src/config/deploy';

function transform(html: string, base: string): string {
	return String(
		rehype()
			.data('settings', { fragment: true })
			.use(rehypeBasePath, { base })
			.processSync(html)
	);
}

describe('normalização do base', () => {
	it('trata as formas equivalentes da raiz', () => {
		expect(normalizeBase('/')).toBe('/');
		expect(normalizeBase('')).toBe('/');
		expect(normalizeBase('  ')).toBe('/');
	});

	it('garante barra no começo e no fim', () => {
		expect(normalizeBase('lunar-limb')).toBe('/lunar-limb/');
		expect(normalizeBase('/lunar-limb')).toBe('/lunar-limb/');
		expect(normalizeBase('lunar-limb/')).toBe('/lunar-limb/');
		expect(normalizeBase('/lunar-limb/')).toBe('/lunar-limb/');
	});
});

describe('prefixo de URL', () => {
	const base = '/repo/';

	it('prefixa caminho absoluto do próprio site', () => {
		expect(prefixUrl('/guides/getting-started/', base)).toBe('/repo/guides/getting-started/');
	});

	it('não prefixa duas vezes', () => {
		// Rodar o plugin sobre HTML já reescrito pela Astro não pode duplicar.
		expect(prefixUrl('/repo/guides/', base)).toBe('/repo/guides/');
		expect(prefixUrl('/repo/', base)).toBe('/repo/');
	});

	it('não toca em URL de outro destino', () => {
		expect(prefixUrl('https://exemplo.com/x', base)).toBe('https://exemplo.com/x');
		expect(prefixUrl('mailto:a@b.com', base)).toBe('mailto:a@b.com');
		// Relativo a protocolo: também é outro host.
		expect(prefixUrl('//cdn.exemplo.com/x.js', base)).toBe('//cdn.exemplo.com/x.js');
	});

	it('não toca em âncora nem em link relativo', () => {
		expect(prefixUrl('#secao', base)).toBe('#secao');
		expect(prefixUrl('../outra/', base)).toBe('../outra/');
		expect(prefixUrl('vizinha/', base)).toBe('vizinha/');
	});

	it('com base na raiz, nada muda', () => {
		expect(prefixUrl('/guides/', '/')).toBe('/guides/');
	});
});

describe('transformação do HTML', () => {
	it('corrige href de link escrito à mão no Markdown', () => {
		const output = transform('<p><a href="/guides/getting-started/">Guia</a></p>', '/repo/');
		expect(output).toContain('href="/repo/guides/getting-started/"');
	});

	it('corrige src de imagem', () => {
		const output = transform('<img src="/diagrama.svg" alt="d">', '/repo/');
		expect(output).toContain('src="/repo/diagrama.svg"');
	});

	it('corrige cada candidato de srcset', () => {
		const output = transform('<img srcset="/a.png 1x, /b.png 2x" src="/a.png" alt="a">', '/repo/');
		expect(output).toContain('/repo/a.png 1x');
		expect(output).toContain('/repo/b.png 2x');
	});

	it('preserva o descritor quando o candidato é externo', () => {
		const output = transform('<img srcset="https://cdn.x/a.png 2x" src="/a.png" alt="a">', '/repo/');
		expect(output).toContain('https://cdn.x/a.png 2x');
	});

	it('não altera nada quando o base é a raiz', () => {
		const html = '<p><a href="/guides/">Guia</a></p>';
		expect(transform(html, '/')).toContain('href="/guides/"');
	});
});

describe('alvo de publicação', () => {
	it('o padrão é o servidor completo', () => {
		// Sem `PORTAL_TARGET`, nenhum recurso é desligado — um build comum não
		// pode perder o editor por acidente de configuração.
		expect(deployTarget).toBe('server');
		expect(Object.values(serverFeatures).every(Boolean)).toBe(true);
	});

	it('a lista de recursos que exigem servidor é explícita', () => {
		// Quem adicionar um recurso com API própria precisa decidir aqui o que
		// acontece com ele no Pages.
		expect(Object.keys(serverFeatures).sort()).toEqual([
			'accountMenu',
			// 'analytics' saiu com a integração externa (ADR-0019): a
			// observabilidade nativa mede no servidor e não injeta script no
			// navegador de quem lê.
			'auth',
			'chat',
			'editThisPage',
			'editor',
			'feedback',
			'settings',
		]);
	});
});
