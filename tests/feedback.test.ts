import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	aggregateFeedback,
	normalizePath,
	normalizeRating,
	normalizeComment,
	normalizeLocale,
	FeedbackError,
	MIN_VOTES_FOR_ATTENTION,
	MAX_COMMENT_LENGTH,
	type FeedbackEntry,
} from '../src/lib/feedback/store';
import { authorize, requiredPermissions } from '../src/lib/auth/guard';
import type { AuthUser } from '../src/lib/auth/permissions';

function entry(over: Partial<FeedbackEntry> = {}): FeedbackEntry {
	return {
		id: over.id ?? Math.random().toString(36).slice(2),
		path: over.path ?? '/guides/a',
		locale: over.locale ?? 'pt-BR',
		rating: over.rating ?? 'up',
		comment: over.comment,
		createdAt: over.createdAt ?? '2026-08-16T12:00:00.000Z',
	};
}

describe('validação da entrada', () => {
	it('aceita caminho interno', () => {
		expect(normalizePath('/guides/authentication/')).toBe('/guides/authentication/');
	});

	it('recusa URL absoluta e protocol-relative', () => {
		// O caminho é exibido como link no painel administrativo; aceitar host
		// externo faria o painel apresentar link de terceiro como se fosse do portal.
		expect(() => normalizePath('https://malicioso.example')).toThrow(FeedbackError);
		expect(() => normalizePath('//malicioso.example')).toThrow(FeedbackError);
		expect(() => normalizePath('javascript:alert(1)')).toThrow(FeedbackError);
	});

	it('recusa caminho ausente ou não-string', () => {
		expect(() => normalizePath(undefined)).toThrow(FeedbackError);
		expect(() => normalizePath(42)).toThrow(FeedbackError);
	});

	it('descarta query e fragmento', () => {
		// `/guia?x=1` e `/guia#secao` são a mesma página e não podem virar
		// linhas separadas no relatório.
		expect(normalizePath('/guia?utm=x')).toBe('/guia');
		expect(normalizePath('/guia#secao')).toBe('/guia');
	});

	it('recusa caminho longo demais', () => {
		expect(() => normalizePath('/' + 'a'.repeat(600))).toThrow(FeedbackError);
	});

	it('aceita só up e down', () => {
		expect(normalizeRating('up')).toBe('up');
		expect(normalizeRating('down')).toBe('down');
		expect(() => normalizeRating('maybe')).toThrow(FeedbackError);
		expect(() => normalizeRating(1)).toThrow(FeedbackError);
	});

	it('trata comentário vazio como ausente e limita o tamanho', () => {
		expect(normalizeComment('')).toBeUndefined();
		expect(normalizeComment('   ')).toBeUndefined();
		expect(normalizeComment(undefined)).toBeUndefined();
		expect(normalizeComment('  texto  ')).toBe('texto');
		expect(() => normalizeComment('x'.repeat(MAX_COMMENT_LENGTH + 1))).toThrow(FeedbackError);
	});

	it('cai no idioma padrão quando o locale é estranho', () => {
		expect(normalizeLocale('en')).toBe('en');
		expect(normalizeLocale('pt-BR')).toBe('pt-BR');
		expect(normalizeLocale('<script>')).toBe('pt-BR');
		expect(normalizeLocale(undefined)).toBe('pt-BR');
	});
});

describe('agregação', () => {
	it('conta votos e calcula a proporção de úteis', () => {
		const summary = aggregateFeedback([
			entry({ rating: 'up' }),
			entry({ rating: 'up' }),
			entry({ rating: 'up' }),
			entry({ rating: 'down' }),
		]);

		expect(summary.total).toBe(4);
		expect(summary.up).toBe(3);
		expect(summary.down).toBe(1);
		expect(summary.score).toBe(0.75);
	});

	it('agrupa por página', () => {
		const summary = aggregateFeedback([
			entry({ path: '/a', rating: 'up' }),
			entry({ path: '/a', rating: 'down' }),
			entry({ path: '/b', rating: 'up' }),
		]);

		const a = summary.topPages.find((page) => page.path === '/a')!;
		expect(a).toMatchObject({ up: 1, down: 1, total: 2, score: 0.5 });
	});

	it('exige volume mínimo para marcar página como problemática', () => {
		// Um voto negativo isolado não pode mandar o time reescrever a página.
		const poucos = aggregateFeedback([entry({ path: '/a', rating: 'down' })]);
		expect(poucos.needsAttention).toHaveLength(0);

		const suficientes = aggregateFeedback(
			Array.from({ length: MIN_VOTES_FOR_ATTENTION }, () => entry({ path: '/a', rating: 'down' }))
		);
		expect(suficientes.needsAttention.map((page) => page.path)).toEqual(['/a']);
	});

	it('não marca página com maioria positiva', () => {
		const summary = aggregateFeedback([
			entry({ path: '/a', rating: 'up' }),
			entry({ path: '/a', rating: 'up' }),
			entry({ path: '/a', rating: 'up' }),
			entry({ path: '/a', rating: 'down' }),
		]);
		expect(summary.needsAttention).toHaveLength(0);
	});

	it('ordena as piores primeiro', () => {
		const summary = aggregateFeedback([
			...Array.from({ length: 4 }, () => entry({ path: '/ruim', rating: 'down' })),
			...Array.from({ length: 3 }, () => entry({ path: '/meio', rating: 'down' })),
			entry({ path: '/meio', rating: 'up' }),
			entry({ path: '/meio', rating: 'up' }),
		]);

		expect(summary.needsAttention[0].path).toBe('/ruim');
	});

	it('recolhe comentários, mais recentes primeiro', () => {
		const summary = aggregateFeedback([
			entry({ comment: 'antigo', createdAt: '2026-08-10T10:00:00.000Z' }),
			entry({ comment: 'novo', createdAt: '2026-08-16T10:00:00.000Z' }),
			entry({ comment: undefined }),
		]);

		expect(summary.comments.map((c) => c.comment)).toEqual(['novo', 'antigo']);
	});

	it('filtra por período', () => {
		const summary = aggregateFeedback(
			[
				entry({ createdAt: '2026-01-01T00:00:00.000Z' }),
				entry({ createdAt: '2026-08-16T00:00:00.000Z' }),
			],
			new Date('2026-08-01T00:00:00.000Z')
		);

		expect(summary.total).toBe(1);
	});

	it('monta a linha do tempo separando positivos de negativos', () => {
		const summary = aggregateFeedback([
			entry({ createdAt: '2026-08-15T10:00:00.000Z', rating: 'up' }),
			entry({ createdAt: '2026-08-15T18:00:00.000Z', rating: 'down' }),
			entry({ createdAt: '2026-08-16T10:00:00.000Z', rating: 'up' }),
		]);

		expect(summary.timeline).toEqual([
			{ date: '2026-08-15', up: 1, down: 1 },
			{ date: '2026-08-16', up: 1, down: 0 },
		]);
	});

	it('não divide por zero sem respostas', () => {
		const summary = aggregateFeedback([]);
		expect(summary.total).toBe(0);
		expect(summary.score).toBe(0);
		expect(summary.needsAttention).toEqual([]);
	});
});

describe('autorização', () => {
	const viewer: AuthUser = { id: 'v', role: 'viewer', status: 'active' };
	const editor: AuthUser = { id: 'e', role: 'editor', status: 'active' };
	const admin: AuthUser = { id: 'a', role: 'admin', status: 'active' };

	it('enviar feedback é público — o leitor é anônimo', () => {
		expect(requiredPermissions('/api/feedback', 'POST')).toEqual([]);
		expect(authorize(null, '/api/feedback', 'POST').kind).toBe('allow');
	});

	it('ler o feedback agregado exige admin', () => {
		expect(authorize(null, '/api/admin/feedback').kind).toBe('authenticate');
		expect(authorize(viewer, '/api/admin/feedback').kind).toBe('forbid');
		expect(authorize(editor, '/api/admin/feedback').kind).toBe('forbid');
		expect(authorize(admin, '/api/admin/feedback').kind).toBe('allow');
	});

	it('a tela de feedback segue protegida pelo prefixo /settings', () => {
		expect(authorize(editor, '/settings/feedback').kind).toBe('forbid');
		expect(authorize(admin, '/settings/feedback').kind).toBe('allow');
	});
});

describe('persistência', () => {
	const originalCwd = process.cwd();
	const tempDirs: string[] = [];
	type StoreModule = typeof import('../src/lib/feedback/store');
	let store: StoreModule;

	beforeEach(async () => {
		const dir = await mkdtemp(path.join(tmpdir(), 'portal-feedback-'));
		tempDirs.push(dir);
		process.chdir(dir);
		vi.resetModules();
		store = await import('../src/lib/feedback/store');
	});

	afterAll(async () => {
		process.chdir(originalCwd);
		await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
	});

	it('grava e relê um voto', async () => {
		await store.submitFeedback({ path: '/a', locale: 'pt-BR', rating: 'up' });
		const all = await store.listFeedback();
		expect(all).toHaveLength(1);
		expect(all[0]).toMatchObject({ path: '/a', rating: 'up' });
	});

	it('anexa o comentário ao voto existente sem criar outro', async () => {
		// É o ponto que estraga a métrica se estiver errado: o comentário chega
		// depois do voto e não pode virar um segundo voto.
		const created = await store.submitFeedback({ path: '/a', locale: 'pt-BR', rating: 'down' });
		const attached = await store.attachComment(created.id, 'faltou exemplo');

		expect(attached).toBe(true);
		const all = await store.listFeedback();
		expect(all).toHaveLength(1);
		expect(all[0].comment).toBe('faltou exemplo');

		const summary = store.aggregateFeedback(all);
		expect(summary.total).toBe(1);
		expect(summary.down).toBe(1);
	});

	it('não sobrescreve um comentário já enviado', async () => {
		const created = await store.submitFeedback({ path: '/a', locale: 'pt-BR', rating: 'up' });
		await store.attachComment(created.id, 'primeiro');
		const again = await store.attachComment(created.id, 'segundo');

		expect(again).toBe(false);
		expect((await store.listFeedback())[0].comment).toBe('primeiro');
	});

	it('ignora id inexistente', async () => {
		expect(await store.attachComment('nao-existe', 'texto')).toBe(false);
	});

	it('recusa id absurdo', async () => {
		await expect(store.attachComment('x'.repeat(100), 'texto')).rejects.toThrow(store.FeedbackError);
	});

	it('não perde votos enviados em paralelo', async () => {
		await Promise.all(
			Array.from({ length: 10 }, (_, i) =>
				store.submitFeedback({ path: `/p${i}`, locale: 'pt-BR', rating: 'up' })
			)
		);
		expect(await store.listFeedback()).toHaveLength(10);
	});
});
