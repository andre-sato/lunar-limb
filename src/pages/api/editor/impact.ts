import type { APIRoute } from 'astro';
import { analyzeImpactOf } from '../../../lib/impact/engine';
import { detectDefaultBranch } from '../../../lib/git/workflow';

export const prerender = false;

/**
 * Análise de impacto (§9, §13).
 *
 * A autorização vem do middleware: `/api/editor` inteiro exige `editor.access`.
 *
 * Dois modos, e a diferença é a pergunta:
 *
 *     ?path=src/content/snippets/x.mdx   "se eu mexer aqui, o que muda junto?"
 *     ?base=main                         "o que este PR exige de revisão?"
 *
 * O primeiro é o preview de antes de salvar, e por isso não toca no Git: ele
 * responde sobre o arquivo como ele está, não sobre um diff que ainda não existe.
 */

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

export const GET: APIRoute = async ({ url }) => {
	try {
		const file = url.searchParams.get('path');

		if (file) {
			// Caminho vindo da interface: só conteúdo do portal, e nada de subir na
			// árvore. Análise lê arquivo, e um `../` aqui viraria leitura arbitrária.
			const normalized = file.replace(/\\/g, '/');
			const allowed = /^src\/(content\/(docs|snippets|glossary)\/[^\0]+\.mdx?|schemas\/[^\0/]+\.(ya?ml|json))$/.test(
				normalized
			);
			if (!allowed || normalized.includes('..')) {
				return json({ error: 'Caminho fora do conteúdo do portal.' }, 400);
			}

			return json(await analyzeImpactOf({ file: normalized }));
		}

		const base = url.searchParams.get('base') || (await detectDefaultBranch());
		return json(await analyzeImpactOf({ base }));
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : 'Falha ao analisar o impacto.' }, 500);
	}
};
