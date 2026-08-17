import type { APIRoute } from 'astro';
import { jsonResponse, requireAuthUser } from '../../../lib/auth/api';
import { recordAudit, type AuditAction } from '../../../lib/auth/audit';
import { loadChatConfig } from '../../../lib/chat/config';
import { anthropicModel } from '../../../lib/chat/models';
import { ChatError, createChatService } from '../../../lib/chat/service';
import { normalizeLocale } from '../../../lib/chat/retrieval';
import { checkRateLimit, getOrCreateConversation } from '../../../lib/chat/store';
import type { ChatSecurityEvent } from '../../../lib/chat/types';

export const prerender = false;

/**
 * Um turno de conversa.
 *
 * O middleware já garantiu autenticação e `docs.read` (ver `guard.ts`); a
 * checagem aqui é a segunda camada, não a primeira — uma rota que confia
 * apenas no middleware fica insegura no dia em que alguém mexe na tabela de
 * rotas.
 */

/** Tradução dos eventos do pipeline para as ações de auditoria. */
const AUDIT_BY_EVENT: Partial<Record<ChatSecurityEvent['event'], AuditAction>> = {
	CHAT_BLOCKED: 'CHAT_BLOCKED',
	PROMPT_INJECTION_DETECTED: 'CHAT_PROMPT_INJECTION',
	JAILBREAK_DETECTED: 'CHAT_JAILBREAK',
	INDIRECT_INJECTION_DETECTED: 'CHAT_INDIRECT_INJECTION',
	OUTPUT_BLOCKED: 'CHAT_OUTPUT_BLOCKED',
};

export const POST: APIRoute = async ({ request, locals }) => {
	const actor = requireAuthUser(locals);
	if (!actor) return jsonResponse({ error: 'unauthorized' }, 401);

	const config = await loadChatConfig();
	if (!config.enabled) {
		return jsonResponse({ error: 'disabled', message: 'O assistente está desativado.' }, 503);
	}

	let payload: Record<string, unknown>;
	try {
		payload = await request.json();
	} catch {
		return jsonResponse({ error: 'invalid_request', message: 'Corpo inválido.' }, 400);
	}

	const message = typeof payload.message === 'string' ? payload.message : '';
	const conversationId = typeof payload.conversationId === 'string' ? payload.conversationId : undefined;

	const limit = checkRateLimit(actor.id, config.rateLimitPerHour);
	if (!limit.allowed) {
		await recordAudit({
			actorId: actor.id,
			action: 'CHAT_RATE_LIMITED',
			metadata: { limitPerHour: config.rateLimitPerHour },
		});
		return new Response(
			JSON.stringify({
				error: 'rate_limited',
				message: `Você atingiu o limite de ${config.rateLimitPerHour} mensagens por hora.`,
				retryAfter: limit.retryAfter,
			}),
			{
				status: 429,
				headers: {
					'content-type': 'application/json',
					'retry-after': String(limit.retryAfter),
				},
			}
		);
	}

	const user = { id: actor.id, role: actor.role, status: actor.status };
	const conversation = getOrCreateConversation(conversationId, user);

	// O idioma vem do cliente e é normalizado contra a lista de traduções
	// existentes — nada do que chega aqui vira caminho de arquivo.
	if (typeof payload.locale === 'string') {
		conversation.locale = normalizeLocale(payload.locale);
	}

	const service = createChatService({
		model: anthropicModel({
			apiKey: config.apiKey,
			model: config.model,
			effort: config.effort,
			temperature: 0,
		}),
		generationEnabled: config.generationEnabled && config.apiKey !== '',
		maxOutputTokens: config.maxOutputTokens,
		retrievalThreshold: config.retrievalThreshold,
		maxChunks: config.maxChunks,
		onEvent: async (event) => {
			const action = AUDIT_BY_EVENT[event.event];
			if (!action) return; // CHAT_REQUEST/CHAT_COMPLETED não vão para auditoria.
			await recordAudit({
				actorId: event.userId ?? actor.id,
				action,
				metadata: {
					conversationId: event.conversationId,
					riskCategory: event.riskCategory,
					confidence: event.confidence,
				},
			});
		},
	});

	try {
		const response = await service.sendMessage(conversation, message, user);
		return jsonResponse(
			{ ...response, remaining: limit.remaining },
			200
		);
	} catch (error) {
		if (error instanceof ChatError) {
			const status = error.code === 'unauthorized' ? 403 : 400;
			return jsonResponse({ error: error.code, message: error.message }, status);
		}
		// Erro inesperado: a mensagem genérica evita expor detalhes internos.
		console.error('[chat] falha inesperada', error);
		return jsonResponse({ error: 'internal_error', message: 'Não consegui responder agora.' }, 500);
	}
};
