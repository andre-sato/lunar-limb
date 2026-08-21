import type { APIRoute } from 'astro';
import { buildLlmsFullTxt } from '../lib/ai-readable/llms';
import { collectLlmsInput } from '../lib/ai-readable/collect';
import { recordAgentRead } from '../lib/observe/store';

/**
 * `/llms-full.txt` — o conteúdo inteiro (§3).
 *
 * Existe para quem prefere carregar tudo a fazer várias buscas. Fica atrás de
 * um interruptor (`LLMS_FULL=false` desliga) porque publicar a documentação
 * inteira num arquivo é uma decisão de quem opera o portal, não um padrão.
 *
 * Renderizada no servidor pelo mesmo motivo de `/llms.txt`: rota
 * pré-renderizada é servida como arquivo estático e não passa por código
 * nenhum, então não há onde contar. Esta é a mais cara de montar das três — o
 * corpus inteiro — e por isso o cache abaixo importa mais aqui do que lá.
 */
export const prerender = false;

/** Corpo já montado, por origem. Vive enquanto o processo viver. */
const cache = new Map<string, string>();

export const GET: APIRoute = async ({ site }) => {
	if (process.env.LLMS_FULL === 'false') {
		return new Response('O conteúdo completo está desligado neste portal.\n', {
			status: 404,
			headers: { 'Content-Type': 'text/plain; charset=utf-8' },
		});
	}

	const origin = site?.origin ?? '';

	let body = cache.get(origin);
	if (body === undefined) {
		body = buildLlmsFullTxt(await collectLlmsInput(origin));
		cache.set(origin, body);
	}

	void recordAgentRead('llms-full').catch(() => {
		// Medição nunca pode quebrar a entrega do conteúdo.
	});

	return new Response(body, {
		headers: {
			'Content-Type': 'text/plain; charset=utf-8',
			'Cache-Control': 'public, max-age=3600',
		},
	});
};
