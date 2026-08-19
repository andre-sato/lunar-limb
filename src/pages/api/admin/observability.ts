import type { APIRoute } from 'astro';
import { jsonResponse, requireAuthUser } from '../../../lib/auth/api';
import { can } from '../../../lib/auth/permissions';
import { recordAudit } from '../../../lib/auth/audit';
import { collectObservability } from '../../../lib/observe/service';
import { loadObservabilityConfig } from '../../../lib/observe/config';
import { userSuccessScore } from '../../../lib/observe/analyze';
import { forgetObservations } from '../../../lib/observe/store';

export const prerender = false;

/**
 * Documentation Observability (P3.2).
 *
 * `GET` devolve o relatório agregado — e devolve junto o limiar de agregação e se
 * o texto das buscas está sendo guardado, porque um painel de comportamento que
 * não declara o que coleta deixa quem opera o portal sem saber o que tem em mãos.
 *
 * `DELETE` apaga tudo. Ele existe porque a spec pede exclusão, e porque um botão
 * de apagar que ninguém implementou é uma promessa de privacidade que o produto
 * não cumpre. Destruir dado fica no log de auditoria.
 */
export const GET: APIRoute = async ({ url, locals }) => {
	const actor = requireAuthUser(locals);
	if (!actor) return jsonResponse({ error: 'unauthorized' }, 401);
	if (!can(actor, 'settings.access')) return jsonResponse({ error: 'forbidden' }, 403);

	const days = Number(url.searchParams.get('days'));
	const windowDays = Number.isFinite(days) && days > 0 ? Math.min(Math.round(days), 365) : undefined;

	try {
		const [report, config] = await Promise.all([collectObservability(windowDays), loadObservabilityConfig()]);

		return jsonResponse(
			{
				...report,
				userSuccess: userSuccessScore(report),
				minimumSessions: config.minimumSessions,
				storeQueryText: config.storeQueryText,
			},
			200
		);
	} catch (error) {
		console.error('[observability] falha ao montar o relatório', error);
		return jsonResponse({ error: 'internal_error' }, 500);
	}
};

export const DELETE: APIRoute = async ({ locals }) => {
	const actor = requireAuthUser(locals);
	if (!actor) return jsonResponse({ error: 'unauthorized' }, 401);
	if (!can(actor, 'settings.access')) return jsonResponse({ error: 'forbidden' }, 403);

	await forgetObservations();
	await recordAudit({ actorId: actor.id, action: 'OBSERVATIONS_FORGOTTEN' });

	return jsonResponse({ ok: true }, 200);
};
