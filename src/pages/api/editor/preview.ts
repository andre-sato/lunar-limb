import type { APIRoute } from 'astro';
import { renderPreview } from '../../../lib/editor/render-preview';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
	try {
		const body = await request.json();
		const content = body?.content;
		if (typeof content !== 'string') {
			return new Response(JSON.stringify({ error: 'Corpo inválido: esperado { content }.' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' },
			});
		}
		const result = await renderPreview(content);
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
