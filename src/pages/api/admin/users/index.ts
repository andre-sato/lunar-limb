import type { APIRoute } from 'astro';
import { AuthError, createUser, listUsers } from '../../../../lib/auth/users';
import { httpStatusFor, jsonResponse, requireAuthUser } from '../../../../lib/auth/api';

export const prerender = false;

/**
 * O middleware já exigiu `settings.access` + `users.read`/`users.create` antes
 * de chegar aqui. As verificações dentro do serviço são a segunda camada: uma
 * rota futura que esqueça o middleware ainda assim não escapa das invariantes.
 */

export const GET: APIRoute = async ({ locals }) => {
	const actor = requireAuthUser(locals);
	if (!actor) return jsonResponse({ error: 'unauthorized' }, 401);

	return jsonResponse({ users: await listUsers() }, 200);
};

export const POST: APIRoute = async ({ request, locals }) => {
	const actor = requireAuthUser(locals);
	if (!actor) return jsonResponse({ error: 'unauthorized' }, 401);

	let payload: Record<string, unknown>;
	try {
		payload = await request.json();
	} catch {
		return jsonResponse({ error: 'invalid_request', message: 'Corpo inválido.' }, 400);
	}

	try {
		const { user, generatedPassword } = await createUser(
			{
				name: payload.name as string,
				email: payload.email as string,
				role: payload.role as never,
				status: payload.status as never,
				password: typeof payload.password === 'string' ? payload.password : undefined,
			},
			actor
		);

		// A senha gerada volta uma única vez, para o admin repassá-la. Ela não
		// é recuperável depois — só existe como hash.
		return jsonResponse({ user, generatedPassword }, 201);
	} catch (error) {
		if (error instanceof AuthError) {
			return jsonResponse({ error: error.code, message: error.message }, httpStatusFor(error.code));
		}
		throw error;
	}
};
