import type { APIRoute } from 'astro';
import { buildLlmsFullTxt } from '../lib/ai-readable/llms';
import { collectLlmsInput } from '../lib/ai-readable/collect';

export const prerender = true;

/**
 * `/llms-full.txt` — o conteúdo inteiro (§3).
 *
 * Existe para quem prefere carregar tudo a fazer várias buscas. Fica atrás de
 * um interruptor (`LLMS_FULL=false` desliga) porque publicar a documentação
 * inteira num arquivo é uma decisão de quem opera o portal, não um padrão.
 */
export const GET: APIRoute = async ({ site }) => {
	if (process.env.LLMS_FULL === 'false') {
		return new Response('O conteúdo completo está desligado neste portal.\n', {
			status: 404,
			headers: { 'Content-Type': 'text/plain; charset=utf-8' },
		});
	}

	const input = await collectLlmsInput(site?.origin ?? '');

	return new Response(buildLlmsFullTxt(input), {
		headers: {
			'Content-Type': 'text/plain; charset=utf-8',
			'Cache-Control': 'public, max-age=3600',
		},
	});
};
