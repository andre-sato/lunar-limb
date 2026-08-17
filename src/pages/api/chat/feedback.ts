import type { APIRoute } from 'astro';
import { jsonResponse, requireAuthUser } from '../../../lib/auth/api';
import { recordAnswerFeedback } from '../../../lib/chat/quality';

export const prerender = false;

/**
 * Retorno de qualidade sobre uma resposta (§52, §53).
 *
 * Grava **apenas** o voto e os identificadores. A pergunta e a resposta não são
 * enviadas nem armazenadas: o objetivo é saber se o assistente está ajudando,
 * e para isso a contagem basta. Quem investiga uma resposta ruim tem a
 * auditoria de segurança e o próprio conteúdo da documentação.
 */
export const POST: APIRoute = async ({ request, locals }) => {
	const actor = requireAuthUser(locals);
	if (!actor) return jsonResponse({ error: 'unauthorized' }, 401);

	let payload: Record<string, unknown>;
	try {
		payload = await request.json();
	} catch {
		return jsonResponse({ error: 'invalid_request', message: 'Corpo inválido.' }, 400);
	}

	const vote = payload.vote === 'up' || payload.vote === 'down' ? payload.vote : null;
	const messageId = typeof payload.messageId === 'string' ? payload.messageId : '';

	if (!vote || messageId === '') {
		return jsonResponse({ error: 'invalid_input', message: 'Voto ou mensagem inválidos.' }, 400);
	}

	await recordAnswerFeedback({
		messageId,
		conversationId: typeof payload.conversationId === 'string' ? payload.conversationId : undefined,
		vote,
		userId: actor.id,
	});

	return jsonResponse({ ok: true }, 200);
};
