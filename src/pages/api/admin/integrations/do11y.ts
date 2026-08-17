import type { APIRoute } from 'astro';
import {
	loadDo11yConfig,
	saveDo11yConfig,
	toAdminView,
	validateConfig,
	schemaSql,
	type Do11yConfig,
} from '../../../../lib/integrations/do11y';
import { testConnection } from '../../../../lib/integrations/do11y-query';
import { jsonResponse, requireAuthUser } from '../../../../lib/auth/api';
import { recordAudit } from '../../../../lib/auth/audit';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
	const actor = requireAuthUser(locals);
	if (!actor) return jsonResponse({ error: 'unauthorized' }, 401);

	const config = await loadDo11yConfig();
	return jsonResponse({ config: toAdminView(config), schemaSql: schemaSql(config.table) }, 200);
};

export const PUT: APIRoute = async ({ request, locals }) => {
	const actor = requireAuthUser(locals);
	if (!actor) return jsonResponse({ error: 'unauthorized' }, 401);

	let payload: Record<string, unknown>;
	try {
		payload = await request.json();
	} catch {
		return jsonResponse({ error: 'invalid_request', message: 'Corpo inválido.' }, 400);
	}

	const patch: Partial<Do11yConfig> = {};
	for (const key of ['supabaseUrl', 'supabaseKey', 'table', 'scriptVersion'] as const) {
		if (typeof payload[key] === 'string') patch[key] = (payload[key] as string).trim();
	}
	for (const key of [
		'enabled',
		'trackScrollDepth',
		'trackSectionVisibility',
		'trackOutboundLinks',
		'trackInternalLinks',
		'trackTocClicks',
		'trackFeedback',
		'respectDNT',
		'debug',
	] as const) {
		if (typeof payload[key] === 'boolean') patch[key] = payload[key] as boolean;
	}

	// A service_role só é gravada quando vem preenchida. A tela devolve o campo
	// vazio (nunca a chave), então salvar sem tocá-lo precisa **preservar** a
	// chave existente em vez de apagá-la.
	if (typeof payload.serviceRoleKey === 'string' && payload.serviceRoleKey.trim() !== '') {
		patch.serviceRoleKey = payload.serviceRoleKey.trim();
	}

	const candidate = { ...(await loadDo11yConfig()), ...patch };
	const validation = validateConfig(candidate);
	if (!validation.ok) {
		return jsonResponse({ error: 'invalid_input', message: validation.errors.join(' ') }, 400);
	}

	const saved = await saveDo11yConfig(patch);

	await recordAudit({
		actorId: actor.id,
		action: 'INTEGRATION_UPDATED',
		metadata: {
			integration: 'do11y',
			enabled: saved.enabled,
			// Nunca registrar as chaves em si — auditoria é lida por gente e
			// costuma ser exportada.
			serviceRoleKeyChanged: patch.serviceRoleKey !== undefined,
		},
	});

	return jsonResponse({ config: toAdminView(saved), schemaSql: schemaSql(saved.table) }, 200);
};

/** Teste de conexão: valida credenciais e existência da tabela. */
export const POST: APIRoute = async ({ locals }) => {
	const actor = requireAuthUser(locals);
	if (!actor) return jsonResponse({ error: 'unauthorized' }, 401);

	const config = await loadDo11yConfig();
	if (!config.supabaseUrl || !config.serviceRoleKey) {
		return jsonResponse(
			{ ok: false, message: 'Configure a URL do Supabase e a chave service_role antes de testar.' },
			400
		);
	}

	const result = await testConnection({
		supabaseUrl: config.supabaseUrl,
		serviceRoleKey: config.serviceRoleKey,
		table: config.table,
	});

	return jsonResponse(result, 200);
};
