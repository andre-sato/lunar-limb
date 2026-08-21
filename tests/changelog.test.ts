import { describe, expect, it } from 'vitest';
import { parseConventional, parseDeprecation } from '../src/lib/changelog/conventional';
import { classify, orderEntries, touchesOnlyNoise } from '../src/lib/changelog/classify';
import { anchorFor, findEndpoints, linkEndpoints, normalizePath } from '../src/lib/changelog/endpoints';
import { fileNameFor, periodLabel, renderChangelog } from '../src/lib/changelog/render';
import { monthWindow, previousMonth } from '../src/lib/changelog/service';
import { DEFAULT_CONFIG, type ChangelogEntry, type MonthlyChangelog } from '../src/lib/changelog/types';
import type { CommitInfo } from '../src/lib/history/git';
import type { ApiModel } from '../src/lib/api-explorer/model';

function commit(subject: string, body = '', files: string[] = ['src/pages/api/x.ts']): CommitInfo {
	return { commit: 'abc1234def', date: '2026-07-10T10:00:00Z', author: 'A', subject, files, tags: [], body };
}

const model = {
	title: 'API', version: '1', servers: [], securitySchemes: [], schemas: [],
	operations: [
		{ method: 'post', path: '/api/feedback' },
		{ method: 'get', path: '/api/auth/me' },
	],
} as unknown as ApiModel;

// ---------------------------------------------------------------------------

describe('Conventional Commits', () => {
	it('lê tipo, escopo e descrição', () => {
		const parsed = parseConventional('feat(auth): expõe o perfil');
		expect(parsed).toMatchObject({ type: 'feat', scope: 'auth', description: 'expõe o perfil', unconventional: false });
	});

	it('reconhece as três formas de declarar quebra', () => {
		expect(parseConventional('feat!: muda').breaking).toBe(true);
		expect(parseConventional('feat: muda', 'BREAKING CHANGE: o campo saiu').breaking).toBe(true);
		expect(parseConventional('feat: muda', 'BREAKING-CHANGE: o campo saiu').breaking).toBe(true);
	});

	it('guarda a nota da quebra', () => {
		expect(parseConventional('feat: x', 'BREAKING CHANGE: o campo `path` virou obrigatório').breakingNote)
			.toBe('o campo `path` virou obrigatório');
	});

	// O defeito que rodar contra o repositório real expôs: `Palavra: texto` é
	// mensagem comum, e sem lista de tipos conhecidos ela virava item publicado.
	it('recusa um tipo que não é um tipo', () => {
		const parsed = parseConventional('README: comprime as seções');
		expect(parsed.unconventional).toBe(true);
		expect(parsed.type).toBe('');
		expect(parsed.description).toBe('README: comprime as seções');
	});

	it('marca prosa comum como fora da convenção', () => {
		expect(parseConventional('Corrige o menu lateral').unconventional).toBe(true);
	});
});

describe('depreciação', () => {
	it('lê assunto, fim de vida e migração', () => {
		expect(parseDeprecation('DEPRECATED: GET /v1/x\nEND-OF-LIFE: 2027-03-01\nMIGRATION: /guides/m/'))
			.toEqual({ subject: 'GET /v1/x', endOfLife: '2027-03-01', migration: '/guides/m/' });
	});

	it('recusa prazo que não é data', () => {
		// `em breve` não permite planejar, e registrá-lo como data daria falsa
		// precisão a um aviso que o leitor usa para agendar trabalho.
		expect(parseDeprecation('DEPRECATED: X\nEND-OF-LIFE: em breve')?.endOfLife).toBeUndefined();
	});

	it('devolve nada quando não há depreciação', () => {
		expect(parseDeprecation('BREAKING CHANGE: outra coisa')).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------

describe('filtro de ruído', () => {
	it('descarta manutenção', () => {
		expect(classify(commit('chore(deps): atualiza vitest'), DEFAULT_CONFIG).entry).toBeUndefined();
		expect(classify(commit('refactor: reorganiza módulos'), DEFAULT_CONFIG).entry).toBeUndefined();
	});

	it('descarta mensagem fora da convenção', () => {
		expect(classify(commit('Corrige o menu'), DEFAULT_CONFIG).entry).toBeUndefined();
	});

	// Uma quebra entra sempre: `refactor!` que altera contrato é o item mais caro
	// do mês, e filtrá-lo pelo tipo publicaria silêncio sobre ele.
	it('mantém quebra mesmo com tipo de manutenção', () => {
		const result = classify(commit('refactor!: troca o formato do id'), DEFAULT_CONFIG);
		expect(result.entry?.breaking).toBe(true);
	});

	it('descarta commit que só toca arquivo sem efeito para quem integra', () => {
		expect(touchesOnlyNoise(['package-lock.json'], DEFAULT_CONFIG)).toBe(true);
		// Mexeu no lock e numa rota: é mudança de produto que atualizou dependência.
		expect(touchesOnlyNoise(['package-lock.json', 'src/pages/api/x.ts'], DEFAULT_CONFIG)).toBe(false);
	});

	it('manda depreciação para o ciclo de vida, qualquer que seja o tipo', () => {
		const result = classify(commit('feat: nova rota', 'DEPRECATED: GET /velho\nEND-OF-LIFE: 2027-01-01'), DEFAULT_CONFIG);
		expect(result.entry?.category).toBe('docs');
	});

	it('anota pendência quando falta a data de fim de vida', () => {
		const result = classify(commit('docs: aviso', 'DEPRECATED: GET /velho'), DEFAULT_CONFIG);
		expect(result.entry).toBeDefined();
		expect(result.warnings.some((w) => w.includes('sem data de fim de vida'))).toBe(true);
	});

	it('anota pendência quando a quebra não explica o que quebra', () => {
		expect(classify(commit('feat!: muda'), DEFAULT_CONFIG).warnings.some((w) => w.includes('sem nota'))).toBe(true);
	});
});

describe('ordem dentro da seção', () => {
	it('coloca a quebra no topo', () => {
		const base = { commit: 'x', original: 'x', endpoints: [] as string[], category: 'feature' as const };
		const ordered = orderEntries([
			{ ...base, date: '2026-07-01', text: 'antiga', breaking: false } as ChangelogEntry,
			{ ...base, date: '2026-07-20', text: 'quebra', breaking: true } as ChangelogEntry,
		]);
		expect(ordered[0].text).toBe('quebra');
	});
});

// ---------------------------------------------------------------------------

describe('endpoints', () => {
	it('normaliza as duas grafias de parâmetro', () => {
		expect(normalizePath('/users/[id]')).toBe('/users/{id}');
	});

	it('resolve citação com prefixo de servidor omitido', () => {
		const found = findEndpoints('exige path em POST /feedback', model, '/api-reference/overview/');
		expect(found[0]).toMatchObject({ method: 'POST', path: '/feedback', resolved: true });
	});

	// A regra que decide a qualidade da feature: link só para o que existe.
	it('não resolve endpoint que a especificação não tem', () => {
		const found = findEndpoints('aceita POST /v9/inexistente', model, '/api-reference/overview/');
		expect(found[0].resolved).toBe(false);
		expect(found[0].href).toBeUndefined();
	});

	it('não engole a pontuação da frase', () => {
		const found = findEndpoints('mexe em GET /api/auth/me.', model, '/api-reference/overview/');
		expect(found[0].path).toBe('/api/auth/me');
	});

	it('vira link quando resolve e código quando não', () => {
		const texto = 'usa POST /feedback e POST /v9/inexistente';
		const links = findEndpoints(texto, model, '/api-reference/overview/');
		const saida = linkEndpoints(texto, links);
		// A âncora vem do caminho da especificação (`/api/feedback`), não do texto
		// citado: é ela que a página de referência usa como destino.
		expect(saida).toContain('[`POST /feedback`](/api-reference/overview/#post-api-feedback)');
		expect(saida).toContain('`POST /v9/inexistente`');
		expect(saida).not.toContain('[`POST /v9/inexistente`]');
	});

	it('gera âncora estável', () => {
		expect(anchorFor('GET', '/api/users/{id}')).toBe('get-api-users-id');
	});
});

// ---------------------------------------------------------------------------

describe('janela do mês', () => {
	it('vai do primeiro instante ao primeiro do mês seguinte', () => {
		const { from, to } = monthWindow('2026-07');
		expect(from).toBe('2026-07-01T00:00:00.000Z');
		expect(to).toBe('2026-08-01T00:00:00.000Z');
	});

	it('atravessa a virada de ano', () => {
		expect(previousMonth(new Date('2026-01-15T00:00:00Z'))).toBe('2025-12');
	});
});

describe('documento', () => {
	const changelog: MonthlyChangelog = {
		period: '2026-07', from: '2026-07-01T00:00:00.000Z', to: '2026-08-01T00:00:00.000Z',
		considered: 6, filtered: 1, warnings: [], empty: false,
		sections: [
			{ category: 'feature', entries: [{
				commit: 'a', date: '2026-07-09', category: 'feature', text: 'exige `path`', original: 'x',
				breaking: true, breakingNote: 'passa a devolver 400', endpoints: ['POST /feedback'],
			}] },
			{ category: 'fix', entries: [] },
			{ category: 'docs', entries: [{
				commit: 'b', date: '2026-07-15', category: 'docs', text: 'aviso', original: 'y', breaking: false,
				endpoints: [], deprecation: { subject: 'GET /velho', endOfLife: '2027-03-01', migration: '/guides/m/' },
			}] },
		],
	};

	it('gera frontmatter válido para a Starlight', () => {
		const saida = renderChangelog(changelog, { order: 2 });
		expect(saida.startsWith('---\n')).toBe(true);
		expect(saida).toContain('title: "Mudanças de julho de 2026"');
		expect(saida).toContain('sidebar:\n  order: 2');
		expect(saida).toContain('tags: [changelog]');
	});

	it('avisa no topo quando há mudança incompatível', () => {
		expect(renderChangelog(changelog, { order: 1 })).toContain(':::danger[Requer ação]');
	});

	it('traz o prazo e o link de migração da depreciação', () => {
		const saida = renderChangelog(changelog, { order: 1 });
		expect(saida).toContain('fica disponível até **2027-03-01**');
		expect(saida).toContain('/guides/m/');
	});

	it('omite seção vazia em vez de imprimir um cabeçalho sem itens', () => {
		expect(renderChangelog(changelog, { order: 1 })).not.toContain('🛠 Correções');
	});

	it('declara que foi gerado, e a partir de quê', () => {
		const saida = renderChangelog(changelog, { order: 1 });
		expect(saida).toContain('_Gerado a partir dos commits de 2026-07-01 a 2026-08-01._');
	});

	it('nomeia o arquivo pelo período', () => {
		expect(fileNameFor('2026-07')).toBe('2026-07.md');
		expect(periodLabel('2026-07')).toBe('julho de 2026');
	});
});
