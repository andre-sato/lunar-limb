import type { APIRoute } from 'astro';
import { AuthError, deleteUser, findUserById, updateUser, type UpdateUserInput } from '../../../../lib/auth/users';
import { destroySessionsForUser } from '../../../../lib/auth/sessions';
import { httpStatusFor, jsonResponse, requireAuthUser, readJsonObject } from '../../../../lib/auth/api';

export const prerender = false;

export const GET: APIRoute = async ({ params, locals }) => {
	const actor = requireAuthUser(locals);
	if (!actor) return jsonResponse({ error: 'unauthorized' }, 401);

	const user = await findUserById(params.id!);
	if (!user) return jsonResponse({ error: 'not_found' }, 404);
	return jsonResponse({ user }, 200);
};

export const PATCH: APIRoute = async ({ params, request, locals }) => {
	const actor = requireAuthUser(locals);
	if (!actor) return jsonResponse({ error: 'unauthorized' }, 401);

	const parsed = await readJsonObject(request);
	if (!parsed.ok) return jsonResponse({ error: 'invalid_request', message: parsed.error }, 400);

	const payload = parsed.value;

	// Lista branca de campos: qualquer outra coisa no corpo é descartada antes
	// de chegar ao serviço. `id`, `createdAt` e `passwordHash` não são
	// editáveis por requisição, e não basta "não usá-los" — eles não entram.
	const patch: UpdateUserInput = {};
	if (typeof payload.name === 'string') patch.name = payload.name;
	if (typeof payload.email === 'string') patch.email = payload.email;
	if (typeof payload.role === 'string') patch.role = payload.role as never;
	if (typeof payload.status === 'string') patch.status = payload.status as never;
	if (typeof payload.password === 'string' && payload.password !== '') patch.password = payload.password;

	try {
		const user = await updateUser(params.id!, patch, actor);

		// Perder acesso precisa valer imediatamente: desativação, rebaixamento
		// de papel e troca de senha encerram as sessões abertas do alvo.
		if (patch.status === 'inactive' || patch.role !== undefined || patch.password !== undefined) {
			await destroySessionsForUser(user.id);
		}

		return jsonResponse({ user }, 200);
	} catch (error) {
		if (error instanceof AuthError) {
			return jsonResponse({ error: error.code, message: error.message }, httpStatusFor(error.code));
		}
		throw error;
	}
};

export const DELETE: APIRoute = async ({ params, locals }) => {
	const actor = requireAuthUser(locals);
	if (!actor) return jsonResponse({ error: 'unauthorized' }, 401);

	try {
		await deleteUser(params.id!, actor);
		await destroySessionsForUser(params.id!);
		return jsonResponse({ ok: true }, 200);
	} catch (error) {
		if (error instanceof AuthError) {
			return jsonResponse({ error: error.code, message: error.message }, httpStatusFor(error.code));
		}
		throw error;
	}
};
