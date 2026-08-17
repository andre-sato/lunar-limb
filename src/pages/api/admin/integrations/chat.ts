import type { APIRoute } from 'astro';
import {
	AVAILABLE_MODELS,
	loadChatConfig,
	saveChatConfig,
	toAdminView,
	validateChatConfig,
	type ChatConfig,
} from '../../../../lib/chat/config';
import { summarizeChatQuality } from '../../../../lib/chat/quality';
import { conversationCount } from '../../../../lib/chat/store';
import { jsonResponse, requireAuthUser } from '../../../../lib/auth/api';
import { listAudit, recordAudit } from '../../../../lib/auth/audit';

export const prerender = false;

/** Ações de auditoria que contam como incidente de segurança do chat (§70). */
const SECURITY_ACTIONS = [
	'CHAT_BLOCKED',
	'CHAT_PROMPT_INJECTION',
	'CHAT_JAILBREAK',
	'CHAT_INDIRECT_INJECTION',
	'CHAT_OUTPUT_BLOCKED',
	'CHAT_RATE_LIMITED',
] as const;

export const GET: APIRoute = async ({ locals }) => {
	const actor = requireAuthUser(locals);
	if (!actor) return jsonResponse({ error: 'unauthorized' }, 401);

	const config = await loadChatConfig();
	const quality = await summarizeChatQuality();

	// Painel de segurança: contagem por tipo de incidente, sem conteúdo.
	const events = await listAudit({ limit: 500 });
	const incidents: Record<string, number> = {};
	for (const action of SECURITY_ACTIONS) incidents[action] = 0;
	for (const event of events) {
		if (event.action in incidents) incidents[event.action]++;
	}

	return jsonResponse(
		{
			config: toAdminView(config),
			models: AVAILABLE_MODELS,
			quality,
			incidents,
			activeConversations: conversationCount(),
		},
		200
	);
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

	const patch: Partial<ChatConfig> = {};

	for (const key of ['enabled', 'generationEnabled'] as const) {
		if (typeof payload[key] === 'boolean') patch[key] = payload[key] as boolean;
	}
	if (typeof payload.model === 'string') patch.model = payload.model;
	if (payload.effort === 'low' || payload.effort === 'medium' || payload.effort === 'high') {
		patch.effort = payload.effort;
	}
	for (const key of ['maxOutputTokens', 'retrievalThreshold', 'maxChunks', 'rateLimitPerHour'] as const) {
		if (typeof payload[key] === 'number') patch[key] = payload[key] as number;
	}

	// A chave só é gravada quando vem preenchida. A tela nunca a recebe de
	// volta, então salvar sem tocá-la precisa preservar a existente.
	if (typeof payload.apiKey === 'string' && payload.apiKey.trim() !== '') {
		patch.apiKey = payload.apiKey.trim();
	}
	// Remoção explícita, para quem quiser voltar ao modo só-retrieval.
	if (payload.removeApiKey === true) patch.apiKey = '';

	const candidate = { ...(await loadChatConfig()), ...patch };
	const validation = validateChatConfig(candidate);
	if (!validation.ok) {
		return jsonResponse({ error: 'invalid_input', message: validation.errors.join(' ') }, 400);
	}

	const saved = await saveChatConfig(patch);

	await recordAudit({
		actorId: actor.id,
		action: 'INTEGRATION_UPDATED',
		metadata: {
			integration: 'chat',
			enabled: saved.enabled,
			model: saved.model,
			// Nunca a chave em si — auditoria é lida por gente e é exportada.
			apiKeyChanged: patch.apiKey !== undefined,
		},
	});

	return jsonResponse({ config: toAdminView(saved), models: AVAILABLE_MODELS }, 200);
};
