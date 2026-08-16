import type { APIRoute } from 'astro';
import { renderPreview } from '../../../lib/editor/render-preview';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
	try {
		const body = await request.json();
		const content = body?.content;
		const filePath = typeof body?.path === 'string' ? body.path : undefined;
		const root = body?.root === 'snippets' ? 'snippets' : 'docs';

		if (typeof content !== 'string') {
			return new Response(JSON.stringify({ error: 'Corpo inválido: esperado { content }.' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		// O modo MDX vem da extensão do arquivo aberto, seja ele uma página ou um
		// snippet — um snippet .mdx também precisa do parser MDX para que
		// <ContentBlock>/<If> dentro dele resolvam no preview.
		const isMdx = filePath ? filePath.toLowerCase().endsWith('.mdx') : false;
		// A resolução de imagem relativa só faz sentido a partir de src/content/docs.
		const docPath = root === 'docs' ? filePath : undefined;

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
