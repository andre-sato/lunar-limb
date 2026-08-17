import type { APIRoute } from 'astro';
import { loadDo11yConfig } from '../../../../lib/integrations/do11y';
import { loadMetrics, Do11yQueryError } from '../../../../lib/integrations/do11y-query';
import { jsonResponse, requireAuthUser } from '../../../../lib/auth/api';

export const prerender = false;

const RANGES: Record<string, number> = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 };

export const GET: APIRoute = async ({ url, locals }) => {
	const actor = requireAuthUser(locals);
	if (!actor) return jsonResponse({ error: 'unauthorized' }, 401);

	const config = await loadDo11yConfig();
	if (!config.enabled) {
		return jsonResponse({ state: 'disabled' }, 200);
	}
	if (!config.supabaseUrl || !config.serviceRoleKey) {
		return jsonResponse({ state: 'unconfigured' }, 200);
	}

	const rangeKey = url.searchParams.get('range') ?? '7d';
	const days = RANGES[rangeKey] ?? RANGES['7d'];
	const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

	// A consulta sai do servidor do portal para o Supabase; sem um teto, uma
	// instância lenta prenderia o request do dashboard indefinidamente.
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 15000);

	try {
		const metrics = await loadMetrics({
			supabaseUrl: config.supabaseUrl,
			serviceRoleKey: config.serviceRoleKey,
			table: config.table,
			since,
			signal: controller.signal,
		});

		return jsonResponse({ state: 'ok', range: rangeKey, since: since.toISOString(), metrics }, 200);
	} catch (error) {
		if (error instanceof Do11yQueryError) {
			// A mensagem do PostgREST ajuda o admin a corrigir a configuração
			// (tabela inexistente, chave inválida) e esta rota já exige
			// settings.access — não há vazamento para quem não deveria ver.
			return jsonResponse({ state: 'error', message: error.message }, 200);
		}
		const aborted = (error as Error)?.name === 'AbortError';
		return jsonResponse(
			{ state: 'error', message: aborted ? 'O Supabase demorou demais para responder.' : 'Falha ao consultar.' },
			200
		);
	} finally {
		clearTimeout(timeout);
	}
};
