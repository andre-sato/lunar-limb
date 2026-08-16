import type { APIRoute } from 'astro';
import { getGitStatus } from '../../../lib/editor/git-status';

export const prerender = false;

/** `GET /api/editor/git` → estado do working tree para os arquivos de conteúdo. */
export const GET: APIRoute = async () => {
	try {
		return new Response(JSON.stringify(await getGitStatus()), {
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
