import type { APIRoute } from 'astro';
import { verifyCredentials } from '../../../lib/auth/users';
import { createSession, sessionCookieOptions, SESSION_COOKIE } from '../../../lib/auth/sessions';
import { recordAudit } from '../../../lib/auth/audit';
import { readJsonObject } from '../../../lib/auth/api';

export const prerender = false;

/**
 * Limitador de tentativas por IP, em memória.
 *
 * Não substitui um limitador de verdade na borda, mas transforma força bruta
 * online em algo inviável, que é o ataque realista contra um formulário de
 * login exposto.
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const attempts = new Map<string, { count: number; resetAt: number }>();

function tooManyAttempts(key: string): boolean {
	const now = Date.now();
	const entry = attempts.get(key);
	if (!entry || entry.resetAt <= now) return false;
	return entry.count >= MAX_ATTEMPTS;
}

function registerFailure(key: string): void {
	const now = Date.now();
	const entry = attempts.get(key);
	if (!entry || entry.resetAt <= now) {
		attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
		return;
	}
	entry.count++;
}

function clearFailures(key: string): void {
	attempts.delete(key);
}

function clientKey(request: Request, clientAddress: string | undefined): string {
	const forwarded = request.headers.get('x-forwarded-for');
	if (forwarded) return forwarded.split(',')[0].trim();
	return clientAddress ?? 'unknown';
}

export const POST: APIRoute = async ({ request, cookies, clientAddress }) => {
	const key = clientKey(request, clientAddress);

	if (tooManyAttempts(key)) {
		return new Response(
			JSON.stringify({ error: 'too_many_attempts', message: 'Muitas tentativas. Tente novamente mais tarde.' }),
			{ status: 429, headers: { 'content-type': 'application/json; charset=utf-8' } }
		);
	}

	// Rota pública e anterior à autenticação: é a superfície mais exposta do
	// portal, e a que menos pode confiar no formato do que chega.
	const parsed = await readJsonObject(request);
	if (!parsed.ok) {
		return new Response(JSON.stringify({ error: 'invalid_request' }), {
			status: 400,
			headers: { 'content-type': 'application/json; charset=utf-8' },
		});
	}

	const payload: { email?: unknown; password?: unknown } = parsed.value;

	const user = await verifyCredentials(payload.email, payload.password);

	if (!user) {
		registerFailure(key);
		await recordAudit({
			actorId: 'anonymous',
			action: 'SESSION_DENIED',
			metadata: { email: typeof payload.email === 'string' ? payload.email : null },
		});
		// Mensagem única para e-mail inexistente, senha errada e conta inativa.
		return new Response(
			JSON.stringify({ error: 'invalid_credentials', message: 'E-mail ou senha inválidos.' }),
			{ status: 401, headers: { 'content-type': 'application/json; charset=utf-8' } }
		);
	}

	clearFailures(key);

	const { token, expiresAt } = await createSession(user.id);
	cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));

	await recordAudit({ actorId: user.id, action: 'SESSION_STARTED' });

	return new Response(
		JSON.stringify({
			user: { id: user.id, name: user.name, email: user.email, role: user.role },
			mustChangePassword: Boolean(user.mustChangePassword),
		}),
		{ status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } }
	);
};
