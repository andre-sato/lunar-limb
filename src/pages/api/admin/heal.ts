import type { APIRoute } from 'astro';
import { jsonResponse, requireAuthUser } from '../../../lib/auth/api';
import { can } from '../../../lib/auth/permissions';
import { recordAudit } from '../../../lib/auth/audit';
import { selfHealing } from '../../../lib/heal/service';

export const prerender = false;

/**
 * Self-Healing Documentation (P3.6).
 *
 * `POST` só aceita `detect`, `diagnose` e `draft`. **Não existe verbo de
 * aplicar.** O texto proposto vive no workspace isolado do Agent Orchestrator, e
 * a aprovação acontece lá, onde já existem revisão humana e trilha de auditoria
 * — dar a esta rota um caminho próprio de publicação criaria uma segunda porta
 * para o repositório.
 */
export const GET: APIRoute = async ({ url, locals }) => {
	const actor = requireAuthUser(locals);
	if (!actor) return jsonResponse({ error: 'unauthorized' }, 401);
	if (!can(actor, 'settings.access')) return jsonResponse({ error: 'forbidden' }, 403);

	try {
		const view = url.searchParams.get('view') ?? 'status';

		if (view === 'history') {
			return jsonResponse({ records: await selfHealing.getHistory(url.searchParams.get('issue') ?? undefined) }, 200);
		}

		const [summary, policy, records] = await Promise.all([
			selfHealing.summary(),
			selfHealing.policy(),
			selfHealing.getHistory(),
		]);

		return jsonResponse({ summary, policy, records }, 200);
	} catch (error) {
		console.error('[heal] falha ao montar o relatório', error);
		return jsonResponse({ error: 'internal_error' }, 500);
	}
};

export const POST: APIRoute = async ({ request, locals }) => {
	const actor = requireAuthUser(locals);
	if (!actor) return jsonResponse({ error: 'unauthorized' }, 401);
	if (!can(actor, 'settings.access')) return jsonResponse({ error: 'forbidden' }, 403);

	let payload: Record<string, unknown> = {};
	try {
		payload = (await request.json()) as Record<string, unknown>;
	} catch {
		return jsonResponse({ error: 'invalid_request' }, 400);
	}

	const action = payload.action;
	const issueId = typeof payload.issueId === 'string' ? payload.issueId.slice(0, 200) : undefined;

	try {
		if (action === 'detect') return jsonResponse({ issues: await selfHealing.detect() }, 200);

		if (!issueId) return jsonResponse({ error: 'invalid_request', message: 'Informe o problema.' }, 400);

		if (action === 'diagnose') {
			const diagnosis = await selfHealing.diagnose(issueId);
			return diagnosis ? jsonResponse(diagnosis, 200) : jsonResponse({ error: 'not_found' }, 404);
		}

		if (action === 'draft') {
			const candidate = await selfHealing.propose(issueId, actor.id);

			// Redigir consome tempo e, com modelo configurado, dinheiro — e produz
			// conteúdo. As três razões pedem registro de quem mandou.
			await recordAudit({
				actorId: actor.id,
				action: 'HEALING_DRAFTED',
				targetId: issueId,
				metadata: { produced: candidate !== null, risk: candidate?.risk ?? null, validated: candidate?.validated ?? null },
			});

			return jsonResponse({ candidate }, 200);
		}

		return jsonResponse({ error: 'invalid_request', message: 'Ação desconhecida.' }, 400);
	} catch (error) {
		console.error('[heal] falha ao executar', error);
		return jsonResponse({ error: 'internal_error' }, 500);
	}
};
