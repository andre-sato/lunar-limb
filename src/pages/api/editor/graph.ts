import type { APIRoute } from 'astro';
import { checkCycle, getGraphWithProblems } from '../../../lib/editor/content-graph';

export const prerender = false;

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

/**
 * Fase 4 — Content Graph.
 *
 * `GET /api/editor/graph`
 *   → { graph: { nodes, edges, generatedAt }, problems: [...] }
 *
 * `GET /api/editor/graph?source=docs:guides/a.mdx&target=block:auth-warning`
 *   → { cycle: string[] | null } — inserir `target` em `source` fecharia um ciclo?
 *
 * `?fresh=1` ignora o cache curto em memória.
 */
export const GET: APIRoute = async ({ url }) => {
	const source = url.searchParams.get('source');
	const target = url.searchParams.get('target');
	const fresh = url.searchParams.get('fresh') === '1';

	try {
		if (source && target) {
			return json({ cycle: await checkCycle(source, target) });
		}

		const { graph, problems } = await getGraphWithProblems({ fresh });
		return json({ graph, problems });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Erro desconhecido.';
		return json({ error: message }, 500);
	}
};
