import { describe, it, expect } from 'vitest';
import { aggregate, shortEventName, type Do11yRow } from '../src/lib/integrations/do11y-query';
import {
	DEFAULT_CONFIG,
	toClientConfig,
	toAdminView,
	validateConfig,
	schemaSql,
	type Do11yConfig,
} from '../src/lib/integrations/do11y';
import { requiredPermissions, authorize } from '../src/lib/auth/guard';
import type { AuthUser } from '../src/lib/auth/permissions';

/** Constrói uma linha com as chaves planas e pontuadas que o Do11y emite. */
function row(
	event: string,
	options: {
		session?: string;
		path?: string;
		title?: string;
		category?: string | null;
		aiPlatform?: string | null;
		device?: string;
		at?: string;
	} = {}
): Do11yRow {
	const payload: Record<string, unknown> = { eventName: `browser.do11y.${event}` };
	if (options.session) payload['session.id'] = options.session;
	if (options.path) payload['url.path'] = options.path;
	if (options.title) payload['browser.do11y.page_title'] = options.title;
	if (options.category !== undefined && options.category !== null) {
		payload['browser.do11y.referrer_category'] = options.category;
	}
	if (options.aiPlatform) payload['browser.do11y.ai_platform'] = options.aiPlatform;
	if (options.device) payload['device.type'] = options.device;
	return { created_at: options.at ?? '2026-08-16T12:00:00.000Z', payload };
}

describe('agregação de eventos', () => {
	it('conta eventos, page views e sessões distintas', () => {
		const metrics = aggregate([
			row('page_view', { session: 's1', path: '/a' }),
			row('page_view', { session: 's1', path: '/b' }),
			row('scroll_depth', { session: 's1' }),
			row('page_view', { session: 's2', path: '/a' }),
		]);

		expect(metrics.totalEvents).toBe(4);
		expect(metrics.pageViews).toBe(3);
		expect(metrics.sessions).toBe(2);
	});

	it('ordena as páginas mais vistas', () => {
		const metrics = aggregate([
			row('page_view', { session: 's1', path: '/guia', title: 'Guia' }),
			row('page_view', { session: 's2', path: '/guia', title: 'Guia' }),
			row('page_view', { session: 's3', path: '/api', title: 'API' }),
		]);

		expect(metrics.topPages[0]).toEqual({ path: '/guia', title: 'Guia', views: 2 });
		expect(metrics.topPages[1]).toEqual({ path: '/api', title: 'API', views: 1 });
	});

	it('conta origem uma vez por sessão, não por evento', () => {
		// Esta é a conta que erra fácil: uma sessão de IA que lê 10 páginas não
		// pode valer 10 na distribuição de origens.
		const metrics = aggregate([
			...Array.from({ length: 10 }, (_, i) =>
				row('page_view', { session: 'ai-1', path: `/p${i}`, category: 'ai', aiPlatform: 'Claude' })
			),
			row('page_view', { session: 'humano-1', path: '/p0', category: 'direct' }),
		]);

		const sources = Object.fromEntries(metrics.trafficSources.map((s) => [s.label, s.count]));
		expect(sources.ai).toBe(1);
		expect(sources.direct).toBe(1);
		expect(metrics.sessions).toBe(2);
		expect(metrics.aiSessions).toBe(1);
		expect(metrics.aiShare).toBe(0.5);
	});

	it('preserva o atributo da sessão quando um evento posterior o omite', () => {
		// scroll_depth costuma não repetir o referrer; a sessão não pode virar
		// "desconhecida" por causa disso.
		const metrics = aggregate([
			row('scroll_depth', { session: 's1' }),
			row('page_view', { session: 's1', path: '/a', category: 'ai', aiPlatform: 'ChatGPT' }),
		]);

		expect(metrics.trafficSources).toEqual([{ label: 'ai', count: 1 }]);
		expect(metrics.aiPlatforms).toEqual([{ label: 'ChatGPT', count: 1 }]);
	});

	it('agrupa plataformas de IA e ignora sessões que não são de IA', () => {
		const metrics = aggregate([
			row('page_view', { session: 'a', category: 'ai', aiPlatform: 'Claude', path: '/x' }),
			row('page_view', { session: 'b', category: 'ai', aiPlatform: 'ChatGPT', path: '/x' }),
			row('page_view', { session: 'c', category: 'ai', aiPlatform: 'Claude', path: '/x' }),
			row('page_view', { session: 'd', category: 'search-engine', path: '/x' }),
		]);

		expect(metrics.aiPlatforms).toEqual([
			{ label: 'Claude', count: 2 },
			{ label: 'ChatGPT', count: 1 },
		]);
		expect(metrics.aiSessions).toBe(3);
	});

	it('classifica sessão de IA sem plataforma conhecida como "outra"', () => {
		const metrics = aggregate([row('page_view', { session: 'a', category: 'ai', path: '/x' })]);
		expect(metrics.aiPlatforms).toEqual([{ label: 'outra', count: 1 }]);
	});

	it('monta a linha do tempo em ordem cronológica', () => {
		const metrics = aggregate([
			row('page_view', { session: 'a', at: '2026-08-16T10:00:00Z', path: '/x' }),
			row('page_view', { session: 'b', at: '2026-08-14T10:00:00Z', path: '/x' }),
			row('page_view', { session: 'c', at: '2026-08-16T18:00:00Z', path: '/x' }),
		]);

		expect(metrics.timeline).toEqual([
			{ date: '2026-08-14', count: 1 },
			{ date: '2026-08-16', count: 2 },
		]);
	});

	it('encurta o nome do evento', () => {
		expect(shortEventName('browser.do11y.page_view')).toBe('page_view');
		expect(shortEventName('outro.evento')).toBe('outro.evento');
	});

	it('sobrevive a payload vazio ou com campos ausentes', () => {
		const metrics = aggregate([
			{ created_at: '2026-08-16T12:00:00Z', payload: {} },
			{ created_at: '2026-08-16T12:00:00Z', payload: { eventName: 'browser.do11y.page_view' } },
		]);

		expect(metrics.totalEvents).toBe(2);
		expect(metrics.pageViews).toBe(1);
		expect(metrics.sessions).toBe(0);
		expect(metrics.topPages[0].path).toBe('(sem caminho)');
	});

	it('não divide por zero sem sessões', () => {
		expect(aggregate([]).aiShare).toBe(0);
		expect(aggregate([]).totalEvents).toBe(0);
	});

	it('propaga a marca de resultado truncado', () => {
		expect(aggregate([], true).truncated).toBe(true);
		expect(aggregate([]).truncated).toBe(false);
	});
});

describe('separação de segredos', () => {
	const config: Do11yConfig = {
		...DEFAULT_CONFIG,
		enabled: true,
		supabaseUrl: 'https://abc.supabase.co',
		supabaseKey: 'sb_publishable_publica',
		serviceRoleKey: 'sb_secret_MUITO_SECRETA_1234',
	};

	it('a configuração do cliente nunca contém a service_role', () => {
		const client = toClientConfig(config);
		const serialized = JSON.stringify(client);

		expect(serialized).not.toContain('sb_secret_MUITO_SECRETA_1234');
		expect(serialized).not.toContain('serviceRoleKey');
		// A publishable precisa estar lá: é ela que o script usa para inserir.
		expect(client.config.supabaseKey).toBe('sb_publishable_publica');
	});

	it('a visão de administração devolve só uma dica da service_role', () => {
		const view = toAdminView(config);
		const serialized = JSON.stringify(view);

		expect(serialized).not.toContain('sb_secret_MUITO_SECRETA_1234');
		expect(view.hasServiceRoleKey).toBe(true);
		expect(view.serviceRoleKeyHint).toBe('••••1234');
	});

	it('desabilitada, não devolve script nem credencial', () => {
		const client = toClientConfig({ ...config, enabled: false });
		expect(client.enabled).toBe(false);
		expect(client.scriptUrl).toBe('');
		expect(JSON.stringify(client.config)).not.toContain('sb_publishable');
	});

	it('sem credenciais, não se declara ativa mesmo com enabled=true', () => {
		const client = toClientConfig({ ...config, supabaseKey: '' });
		expect(client.enabled).toBe(false);
	});

	it('a URL do script aponta para a versão configurada', () => {
		expect(toClientConfig(config).scriptUrl).toContain('@manototh/do11y@latest/dist/do11y.min.js');
		expect(toClientConfig({ ...config, scriptVersion: '1.2.3' }).scriptUrl).toContain('do11y@1.2.3');
	});
});

describe('validação da configuração', () => {
	const base: Do11yConfig = {
		...DEFAULT_CONFIG,
		enabled: true,
		supabaseUrl: 'https://abc.supabase.co',
		supabaseKey: 'k',
		serviceRoleKey: 's',
	};

	it('aceita uma configuração completa', () => {
		expect(validateConfig(base).ok).toBe(true);
	});

	it('não valida nada quando a integração está desligada', () => {
		expect(validateConfig({ ...DEFAULT_CONFIG, enabled: false }).ok).toBe(true);
	});

	it('recusa URL sem HTTPS', () => {
		const result = validateConfig({ ...base, supabaseUrl: 'http://abc.supabase.co' });
		expect(result.ok).toBe(false);
		expect(result.errors.join(' ')).toContain('HTTPS');
	});

	it('recusa URL inválida e credenciais faltando', () => {
		expect(validateConfig({ ...base, supabaseUrl: 'nao-e-url' }).ok).toBe(false);
		expect(validateConfig({ ...base, supabaseKey: '' }).ok).toBe(false);
		expect(validateConfig({ ...base, serviceRoleKey: '' }).ok).toBe(false);
	});

	it('recusa nome de tabela com caracteres de injeção', () => {
		// O nome vai para a URL do PostgREST; só identificador simples passa.
		expect(validateConfig({ ...base, table: 'events; drop table users' }).ok).toBe(false);
		expect(validateConfig({ ...base, table: 'do11y_events' }).ok).toBe(true);
	});

	it('o SQL gerado usa a tabela configurada', () => {
		expect(schemaSql('meus_eventos')).toContain('create table meus_eventos');
		expect(schemaSql('meus_eventos')).toContain('grant select on meus_eventos to service_role');
	});
});

describe('autorização das rotas da integração', () => {
	const viewer: AuthUser = { id: 'v', role: 'viewer', status: 'active' };
	const editor: AuthUser = { id: 'e', role: 'editor', status: 'active' };
	const admin: AuthUser = { id: 'a', role: 'admin', status: 'active' };

	it('a configuração pública do coletor é acessível sem login', () => {
		// As páginas de documentação são estáticas e anônimas; o carregador
		// precisa conseguir buscá-la.
		expect(requiredPermissions('/api/integrations/do11y/client-config')).toEqual([]);
		expect(authorize(null, '/api/integrations/do11y/client-config').kind).toBe('allow');
	});

	it('métricas e configuração exigem admin', () => {
		for (const path of ['/api/admin/analytics/do11y', '/api/admin/integrations/do11y']) {
			expect(authorize(viewer, path).kind).toBe('forbid');
			expect(authorize(editor, path).kind).toBe('forbid');
			expect(authorize(admin, path).kind).toBe('allow');
			expect(authorize(null, path).kind).toBe('authenticate');
		}
	});

	it('gravar a configuração exige integrations.manage', () => {
		expect(requiredPermissions('/api/admin/integrations/do11y', 'PUT')).toContain('integrations.manage');
		expect(requiredPermissions('/api/admin/integrations/do11y', 'POST')).toContain('integrations.manage');
		expect(authorize(editor, '/api/admin/integrations/do11y', 'PUT').kind).toBe('forbid');
		expect(authorize(admin, '/api/admin/integrations/do11y', 'PUT').kind).toBe('allow');
	});

	it('a página de analytics segue protegida pelo prefixo /settings', () => {
		expect(authorize(editor, '/settings/analytics').kind).toBe('forbid');
		expect(authorize(admin, '/settings/analytics').kind).toBe('allow');
	});
});
