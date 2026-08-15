import type { APIRoute } from 'astro';
import { getTree } from '../../../lib/editor/content-fs';

export const prerender = false;

export const GET: APIRoute = async () => {
	try {
		const tree = await getTree();
		return new Response(JSON.stringify({ tree }), {
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
