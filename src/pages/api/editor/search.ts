import type { APIRoute } from 'astro';
import { searchContent } from '../../../lib/editor/search';

export const prerender = false;

/** `GET /api/editor/search?q=autenticacao[&case=1]` → { hits } */
export const GET: APIRoute = async ({ url }) => {
	const query = url.searchParams.get('q') ?? '';
	const caseSensitive = url.searchParams.get('case') === '1';

	try {
		const hits = await searchContent(query, { caseSensitive });
		return new Response(JSON.stringify({ hits }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Erro desconhecido.';
		return new Response(JSON.stringify({ error: message }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
};
