import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { jsonResponse, requireAuthUser, readJsonObject } from '../../../lib/auth/api';
import { can } from '../../../lib/auth/permissions';
import { runTask } from '../../../lib/agents/orchestrator';
import { approveRun, cancelRun, getRun, listRuns, rejectRun } from '../../../lib/agents/store';
import type { AutonomyLevel, DocumentationTask } from '../../../lib/agents/types';

export const prerender = false;

/**
 * Agent Orchestrator (§31, §43).
 *
 * `GET` lista as execuções ou devolve uma. `POST` cria, aprova, rejeita ou
 * cancela.
 *
 * Aprovar **não publica** (§22). Ele muda o estado da execução; levar o conteúdo
 * do workspace isolado ao repositório é um passo separado e explícito. Juntar as
 * duas coisas transformaria "aprovar" e "publicar" no mesmo clique, que é
 * exatamente o que a spec proíbe.
 */

export const GET: APIRoute = async ({ url, locals }) => {
	const actor = requireAuthUser(locals);
	if (!actor) return jsonResponse({ error: 'unauthorized' }, 401);

	try {
		const id = url.searchParams.get('id');
		if (id) {
			const run = await getRun(id);
			return run ? jsonResponse(run, 200) : jsonResponse({ error: 'not_found' }, 404);
		}

		return jsonResponse({ runs: await listRuns() }, 200);
	} catch (error) {
		return jsonResponse({ error: error instanceof Error ? error.message : 'Falha ao listar execuções.' }, 500);
	}
};

export const POST: APIRoute = async ({ request, locals }) => {
	const actor = requireAuthUser(locals);
	if (!actor) return jsonResponse({ error: 'unauthorized' }, 401);

	// Disparar agente consome recursos e escreve no workspace; aprovar decide o
	// que vai para o repositório. As duas são ações de quem administra.
	if (!can(actor, 'settings.access')) return jsonResponse({ error: 'forbidden' }, 403);

	const parsed = await readJsonObject(request);
	if (!parsed.ok) return jsonResponse({ error: 'invalid_request' }, 400);

	const payload = parsed.value;

	const action = String(payload.action ?? 'run');

	try {
		if (action === 'run') {
			const instruction = String(payload.instruction ?? '').trim();
			if (instruction === '') {
				return jsonResponse({ error: 'invalid_request', message: 'A instrução é obrigatória.' }, 400);
			}

			const autonomy = Number(payload.autonomy ?? 2);
			if (![0, 1, 2, 3].includes(autonomy)) {
				return jsonResponse({ error: 'invalid_request', message: 'Autonomia deve ser 0, 1, 2 ou 3.' }, 400);
			}

			const task: DocumentationTask = {
				id: randomUUID(),
				type: (String(payload.type ?? 'update') as DocumentationTask['type']) ?? 'update',
				target: typeof payload.target === 'string' && payload.target.trim() !== '' ? payload.target : undefined,
				instruction,
			};

			const run = await runTask(task, { actorId: actor.id, config: { autonomy: autonomy as AutonomyLevel } });
			return jsonResponse(run, 200);
		}

		const id = String(payload.id ?? '');
		if (id === '') return jsonResponse({ error: 'invalid_request', message: 'Informe o id da execução.' }, 400);

		if (action === 'approve') {
			const run = await approveRun(id, actor.id);
			return run
				? jsonResponse({ ok: true, run, message: 'Aprovado. O conteúdo continua no workspace até ser aplicado.' }, 200)
				: jsonResponse({ error: 'not_found' }, 404);
		}

		if (action === 'reject') {
			const run = await rejectRun(id, actor.id, typeof payload.reason === 'string' ? payload.reason : undefined);
			return run ? jsonResponse({ ok: true, run }, 200) : jsonResponse({ error: 'not_found' }, 404);
		}

		if (action === 'cancel') {
			const run = await cancelRun(id, actor.id);
			return run ? jsonResponse({ ok: true, run }, 200) : jsonResponse({ error: 'not_found' }, 404);
		}

		return jsonResponse({ error: 'unknown_action' }, 400);
	} catch (error) {
		return jsonResponse({ error: error instanceof Error ? error.message : 'Falha na ação.' }, 500);
	}
};
