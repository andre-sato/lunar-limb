import type { APIRoute } from 'astro';
import { listReusable } from '../../../lib/editor/content-graph';

export const prerender = false;

export const GET: APIRoute = async () => {
	try {
		const result = await listReusable();
		return new Response(JSON.stringify(result), {
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
