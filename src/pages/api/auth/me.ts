import type { APIRoute } from 'astro';
import { permissionsFor } from '../../../lib/auth/permissions';

export const prerender = false;

/**
 * Identidade da sessão atual, para a UI se adaptar.
 *
 * Rota pública de propósito: responde 200 com `user: null` para anônimos. É
 * uma fonte de conveniência para a interface — nenhuma decisão de segurança
 * depende do que ela devolve.
 */
export const GET: APIRoute = async ({ locals }) => {
	const user = locals.user;

	return new Response(
		JSON.stringify({
			user: user
				? { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status }
				: null,
			permissions: user ? permissionsFor(user.role) : [],
		}),
		{
			status: 200,
			headers: {
				'content-type': 'application/json; charset=utf-8',
				// Resposta depende do cookie: não pode ser cacheada por proxy.
				'cache-control': 'private, no-store',
			},
		}
	);
};
