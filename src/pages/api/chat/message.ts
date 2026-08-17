import type { APIRoute } from 'astro';
import { jsonResponse, requireAuthUser } from '../../../lib/auth/api';
import { recordAudit } from '../../../lib/auth/audit';
import { loadChatConfig } from '../../../lib/chat/config';
import { normalizeLocale } from '../../../lib/chat/retrieval';
import { ChatError, searchDocumentation } from '../../../lib/chat/search';
import { checkRateLimit, getOrCreateConversation } from '../../../lib/chat/store';

export const prerender = false;

/**
 * Uma consulta à documentação.
 *
 * O middleware já garantiu autenticação e `docs.read` (ver `guard.ts`); a
 * checagem aqui é a segunda camada, não a primeira — uma rota que confia apenas
 * no middleware fica insegura no dia em que alguém mexe na tabela de rotas.
 */
export const POST: APIRoute = async ({ request, locals }) => {
	const actor = requireAuthUser(locals);
	if (!actor) return jsonResponse({ error: 'unauthorized' }, 401);

	const config = await loadChatConfig();
	if (!config.enabled) {
		return jsonResponse({ error: 'disabled', message: 'A busca na documentação está desativada.' }, 503);
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
				message: `Você atingiu o limite de ${config.rateLimitPerHour} buscas por hora.`,
				retryAfter: limit.retryAfter,
			}),
			{
				status: 429,
				headers: { 'content-type': 'application/json', 'retry-after': String(limit.retryAfter) },
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

	try {
		const answer = await searchDocumentation(conversation, message, user, {
			maxExcerpts: config.maxExcerpts,
			minScore: config.minScore,
			excerptChars: config.excerptChars,
		});
		return jsonResponse({ ...answer, remaining: limit.remaining }, 200);
	} catch (error) {
		if (error instanceof ChatError) {
			const status = error.code === 'unauthorized' ? 403 : 400;
			return jsonResponse({ error: error.code, message: error.message }, status);
		}
		console.error('[chat] falha inesperada', error);
		return jsonResponse({ error: 'internal_error', message: 'Não consegui buscar agora.' }, 500);
	}
};
