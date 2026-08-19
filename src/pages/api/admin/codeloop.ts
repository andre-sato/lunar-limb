import type { APIRoute } from 'astro';
import { jsonResponse, requireAuthUser } from '../../../lib/auth/api';
import { can } from '../../../lib/auth/permissions';
import { documentationImpact, loadPolicy } from '../../../lib/codeloop/service';

export const prerender = false;

/**
 * Documentation-to-Code Loop (P2.2).
 *
 * Só `GET`. Esta camada **lê** o repositório e responde relatório; quem escreve
 * conteúdo é o Agent Orchestrator, em workspace isolado e com aprovação humana.
 * Não expor verbo de escrita aqui é o que mantém essa fronteira verificável.
 */
export const GET: APIRoute = async ({ url, locals }) => {
	const actor = requireAuthUser(locals);
	if (!actor) return jsonResponse({ error: 'unauthorized' }, 401);
	if (!can(actor, 'settings.access')) return jsonResponse({ error: 'forbidden' }, 403);

	const view = url.searchParams.get('view') ?? 'overview';

	try {
		if (view === 'impact') {
			const range = url.searchParams.get('range') ?? 'HEAD';
			// Faixa vem da query: restringir ao formato de referência do Git evita que
			// ela vire argumento arbitrário de linha de comando.
			if (!/^[\w.\-/]+(\.\.\.?[\w.\-/]+)?$/.test(range)) {
				return jsonResponse({ error: 'invalid_request', message: 'Faixa de commits inválida.' }, 400);
			}
			return jsonResponse(await documentationImpact.analyze(range), 200);
		}

		if (view === 'bindings') {
			return jsonResponse({ bindings: await documentationImpact.getBindings() }, 200);
		}

		if (view === 'orphans') {
			return jsonResponse({ orphans: await documentationImpact.findOrphans() }, 200);
		}

		if (view === 'undocumented') {
			return jsonResponse({ entities: await documentationImpact.findUndocumented() }, 200);
		}

		const [consistency, bindings, orphans, undocumented, policy] = await Promise.all([
			documentationImpact.consistency(),
			documentationImpact.getBindings(),
			documentationImpact.findOrphans(),
			documentationImpact.findUndocumented(),
			loadPolicy(),
		]);

		return jsonResponse({ consistency, bindings, orphans, undocumented, policy }, 200);
	} catch (error) {
		console.error('[codeloop] falha ao montar o relatório', error);
		return jsonResponse({ error: 'internal_error' }, 500);
	}
};
