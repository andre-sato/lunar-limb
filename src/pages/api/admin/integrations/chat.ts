import type { APIRoute } from 'astro';
import { loadChatConfig, saveChatConfig, type ChatConfig } from '../../../../lib/chat/config';
import { summarizeChatQuality } from '../../../../lib/chat/quality';
import { conversationCount } from '../../../../lib/chat/store';
import { jsonResponse, requireAuthUser, readJsonObject } from '../../../../lib/auth/api';
import { listAudit, recordAudit } from '../../../../lib/auth/audit';

export const prerender = false;

/**
 * Configuração da busca na documentação.
 *
 * Diferente das outras integrações, esta pode ser devolvida inteira: não há
 * chave de API para mascarar, porque não há provedor. A simplificação eliminou a
 * classe de risco em vez de administrá-la.
 */
export const GET: APIRoute = async ({ locals }) => {
	const actor = requireAuthUser(locals);
	if (!actor) return jsonResponse({ error: 'unauthorized' }, 401);

	const [config, quality, events] = await Promise.all([
		loadChatConfig(),
		summarizeChatQuality(),
		listAudit({ action: 'CHAT_RATE_LIMITED', limit: 200 }),
	]);

	return jsonResponse(
		{
			config,
			quality,
			activeConversations: conversationCount(),
			rateLimitHits: events.length,
		},
		200
	);
};

export const PUT: APIRoute = async ({ request, locals }) => {
	const actor = requireAuthUser(locals);
	if (!actor) return jsonResponse({ error: 'unauthorized' }, 401);

	const parsed = await readJsonObject(request);
	if (!parsed.ok) return jsonResponse({ error: 'invalid_request', message: parsed.error }, 400);

	const payload = parsed.value;

	const patch: Partial<ChatConfig> = {};
	if (typeof payload.enabled === 'boolean') patch.enabled = payload.enabled;
	for (const key of ['maxExcerpts', 'minScore', 'excerptChars', 'rateLimitPerHour'] as const) {
		if (typeof payload[key] === 'number') patch[key] = payload[key] as number;
	}

	const saved = await saveChatConfig(patch);

	await recordAudit({
		actorId: actor.id,
		action: 'INTEGRATION_UPDATED',
		metadata: { integration: 'chat', enabled: saved.enabled, maxExcerpts: saved.maxExcerpts },
	});

	return jsonResponse({ config: saved }, 200);
};
