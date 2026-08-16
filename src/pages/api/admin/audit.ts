import type { APIRoute } from 'astro';
import { listAudit, type AuditAction } from '../../../lib/auth/audit';
import { listUsers } from '../../../lib/auth/users';
import { jsonResponse, requireAuthUser } from '../../../lib/auth/api';

export const prerender = false;

export const GET: APIRoute = async ({ url, locals }) => {
	const actor = requireAuthUser(locals);
	if (!actor) return jsonResponse({ error: 'unauthorized' }, 401);

	const limitParam = Number.parseInt(url.searchParams.get('limit') ?? '100', 10);
	const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 500) : 100;
	const action = url.searchParams.get('action') as AuditAction | null;

	const events = await listAudit({ limit, action: action ?? undefined });

	// Resolve os ids em nomes aqui, e não no cliente: a tela de auditoria não
	// deve precisar baixar a lista inteira de usuários para ser legível.
	const users = await listUsers();
	const names = new Map(users.map((user) => [user.id, user.name]));

	return jsonResponse(
		{
			events: events.map((event) => ({
				...event,
				actorName: names.get(event.actorId) ?? (event.actorId === 'anonymous' ? 'Anônimo' : 'Usuário removido'),
				targetName: event.targetId ? (names.get(event.targetId) ?? 'Usuário removido') : undefined,
			})),
		},
		200
	);
};
