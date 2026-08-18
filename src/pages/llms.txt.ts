import type { APIRoute } from 'astro';
import { buildLlmsTxt } from '../lib/ai-readable/llms';
import { collectLlmsInput } from '../lib/ai-readable/collect';

export const prerender = true;

/**
 * `/llms.txt` — o índice do portal para agentes (§3).
 *
 * Pré-renderizado: o conteúdo só muda quando o portal é reconstruído, e servir
 * isto sob demanda gastaria uma leitura do disco por requisição de robô.
 */
export const GET: APIRoute = async ({ site }) => {
	const input = await collectLlmsInput(site?.origin ?? '');

	return new Response(buildLlmsTxt(input), {
		headers: {
			'Content-Type': 'text/plain; charset=utf-8',
			'Cache-Control': 'public, max-age=3600',
		},
	});
};
