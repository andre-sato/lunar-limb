import type { APIRoute } from 'astro';
import { jsonResponse, requireAuthUser } from '../../../lib/auth/api';
import { can } from '../../../lib/auth/permissions';
import { listAudit } from '../../../lib/auth/audit';
import { governance } from '../../../lib/governance/service';

export const prerender = false;

/**
 * Documentation Governance (P3.1).
 *
 * Só `GET`. Declarar dono, revisor ou revisão é alteração de conteúdo: vive no
 * frontmatter da página, versionado pelo Git, e passa pelo editor como qualquer
 * outra edição. Um verbo de escrita aqui criaria um segundo lugar onde a
 * governança de uma página pode estar — e os dois divergiriam.
 */
export const GET: APIRoute = async ({ url, locals }) => {
	const actor = requireAuthUser(locals);
	if (!actor) return jsonResponse({ error: 'unauthorized' }, 401);
	if (!can(actor, 'settings.access')) return jsonResponse({ error: 'forbidden' }, 403);

	const view = url.searchParams.get('view') ?? 'status';

	try {
		if (view === 'owners') return jsonResponse({ owners: await governance.owners() }, 200);
		if (view === 'overdue') return jsonResponse({ overdue: await governance.overdue() }, 200);

		if (view === 'audit') {
			const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 200);
			return jsonResponse({ events: await listAudit({ limit }) }, 200);
		}

		if (view === 'page') {
			const pagePath = url.searchParams.get('path');
			if (!pagePath) return jsonResponse({ error: 'invalid_request', message: 'Informe a página.' }, 400);

			const entry = await governance.forPage(pagePath);
			return entry ? jsonResponse(entry, 200) : jsonResponse({ error: 'not_found' }, 404);
		}

		const snapshot = await governance.status();
		return jsonResponse(snapshot, 200);
	} catch (error) {
		console.error('[governance] falha ao montar o relatório', error);
		return jsonResponse({ error: 'internal_error' }, 500);
	}
};
