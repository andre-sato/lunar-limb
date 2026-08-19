import type { APIRoute } from 'astro';
import { jsonResponse, requireAuthUser } from '../../../lib/auth/api';
import { can } from '../../../lib/auth/permissions';
import { knowledgeGraph } from '../../../lib/graph/service';

export const prerender = false;

/**
 * Knowledge Graph (P3.4).
 *
 * Só leitura. O grafo é **derivado** do repositório: se ele discordar do Git,
 * quem está errado é o grafo. Um verbo de escrita aqui criaria um nó que nenhum
 * arquivo sustenta, e o grafo deixaria de ser verificável.
 *
 * `rebuild` é a exceção aparente, e não é escrita: ele descarta o cache e lê as
 * fontes de novo.
 */
export const GET: APIRoute = async ({ url, locals }) => {
	const actor = requireAuthUser(locals);
	if (!actor) return jsonResponse({ error: 'unauthorized' }, 401);
	if (!can(actor, 'settings.access')) return jsonResponse({ error: 'forbidden' }, 403);

	const view = url.searchParams.get('view') ?? 'status';

	try {
		if (view === 'query') {
			const text = url.searchParams.get('q') ?? '';
			if (text.trim() === '') return jsonResponse({ error: 'invalid_request', message: 'Informe o que procurar.' }, 400);

			return jsonResponse(
				{ matches: await knowledgeGraph.query(text.slice(0, 120), { type: url.searchParams.get('type') ?? undefined, limit: 25 }) },
				200
			);
		}

		if (view === 'impact') {
			const nodeId = url.searchParams.get('node');
			if (!nodeId) return jsonResponse({ error: 'invalid_request', message: 'Informe o nó.' }, 400);

			const depth = Math.min(Math.max(Number(url.searchParams.get('depth')) || 3, 1), 5);
			return jsonResponse(await knowledgeGraph.impact(nodeId.slice(0, 200), { maxDepth: depth }), 200);
		}

		if (view === 'rebuild') return jsonResponse(await knowledgeGraph.rebuild(), 200);

		return jsonResponse(await knowledgeGraph.status(), 200);
	} catch (error) {
		console.error('[graph] falha ao consultar', error);
		return jsonResponse({ error: 'internal_error' }, 500);
	}
};
