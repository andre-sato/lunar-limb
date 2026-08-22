import type { APIRoute } from 'astro';
import {
	GitWorkflowError,
	createBranch,
	deleteBranch,
	listBranches,
	renameBranch,
	switchBranch,
} from '../../../../lib/git/workflow';
import { recordAudit } from '../../../../lib/auth/audit';
import { readJsonObject } from '../../../../lib/auth/api';

export const prerender = false;

/**
 * Branches do repositório (§3.1).
 *
 * A autorização acontece antes daqui, no middleware: `/api/editor` inteiro exige
 * `editor.access`. Estas rotas **escrevem** no repositório, então cada operação
 * vira um evento de auditoria — trocar de branch muda o que todo mundo vê no
 * editor, e um registro do "quem" e "quando" é o mínimo.
 */

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

function failure(error: unknown): Response {
	if (error instanceof GitWorkflowError) {
		const status = error.code === 'invalid_name' ? 400 : error.code === 'not_allowed' ? 403 : error.code === 'conflict' ? 409 : 500;
		return json({ error: error.message, code: error.code }, status);
	}
	return json({ error: error instanceof Error ? error.message : 'Falha no Git.' }, 500);
}

export const GET: APIRoute = async () => {
	try {
		return json(await listBranches());
	} catch (error) {
		return failure(error);
	}
};

export const POST: APIRoute = async ({ request, locals }) => {
	const parsed = await readJsonObject(request);
	if (!parsed.ok) return json({ error: parsed.error }, 400);

	try {
		const body = parsed.value;
		const { action } = body;

		switch (action) {
			case 'create': {
				const name = await createBranch(String(body.name ?? ''), body.base ? String(body.base) : undefined);
				await recordAudit({
					actorId: locals.user?.id ?? 'anonymous',
					action: 'BRANCH_CREATED',
					metadata: { branch: name, base: body.base ?? null },
				});
				return json({ ok: true, branch: name });
			}

			case 'switch': {
				const name = await switchBranch(String(body.name ?? ''));
				await recordAudit({
					actorId: locals.user?.id ?? 'anonymous',
					action: 'BRANCH_SWITCHED',
					metadata: { branch: name },
				});
				return json({ ok: true, branch: name });
			}

			case 'rename': {
				const name = await renameBranch(String(body.from ?? ''), String(body.to ?? ''));
				await recordAudit({
					actorId: locals.user?.id ?? 'anonymous',
					action: 'BRANCH_RENAMED',
					metadata: { from: body.from ?? null, to: name },
				});
				return json({ ok: true, branch: name });
			}

			case 'delete': {
				await deleteBranch(String(body.name ?? ''));
				await recordAudit({
					actorId: locals.user?.id ?? 'anonymous',
					action: 'BRANCH_DELETED',
					metadata: { branch: String(body.name ?? '') },
				});
				return json({ ok: true });
			}

			default:
				return json({ error: 'Ação desconhecida.' }, 400);
		}
	} catch (error) {
		return failure(error);
	}
};
