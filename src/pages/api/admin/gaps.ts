import type { APIRoute } from 'astro';
import { jsonResponse, requireAuthUser, readJsonObject } from '../../../lib/auth/api';
import { can } from '../../../lib/auth/permissions';
import { recordAudit } from '../../../lib/auth/audit';
import { analyzeDocumentationGaps, documentationGaps } from '../../../lib/gaps/service';
import { forgetSignals } from '../../../lib/gaps/telemetry';

export const prerender = false;

/**
 * Documentation Gap Mining (§16, §17, §20, §22, §29).
 *
 * `GET` analisa e lista; `?id=` devolve o dossiê de um gap. `POST` move o gap no
 * ciclo de vida.
 *
 * `resolve` **pode recusar**, e essa é a parte que importa: publicar uma página
 * não é evidência de que o gap sumiu. A evidência é o sinal cair.
 */

export const GET: APIRoute = async ({ url, locals }) => {
	const actor = requireAuthUser(locals);
	if (!actor) return jsonResponse({ error: 'unauthorized' }, 401);

	try {
		const id = url.searchParams.get('id');
		if (id) {
			const gap = await documentationGaps.get(id);
			return gap ? jsonResponse(gap, 200) : jsonResponse({ error: 'not_found' }, 404);
		}

		return jsonResponse(await analyzeDocumentationGaps(), 200);
	} catch (error) {
		return jsonResponse({ error: error instanceof Error ? error.message : 'Falha ao analisar as lacunas.' }, 500);
	}
};

export const POST: APIRoute = async ({ request, locals }) => {
	const actor = requireAuthUser(locals);
	if (!actor) return jsonResponse({ error: 'unauthorized' }, 401);

	// Mover o ciclo de vida e apagar telemetria são ações de quem administra.
	if (!can(actor, 'settings.access')) return jsonResponse({ error: 'forbidden' }, 403);

	const parsed = await readJsonObject(request);
	if (!parsed.ok) return jsonResponse({ error: 'invalid_request' }, 400);

	const payload = parsed.value;

	const action = String(payload.action ?? '');

	if (action === 'forget-signals') {
		await forgetSignals();
		await recordAudit({ actorId: actor.id, action: 'GAP_SIGNALS_FORGOTTEN', metadata: {} });
		return jsonResponse({ ok: true }, 200);
	}

	const id = String(payload.id ?? '');
	if (id === '') return jsonResponse({ error: 'invalid_request', message: 'Informe o id do gap.' }, 400);

	try {
		if (action === 'acknowledge') {
			await documentationGaps.acknowledge(id, actor.id);
		} else if (action === 'start') {
			await documentationGaps.start(id, actor.id);
		} else if (action === 'dismiss') {
			await documentationGaps.dismiss(id, actor.id);
		} else if (action === 'resolve') {
			const result = await documentationGaps.resolve(id, actor.id);
			await recordAudit({
				actorId: actor.id,
				action: 'GAP_STATUS_CHANGED',
				metadata: { gapId: id, action, resolved: result.resolved },
			});
			return jsonResponse({ ok: true, ...result }, 200);
		} else {
			return jsonResponse({ error: 'unknown_action' }, 400);
		}

		await recordAudit({ actorId: actor.id, action: 'GAP_STATUS_CHANGED', metadata: { gapId: id, action } });
		return jsonResponse({ ok: true }, 200);
	} catch (error) {
		return jsonResponse({ error: error instanceof Error ? error.message : 'Falha ao atualizar o gap.' }, 500);
	}
};
