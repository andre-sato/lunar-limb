/**
 * Alvo de publicação.
 *
 * O portal tem duas naturezas no mesmo repositório: um **site de documentação**,
 * que é HTML estático, e uma **aplicação** — editor, login, Settings, chat,
 * feedback — que precisa de um servidor Node para responder.
 *
 * O GitHub Pages serve arquivos, não processos. Publicar lá significa publicar
 * a primeira metade. Este módulo é o interruptor: com `PORTAL_TARGET=pages`, os
 * componentes que dependem de servidor não são renderizados.
 *
 * Por que **não renderizar** em vez de deixar quebrar: uma ilha de servidor
 * publicada no Pages busca `/_server-islands/…`, recebe 404 e fica vazia para
 * sempre; o widget de feedback aceita o clique e falha no POST; o chat abre e
 * não responde. Um botão que não funciona é pior que um botão ausente, porque o
 * leitor não sabe que o problema não é dele.
 */

export type DeployTarget = 'server' | 'pages';

function readTarget(): DeployTarget {
	// `import.meta.env` no cliente, `process.env` no build e no servidor.
	const value =
		(typeof import.meta !== 'undefined' ? import.meta.env?.PORTAL_TARGET : undefined) ??
		(typeof process !== 'undefined' ? process.env?.PORTAL_TARGET : undefined);

	return value === 'pages' ? 'pages' : 'server';
}

export const deployTarget: DeployTarget = readTarget();

/** `true` quando o build é um site estático sem servidor por trás. */
export const isStaticTarget = deployTarget === 'pages';

/**
 * Recursos que exigem servidor.
 *
 * A lista é explícita, e não um `if (isStaticTarget)` espalhado: quem
 * acrescentar um recurso com API própria precisa decidir aqui o que acontece
 * com ele no Pages, em vez de descobrir em produção.
 */
export const serverFeatures = {
	/** Login, sessões, papéis. */
	auth: !isStaticTarget,
	/** Botão "Editar esta página" (ilha de servidor). */
	editThisPage: !isStaticTarget,
	/** Menu de conta na barra lateral (ilha de servidor). */
	accountMenu: !isStaticTarget,
	/** Editor de Markdown e suas rotas de API. */
	editor: !isStaticTarget,
	/** Painel administrativo em /settings. */
	settings: !isStaticTarget,
	/** Assistente de busca conversacional (`POST /api/chat`). */
	chat: !isStaticTarget,
	/** Widget "esta página foi útil?" (`POST /api/feedback`). */
	feedback: !isStaticTarget,
	/** Analytics do Do11y, cuja configuração vem de uma rota de API. */
	analytics: !isStaticTarget,
} as const;
