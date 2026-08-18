/**
 * Política do proxy do Explorer (§11).
 *
 * O "Try it" precisa de um proxy: a API documentada raramente aceita CORS do
 * domínio do portal. Só que um proxy que aceita qualquer URL **é** um SSRF —
 * qualquer visitante passaria a ter o servidor do portal como intermediário para
 * alcançar o que ele alcança, inclusive a rede interna e os endereços de
 * metadados de nuvem.
 *
 * A regra aqui é a mais restritiva que ainda serve: **só os servidores
 * declarados na especificação**. Eles não vêm do pedido; vêm do arquivo
 * versionado no repositório. Quem quiser liberar outro destino edita a
 * especificação, o que passa por revisão.
 *
 * Este módulo é puro e testável sem rede — o que importa, porque é a decisão de
 * segurança da feature.
 */

export interface PolicyDecision {
	allowed: boolean;
	reason?: string;
	/** URL normalizada, quando permitida. */
	url?: string;
}

/**
 * Faixas que nunca são destino legítimo de uma API pública.
 *
 * A verificação por texto pega o caso comum; ela **não** substitui a resolução
 * de DNS, que é o furo clássico (um domínio público apontando para 127.0.0.1).
 * A defesa que fecha esse furo é a lista de origens permitidas: um destino só
 * passa se a origem estiver declarada na especificação, e aí o endereço para o
 * qual ela resolve é escolha de quem escreveu a especificação, não do visitante.
 */
const BLOCKED_HOSTS = [
	/^localhost$/i,
	/^127\./,
	/^0\.0\.0\.0$/,
	/^10\./,
	/^192\.168\./,
	/^172\.(1[6-9]|2\d|3[01])\./,
	/^169\.254\./, // link-local, inclui o endereço de metadados de nuvem
	/^\[?::1\]?$/,
	/^\[?f[cd]/i, // IPv6 privado
	/\.internal$/i,
	/\.local$/i,
];

function origin(url: URL): string {
	return `${url.protocol}//${url.host}`;
}

/** Origens permitidas a partir dos servidores declarados na especificação. */
export function allowedOrigins(servers: readonly string[]): string[] {
	const origins = new Set<string>();

	for (const server of servers) {
		try {
			// Servidor relativo (`/api`) significa "o próprio portal": é a origem
			// de quem serve a página, resolvida por quem chama.
			if (server.startsWith('/')) continue;
			origins.add(origin(new URL(server)));
		} catch {
			// Servidor com variável de template não vira origem fixa; ignorado.
		}
	}

	return [...origins];
}

export interface PolicyOptions {
	/** Origens vindas da especificação. */
	allowed: readonly string[];
	/** Origem do próprio portal, para permitir servidor relativo. */
	selfOrigin?: string;
	/** Servidores relativos declarados (`/api`), que valem sobre a própria origem. */
	relativeServers?: readonly string[];
}

/**
 * Decide se o proxy pode buscar esta URL.
 *
 * A ordem importa: forma antes de origem. Uma URL malformada ou com esquema
 * estranho (`file:`, `gopher:`) é recusada antes de qualquer comparação.
 */
export function checkTarget(target: string, options: PolicyOptions): PolicyDecision {
	let url: URL;
	try {
		url = new URL(target);
	} catch {
		return { allowed: false, reason: 'URL inválida.' };
	}

	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		return { allowed: false, reason: `Esquema não permitido: ${url.protocol}` };
	}

	if (url.username !== '' || url.password !== '') {
		// Credencial na URL vazaria em log e em histórico.
		return { allowed: false, reason: 'A URL não pode conter credenciais.' };
	}

	const targetOrigin = origin(url);
	const permitted = new Set(options.allowed);

	// Servidor relativo na especificação libera a própria origem do portal, e
	// apenas os caminhos declarados por ele.
	if (options.selfOrigin && options.relativeServers?.length) {
		for (const relative of options.relativeServers) {
			if (targetOrigin === options.selfOrigin && url.pathname.startsWith(relative)) {
				return { allowed: true, url: url.toString() };
			}
		}
	}

	if (!permitted.has(targetOrigin)) {
		return {
			allowed: false,
			reason: `Destino fora da especificação: ${targetOrigin}. Só os servidores declarados são aceitos.`,
		};
	}

	// A origem está declarada, mas apontar a especificação para a rede interna
	// não deveria virar um proxy para ela. Este é o cinto além do suspensório.
	const host = url.hostname;
	if (BLOCKED_HOSTS.some((pattern) => pattern.test(host))) {
		return { allowed: false, reason: `Endereço de rede interna recusado: ${host}` };
	}

	return { allowed: true, url: url.toString() };
}

// ---------------------------------------------------------------------------
// Cabeçalhos
// ---------------------------------------------------------------------------

/** Cabeçalhos que o cliente não pode ditar — eles descrevem o proxy, não o pedido. */
const RESERVED_HEADERS = new Set([
	'host',
	'content-length',
	'connection',
	'transfer-encoding',
	'upgrade',
	'cookie2',
	'x-forwarded-for',
	'x-forwarded-host',
	'x-forwarded-proto',
	'forwarded',
]);

export function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
	const output: Record<string, string> = {};

	for (const [name, value] of Object.entries(headers)) {
		const key = name.trim().toLowerCase();
		if (key === '' || RESERVED_HEADERS.has(key)) continue;
		// Quebra de linha no valor permitiria injetar outro cabeçalho.
		if (/[\r\n]/.test(value)) continue;
		output[key] = value;
	}

	return output;
}

/**
 * Nomes de cabeçalho cujo valor nunca deve ser registrado (§5, §9).
 *
 * A lista é por nome porque o valor é opaco: o proxy não sabe distinguir um
 * token de um identificador qualquer, e tentar adivinhar erraria nos dois
 * sentidos.
 */
const SECRET_HEADERS = [/^authorization$/i, /^proxy-authorization$/i, /api[-_]?key/i, /token/i, /^cookie$/i, /secret/i];

export function isSecretHeader(name: string): boolean {
	return SECRET_HEADERS.some((pattern) => pattern.test(name));
}

/** Versão dos cabeçalhos segura para log e para histórico. */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
	const output: Record<string, string> = {};
	for (const [name, value] of Object.entries(headers)) {
		output[name] = isSecretHeader(name) ? '••••••' : value;
	}
	return output;
}
