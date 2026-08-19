import type { APIRoute } from 'astro';
import { jsonResponse, requireAuthUser } from '../../../lib/auth/api';
import { can } from '../../../lib/auth/permissions';
import { recordAudit } from '../../../lib/auth/audit';
import { compare, diffPage, getImpact, getSnapshot, resolveSnapshotRef, restore } from '../../../lib/history/service';
import { documentationHistory } from '../../../lib/history/service';
import { releases } from '../../../lib/history/git';

export const prerender = false;

/**
 * Documentation Time Machine (P2.1).
 *
 * `GET` responde sobre o passado: timeline, snapshot, comparação, impacto de um
 * commit, releases. Tudo derivado do Git a cada chamada — não há índice paralelo
 * que possa divergir do repositório.
 *
 * `POST` só aceita `restore`, e restaurar escreve **no workspace isolado**. A
 * branch principal não é alterada por esta rota, nem por nenhuma outra desta
 * camada.
 */

function badRequest(message: string): Response {
	return jsonResponse({ error: 'invalid_request', message }, 400);
}

export const GET: APIRoute = async ({ url, locals }) => {
	const actor = requireAuthUser(locals);
	if (!actor) return jsonResponse({ error: 'unauthorized' }, 401);

	try {
		if (!(await documentationHistory.available())) {
			return jsonResponse({ error: 'no_history', message: 'Este diretório não é um repositório Git.' }, 503);
		}

		const view = url.searchParams.get('view') ?? 'timeline';

		if (view === 'releases') return jsonResponse({ releases: await releases() }, 200);

		if (view === 'impact') {
			const commit = url.searchParams.get('commit');
			if (!commit) return badRequest('Informe o commit.');

			const impact = await getImpact(commit);
			return impact ? jsonResponse(impact, 200) : jsonResponse({ error: 'not_found' }, 404);
		}

		if (view === 'snapshot') {
			const at = url.searchParams.get('at') ?? 'HEAD';
			const ref = await resolveSnapshotRef(at);
			if (!ref) return badRequest(`Não consegui resolver "${at}".`);

			const snapshot = await getSnapshot(ref, { maxPages: 400 });
			// A lista de páginas com conteúdo inteiro seria megabytes; o painel só
			// precisa dos caminhos e das métricas.
			return jsonResponse({ ...snapshot, pages: snapshot.pages.map((page) => page.path) }, 200);
		}

		if (view === 'compare') {
			const from = url.searchParams.get('from');
			const to = url.searchParams.get('to');
			if (!from || !to) return badRequest('Informe `from` e `to`.');

			const [left, right] = await Promise.all([resolveSnapshotRef(from), resolveSnapshotRef(to)]);
			if (!left || !right) return badRequest('Não consegui resolver uma das referências.');

			const comparison = await compare(left, right, { maxPages: 400 });

			const page = url.searchParams.get('page');
			const pageDiff = page ? await diffPage(page, left, right) : undefined;

			return jsonResponse({ comparison, page: pageDiff }, 200);
		}

		const page = url.searchParams.get('page');
		if (!page) return badRequest('Informe a página.');

		return jsonResponse({ timeline: await documentationHistory.getTimeline(page) }, 200);
	} catch (error) {
		return jsonResponse({ error: error instanceof Error ? error.message : 'Falha ao consultar o histórico.' }, 500);
	}
};

export const POST: APIRoute = async ({ request, locals }) => {
	const actor = requireAuthUser(locals);
	if (!actor) return jsonResponse({ error: 'unauthorized' }, 401);

	// Restaurar prepara uma alteração de conteúdo; é ação de quem edita, não de
	// quem lê.
	if (!can(actor, 'editor.access')) return jsonResponse({ error: 'forbidden' }, 403);

	let payload: Record<string, unknown>;
	try {
		payload = await request.json();
	} catch {
		return badRequest('Corpo inválido.');
	}

	if (String(payload.action ?? '') !== 'restore') return jsonResponse({ error: 'unknown_action' }, 400);

	const page = String(payload.page ?? '');
	const at = String(payload.at ?? '');
	if (page === '' || at === '') return badRequest('Informe `page` e `at`.');

	try {
		const ref = await resolveSnapshotRef(at);
		if (!ref) return badRequest(`Não consegui resolver "${at}".`);

		const result = await restore(page, ref);
		if (!result) return jsonResponse({ error: 'not_found', message: `\`${page}\` não existia em ${at}.` }, 404);

		await recordAudit({
			actorId: actor.id,
			action: 'HISTORY_RESTORE_PREPARED',
			metadata: { page, at, ref: ref.ref, runId: result.runId },
		});

		return jsonResponse(
			{
				...result,
				message: 'A restauração está no workspace isolado. A branch principal não foi alterada.',
			},
			200
		);
	} catch (error) {
		return jsonResponse({ error: error instanceof Error ? error.message : 'Falha ao restaurar.' }, 500);
	}
};
