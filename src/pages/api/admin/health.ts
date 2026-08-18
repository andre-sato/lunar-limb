import type { APIRoute } from 'astro';
import { jsonResponse, requireAuthUser } from '../../../lib/auth/api';
import { can } from '../../../lib/auth/permissions';
import { recordAudit } from '../../../lib/auth/audit';
import { collectHealth } from '../../../lib/health/collect';
import { buildBacklog, composeAlert } from '../../../lib/health/gaps';
import { createIssueAlert, sendWebhookAlert } from '../../../lib/health/alerts';
import { forgetQuestions } from '../../../lib/health/analytics';
import { DIMENSION_LABEL } from '../../../lib/health/types';

export const prerender = false;

/**
 * Health Center (§2, §10, §11, §12).
 *
 * `GET` monta o painel. `POST` executa uma ação: disparar alerta ou apagar o
 * texto das perguntas guardadas.
 *
 * O alerta **não** sai sozinho. Um alerta automático a cada análise vira
 * notificação repetida no canal da equipe, e a primeira coisa que se faz com
 * notificação repetida é silenciá-la — o que mata justamente o alerta que
 * importava. Aqui ele é ação de quem administra, e fica na auditoria.
 */

export const GET: APIRoute = async ({ locals }) => {
	const actor = requireAuthUser(locals);
	if (!actor) return jsonResponse({ error: 'unauthorized' }, 401);

	try {
		const report = await collectHealth();
		return jsonResponse({ ...report, backlog: buildBacklog(report.gaps) }, 200);
	} catch (error) {
		return jsonResponse({ error: error instanceof Error ? error.message : 'Falha ao medir a saúde.' }, 500);
	}
};

export const POST: APIRoute = async ({ request, locals }) => {
	const actor = requireAuthUser(locals);
	if (!actor) return jsonResponse({ error: 'unauthorized' }, 401);

	// Enviar alerta fala com o mundo fora do portal, e apagar registro destrói
	// dado. Nenhuma das duas é ação de leitor: exige quem administra.
	if (!can(actor, 'settings.access')) return jsonResponse({ error: 'forbidden' }, 403);

	let payload: Record<string, unknown>;
	try {
		payload = await request.json();
	} catch {
		return jsonResponse({ error: 'invalid_request' }, 400);
	}

	const action = String(payload.action ?? '');

	if (action === 'forget-questions') {
		await forgetQuestions();
		await recordAudit({ actorId: actor.id, action: 'HEALTH_QUESTIONS_FORGOTTEN', metadata: {} });
		return jsonResponse({ ok: true }, 200);
	}

	if (action !== 'alert') return jsonResponse({ error: 'unknown_action' }, 400);

	try {
		const report = await collectHealth();
		const breached = report.slo
			.filter((item) => item.status === 'breached')
			.map((item) => ({ dimension: DIMENSION_LABEL[item.dimension], current: item.current, target: item.target }));

		if (breached.length === 0) {
			// Não há alerta a mandar. Dizer isso é melhor que enviar uma mensagem
			// vazia dizendo que está tudo bem — ninguém pediu esse relatório.
			return jsonResponse({ ok: true, sent: [], message: 'Nenhum SLO violado; nada a alertar.' }, 200);
		}

		const message = composeAlert({ breached, topGaps: report.gaps });
		const channels = Array.isArray(payload.channels) ? payload.channels.map(String) : ['webhook'];

		const sent = [];
		if (channels.includes('webhook')) sent.push(await sendWebhookAlert(message));
		if (channels.includes('issue')) {
			sent.push(await createIssueAlert('SLO de documentação violado', message));
		}

		await recordAudit({
			actorId: actor.id,
			action: 'HEALTH_ALERT_SENT',
			metadata: {
				breached: breached.length,
				channels: sent.map((result) => `${result.channel}:${result.sent ? 'ok' : 'falhou'}`).join(','),
			},
		});

		return jsonResponse({ ok: true, sent, message }, 200);
	} catch (error) {
		return jsonResponse({ error: error instanceof Error ? error.message : 'Falha ao alertar.' }, 500);
	}
};
