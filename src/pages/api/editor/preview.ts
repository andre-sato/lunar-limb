import type { APIRoute } from 'astro';
import { renderPreview } from '../../../lib/editor/render-preview';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
	try {
		const body = await request.json();
		const content = body?.content;
		const docPath = typeof body?.path === 'string' ? body.path : undefined;

		if (typeof content !== 'string') {
			return new Response(JSON.stringify({ error: 'Corpo inválido: esperado { content }.' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		const isMdx = docPath ? docPath.toLowerCase().endsWith('.mdx') : false;
		const result = await renderPreview(content, { isMdx, docPath });
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
