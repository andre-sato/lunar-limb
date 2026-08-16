import type { APIRoute } from 'astro';
import { clearedCookieOptions, destroySession, SESSION_COOKIE } from '../../../lib/auth/sessions';
import { recordAudit } from '../../../lib/auth/audit';

export const prerender = false;

export const POST: APIRoute = async ({ cookies, locals }) => {
	const token = cookies.get(SESSION_COOKIE)?.value;

	// Encerra no servidor, não só no navegador: apagar o cookie sem invalidar a
	// sessão deixaria o token válido para quem o tivesse copiado.
	await destroySession(token);
	cookies.set(SESSION_COOKIE, '', clearedCookieOptions());

	if (locals.user) {
		await recordAudit({ actorId: locals.user.id, action: 'SESSION_ENDED' });
	}

	return new Response(JSON.stringify({ ok: true }), {
		status: 200,
		headers: { 'content-type': 'application/json; charset=utf-8' },
	});
};
