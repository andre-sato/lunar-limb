import type { APIRoute } from 'astro';
import { jsonResponse, requireAuthUser } from '../../../lib/auth/api';
import { can } from '../../../lib/auth/permissions';
import { recordAudit } from '../../../lib/auth/audit';
import { loadDatasets } from '../../../lib/eval/datasets';
import { runEvaluation } from '../../../lib/eval/runner';
import { compareRuns } from '../../../lib/eval/regression';
import { latestRun, listRuns, saveRun } from '../../../lib/eval/store';
import { DEFAULT_EVAL_POLICY } from '../../../lib/eval/types';

export const prerender = false;

/**
 * AI Evaluation (P3.3).
 *
 * `GET` lê corridas guardadas e compara duas. `POST` executa uma corrida — e é
 * o único verbo de escrita desta camada, porque executar consome tempo e, com
 * modelo configurado, dinheiro. Por isso ele exige `settings.access` e fica no
 * log de auditoria: uma rota que gasta precisa dizer quem mandou gastar.
 */
export const GET: APIRoute = async ({ url, locals }) => {
	const actor = requireAuthUser(locals);
	if (!actor) return jsonResponse({ error: 'unauthorized' }, 401);
	if (!can(actor, 'settings.access')) return jsonResponse({ error: 'forbidden' }, 403);

	try {
		const view = url.searchParams.get('view') ?? 'latest';

		if (view === 'history') {
			const runs = await listRuns();
			return jsonResponse({ runs: runs.map(({ results, ...run }) => ({ ...run, cases: results.length })) }, 200);
		}

		if (view === 'compare') {
			const [baseline, candidate] = await Promise.all([
				latestRun(url.searchParams.get('baseline') ?? 'baseline'),
				latestRun(url.searchParams.get('candidate') ?? undefined),
			]);

			if (!baseline || !candidate) return jsonResponse({ error: 'not_found', message: 'Não há duas corridas para comparar.' }, 404);
			return jsonResponse(compareRuns(baseline, candidate, DEFAULT_EVAL_POLICY), 200);
		}

		if (view === 'datasets') {
			const cases = await loadDatasets();
			return jsonResponse({ cases: cases.map(({ mustNotContain, ...entry }) => entry) }, 200);
		}

		const run = await latestRun();
		return run ? jsonResponse(run, 200) : jsonResponse({ error: 'not_found' }, 404);
	} catch (error) {
		console.error('[ai-eval] falha ao ler avaliações', error);
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
		// Corpo ausente é corrida completa com rótulo padrão.
	}

	const dataset = typeof payload.dataset === 'string' ? payload.dataset : undefined;
	const label = typeof payload.label === 'string' && payload.label.trim() !== '' ? payload.label.trim().slice(0, 40) : 'local';

	try {
		const cases = await loadDatasets(dataset);
		if (cases.length === 0) return jsonResponse({ error: 'invalid_request', message: 'Nenhum caso encontrado.' }, 400);

		const run = await runEvaluation(cases, { label });
		await saveRun(run);
		await recordAudit({ actorId: actor.id, action: 'AI_EVALUATION_RUN', targetId: run.id, metadata: { label, cases: cases.length } });

		return jsonResponse(run, 200);
	} catch (error) {
		console.error('[ai-eval] falha ao executar', error);
		return jsonResponse({ error: 'internal_error' }, 500);
	}
};
