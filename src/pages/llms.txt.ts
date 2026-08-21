import type { APIRoute } from 'astro';
import { buildLlmsTxt } from '../lib/ai-readable/llms';
import { collectLlmsInput } from '../lib/ai-readable/collect';
import { recordAgentRead } from '../lib/observe/store';

/**
 * `/llms.txt` — o índice do portal para agentes (§3).
 *
 * **Renderizada no servidor, e a razão é medição.** Pré-renderizada, esta rota
 * é servida como arquivo estático e não passa nem pelo handler nem pelo
 * middleware — verificado: uma sonda no middleware nunca disparou para
 * `/llms.txt` num build de produção. Sem passar por código não há como contar, e
 * a leitura por agentes ficaria invisível justamente na superfície construída
 * para eles.
 *
 * O custo de renderizar por requisição é evitado pelo cache abaixo: o conteúdo
 * só muda quando o portal é reconstruído, então a primeira requisição do
 * processo monta e as seguintes servem da memória.
 */
export const prerender = false;

/** Corpo já montado, por origem. Vive enquanto o processo viver. */
const cache = new Map<string, string>();

export const GET: APIRoute = async ({ site }) => {
	const origin = site?.origin ?? '';

	let body = cache.get(origin);
	if (body === undefined) {
		body = buildLlmsTxt(await collectLlmsInput(origin));
		cache.set(origin, body);
	}

	// Sem `await`: a latência da gravação não entra na resposta do agente.
	void recordAgentRead('llms-index').catch(() => {
		// Medição nunca pode quebrar a entrega do conteúdo.
	});

	return new Response(body, {
		headers: {
			'Content-Type': 'text/plain; charset=utf-8',
			'Cache-Control': 'public, max-age=3600',
		},
	});
};
