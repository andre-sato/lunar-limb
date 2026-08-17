import type { APIRoute } from 'astro';
import { loadDo11yConfig, toClientConfig } from '../../../../lib/integrations/do11y';

export const prerender = false;

/**
 * Configuração pública do coletor Do11y.
 *
 * Rota **pública** de propósito: o bootstrap injetado no `<head>` das páginas
 * de documentação a consulta, e essas páginas são estáticas e anônimas.
 *
 * O que sai daqui é exatamente o que já apareceria no HTML se a instalação
 * fosse a oficial (URL do projeto e chave publishable, cuja política de RLS só
 * permite `insert`). `toClientConfig` não tem acesso à `service_role` — a
 * separação está no tipo, não numa lembrança de filtrar o campo.
 */
export const GET: APIRoute = async () => {
	const config = await loadDo11yConfig();

	return new Response(JSON.stringify(toClientConfig(config)), {
		status: 200,
		headers: {
			'content-type': 'application/json; charset=utf-8',
			// Curto: mudar a configuração em Settings precisa surtir efeito sem
			// esperar cache expirar, mas sem uma ida ao servidor por página.
			'cache-control': 'public, max-age=60',
		},
	});
};
