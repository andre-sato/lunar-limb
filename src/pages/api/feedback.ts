import type { APIRoute } from 'astro';
import { attachComment, FeedbackError, submitFeedback } from '../../lib/feedback/store';
import { readJsonObject } from '../../lib/auth/api';

export const prerender = false;

/**
 * Recebe o voto do leitor.
 *
 * Rota **pública e anônima**: as páginas de documentação são estáticas e
 * abertas, e exigir login para dizer "isto não ajudou" eliminaria justamente
 * quem se quer ouvir.
 *
 * O preço de ser aberta é ser um alvo de abuso, então há limite por IP,
 * validação estrita do caminho e teto no comentário. O IP é usado só para o
 * limite, em memória — não é gravado com o voto.
 */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_SUBMISSIONS = 20;
const attempts = new Map<string, { count: number; resetAt: number }>();

function clientKey(request: Request, clientAddress: string | undefined): string {
	const forwarded = request.headers.get('x-forwarded-for');
	if (forwarded) return forwarded.split(',')[0].trim();
	return clientAddress ?? 'unknown';
}

function rateLimited(key: string): boolean {
	const now = Date.now();
	const entry = attempts.get(key);
	if (!entry || entry.resetAt <= now) {
		attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
		return false;
	}
	entry.count++;
	return entry.count > MAX_SUBMISSIONS;
}

function json(body: unknown, status: number): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
	});
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
	if (rateLimited(clientKey(request, clientAddress))) {
		return json({ error: 'too_many_requests' }, 429);
	}

	const parsed = await readJsonObject(request);
	if (!parsed.ok) return json({ error: 'invalid_request' }, 400);

	const payload = parsed.value;

	try {
		// Duas formas: um voto novo, ou um comentário para um voto já enviado.
		// A segunda existe para o comentário não virar um segundo voto.
		if (typeof payload.id === 'string') {
			const attached = await attachComment(payload.id, payload.comment);
			return json({ ok: attached }, 200);
		}

		const entry = await submitFeedback({
			path: payload.path,
			locale: payload.locale,
			rating: payload.rating,
			comment: payload.comment,
		});

		// O id volta só para o comentário poder ser anexado a este voto. É um
		// UUID opaco e não revela nada sobre os demais registros.
		return json({ ok: true, id: entry.id }, 201);
	} catch (error) {
		if (error instanceof FeedbackError) return json({ error: 'invalid_input', message: error.message }, 400);
		throw error;
	}
};
