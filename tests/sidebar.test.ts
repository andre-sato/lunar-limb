/**
 * Organização da navegação (issue #11, opção A).
 *
 * A validação é a parte que importa: a Starlight recusa um slug inexistente com
 * `AstroUserError` e o build inteiro para. Um formulário que grava sem conferir
 * transforma um arrastar-e-soltar em portal fora do ar — e foi exatamente esse
 * erro que derrubou o build durante a implementação, com 44 slugs escritos com
 * a extensão do arquivo.
 */

import { describe, expect, it } from 'vitest';
import { normalizeSidebar, validateSidebar, type SidebarConfig } from '../src/lib/editor/sidebar';

const AVAILABLE = ['guides/a', 'guides/b', 'guides/c', 'guides/d'];

function group(items: string[], label = 'Grupo'): SidebarConfig['guides'][number] {
	return { label: { 'pt-BR': label, en: label, es: label }, collapsed: true, items };
}

const codes = (config: SidebarConfig, available = AVAILABLE, hidden = new Set<string>()) =>
	validateSidebar(config, available, hidden).issues.map((issue) => issue.code);

describe('validação da navegação', () => {
	it('aprova uma configuração que cobre todas as páginas', () => {
		const result = validateSidebar({ guides: [group(['guides/a', 'guides/b']), group(['guides/c', 'guides/d'])] }, AVAILABLE);
		expect(result.valid).toBe(true);
		expect(result.issues).toHaveLength(0);
	});

	it('recusa slug que não corresponde a página nenhuma', () => {
		// É o defeito que derruba o build: a Starlight lança `AstroUserError` e o
		// portal para de subir inteiro, não só a navegação.
		const config = { guides: [group([...AVAILABLE, 'guides/nao-existe'])] };
		expect(codes(config)).toContain('SB-UNKNOWN-SLUG');
		expect(validateSidebar(config, AVAILABLE).valid).toBe(false);
	});

	it('recusa slug com extensão de arquivo', () => {
		// O erro real que aconteceu: o slug da Starlight não leva `.md` nem `.mdx`.
		const config = { guides: [group(['guides/a.md', 'guides/b', 'guides/c', 'guides/d'])] };
		expect(codes(config)).toContain('SB-UNKNOWN-SLUG');
	});

	it('recusa a mesma página em dois grupos', () => {
		const config = {
			guides: [group(['guides/a', 'guides/b']), group(['guides/a', 'guides/c', 'guides/d'])],
		};
		expect(codes(config)).toContain('SB-DUPLICATE');
		expect(validateSidebar(config, AVAILABLE).valid).toBe(false);
	});

	it('recusa página que ficaria fora de todos os grupos', () => {
		// Erro e não aviso: a página continua publicada, mas sai da navegação sem
		// ninguém decidir isso. Sumir por omissão não é sumir por decisão.
		const config = { guides: [group(['guides/a', 'guides/b'])] };
		const result = validateSidebar(config, AVAILABLE);

		expect(result.valid).toBe(false);
		expect(result.orphans).toEqual(['guides/c', 'guides/d']);
	});

	it('não acusa de órfã a página que declara visible: false', () => {
		// Ela está fora da navegação de propósito. Acusá-la mandaria alguém
		// "consertar" o que está certo.
		const config = { guides: [group(['guides/a', 'guides/b'])] };
		const hidden = new Set(['guides/c', 'guides/d']);

		const result = validateSidebar(config, AVAILABLE, hidden);
		expect(result.valid).toBe(true);
		expect(result.orphans).toEqual([]);
	});

	it('recusa grupo vazio', () => {
		const config = { guides: [group(AVAILABLE), group([], 'Vazio')] };
		expect(codes(config)).toContain('SB-EMPTY-GROUP');
	});

	it('recusa grupo sem rótulo nos três idiomas', () => {
		const config: SidebarConfig = {
			guides: [{ label: { 'pt-BR': 'Só português', en: '', es: '' }, collapsed: true, items: AVAILABLE }],
		};
		expect(codes(config)).toContain('SB-MISSING-LABEL');
		expect(validateSidebar(config, AVAILABLE).valid).toBe(false);
	});

	it('avisa, sem reprovar, sobre grupo grande demais', () => {
		const many = Array.from({ length: 12 }, (_, index) => `guides/p${index}`);
		const result = validateSidebar({ guides: [group(many)] }, many);

		expect(result.valid).toBe(true);
		expect(result.issues.find((issue) => issue.code === 'SB-LARGE-GROUP')?.severity).toBe('warning');
	});
});

describe('normalização do corpo recebido', () => {
	it('reconstrói campo a campo e descarta chave desconhecida', () => {
		// Gravar o objeto recebido deixaria a forma do arquivo à mercê de quem o
		// enviou.
		const normalized = normalizeSidebar({
			guides: [{ label: { 'pt-BR': 'A', en: 'A', es: 'A' }, collapsed: false, items: ['guides/a'], extra: 'x' }],
			outraCoisa: 1,
		});

		expect(normalized).toEqual({
			guides: [{ label: { 'pt-BR': 'A', en: 'A', es: 'A' }, collapsed: false, items: ['guides/a'] }],
		});
	});

	it('descarta item que não é string', () => {
		const normalized = normalizeSidebar({
			guides: [{ label: { 'pt-BR': 'A', en: 'A', es: 'A' }, items: ['guides/a', 42, null, { x: 1 }] }],
		});
		expect(normalized.guides[0].items).toEqual(['guides/a']);
	});

	it('recolhido é o padrão quando não vem declarado', () => {
		const normalized = normalizeSidebar({ guides: [{ label: { 'pt-BR': 'A', en: 'A', es: 'A' }, items: [] }] });
		expect(normalized.guides[0].collapsed).toBe(true);
	});

	it('lança quando o corpo não traz a lista de grupos', () => {
		expect(() => normalizeSidebar({})).toThrow();
		expect(() => normalizeSidebar(null)).toThrow();
	});
});
