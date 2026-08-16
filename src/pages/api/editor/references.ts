import type { APIRoute } from 'astro';
import { getReferencesFor } from '../../../lib/editor/content-graph';
import { isContentRootKey } from '../../../lib/editor/content-fs';

export const prerender = false;

/**
 * `GET /api/editor/references?path=guides/a.mdx&root=docs`
 *
 * Retorna os dois lados do grafo para um arquivo (§20 da especificação):
 * o que ele usa, quem o usa, o impacto transitivo de editá-lo e os problemas
 * (referência quebrada / circular) que pertencem a ele.
 */
export const GET: APIRoute = async ({ url }) => {
	const filePath = url.searchParams.get('path');
	const rootParam = url.searchParams.get('root');
	if (!filePath) {
		return new Response(JSON.stringify({ error: 'Parâmetro "path" é obrigatório.' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}
	const root = isContentRootKey(rootParam) ? rootParam : 'docs';

	try {
		const result = await getReferencesFor(`${root}:${filePath}`);
		return new Response(
			JSON.stringify({
				node: result.node,
				uses: result.uses,
				usedBy: result.usedBy,
				impact: result.impact,
				problems: result.problems,
			}),
			{ status: 200, headers: { 'Content-Type': 'application/json' } }
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Erro desconhecido.';
		return new Response(JSON.stringify({ error: message }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
};
