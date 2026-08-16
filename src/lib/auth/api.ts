/**
 * Utilidades compartilhadas pelas rotas de API protegidas.
 */

import type { AuthUser } from './permissions';
import type { AuthErrorCode } from './users';

export function jsonResponse(body: unknown, status: number): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'cache-control': 'private, no-store',
		},
	});
}

/**
 * Recupera o ator da requisição.
 *
 * O middleware já barrou anônimos nestas rotas; isto é a rede de segurança
 * para o caso de a rota ser chamada por um caminho que não passou por ele.
 */
export function requireAuthUser(locals: App.Locals): AuthUser | null {
	const actor = locals.authUser;
	if (!actor || actor.status !== 'active') return null;
	return actor;
}

export function httpStatusFor(code: AuthErrorCode): number {
	switch (code) {
		case 'not_found':
			return 404;
		case 'forbidden':
			return 403;
		case 'email_taken':
		case 'last_admin':
			return 409;
		case 'invalid_input':
		default:
			return 400;
	}
}
