/**
 * Montagem do pedido a partir da operação e do que a pessoa preencheu.
 *
 * Vive aqui, e não dentro do componente, por dois motivos. O primeiro é que
 * **o mesmo pedido alimenta o envio e os exemplos de código** (§8): se cada um
 * montasse o seu, os dois divergiriam, e o exemplo copiado falharia no terminal
 * depois de funcionar na tela.
 *
 * O segundo é verificação. Dentro de um `useMemo`, esta lógica só seria exercida
 * por um navegador com a ilha hidratada. Como função pura, ela é testada em
 * milissegundos — e foi um teste desses que pegou o servidor relativo virando
 * uma URL que o proxy recusava.
 */

import { buildPath, type ApiOperation, type SecurityScheme } from './model';
import type { RequestSpec } from './snippets';

export interface BuildRequestInput {
	operation: ApiOperation;
	/** Servidor escolhido; pode ser relativo (`/api`). */
	server: string;
	/** Origem do portal, usada para resolver servidor relativo. */
	origin: string;
	/** Valores dos parâmetros, por nome. */
	values: Record<string, string>;
	/** Corpo, quando o método aceita. */
	body?: string;
	credential?: string;
	scheme?: SecurityScheme;
}

/** Métodos que não carregam corpo. */
const BODYLESS = new Set(['get', 'head']);

export function buildRequest(input: BuildRequestInput): RequestSpec {
	const { operation, values, credential, scheme } = input;

	const pathValues: Record<string, string> = {};
	const query = new URLSearchParams();
	const headers: Record<string, string> = {};

	for (const parameter of operation.parameters) {
		const value = values[parameter.name] ?? '';
		if (parameter.location === 'path') pathValues[parameter.name] = value;
		else if (value === '') continue;
		else if (parameter.location === 'query') query.set(parameter.name, value);
		else if (parameter.location === 'header') headers[parameter.name] = value;
		// `cookie` fica de fora: o navegador é dono do cabeçalho `Cookie`, e um
		// proxy que o aceitasse do cliente enviaria cookie de outra pessoa.
	}

	// A credencial vai onde o esquema declara — não onde o componente supõe.
	if (credential && scheme) {
		if (scheme.kind === 'apiKey' && scheme.in === 'header' && scheme.name) {
			headers[scheme.name] = credential;
		} else if (scheme.kind === 'apiKey' && scheme.in === 'query' && scheme.name) {
			query.set(scheme.name, credential);
		} else if (scheme.kind === 'http-basic') {
			headers.Authorization = `Basic ${credential}`;
		} else if (scheme.kind === 'http-bearer' || scheme.kind === 'oauth2' || scheme.kind === 'openIdConnect') {
			headers.Authorization = `Bearer ${credential}`;
		}
		// `apiKey` em cookie não é preenchido: ver o comentário acima.
	}

	const sendsBody = !BODYLESS.has(operation.method) && Boolean(input.body);
	if (sendsBody && operation.requestBody) {
		headers['Content-Type'] = operation.requestBody.contentType;
	}

	// Servidor relativo (`/api`) precisa virar URL absoluta: o proxy recebe a URL
	// pronta e não tem como saber de qual origem ela seria relativa.
	const base = input.server.startsWith('/') ? `${input.origin}${input.server}` : input.server;
	const suffix = query.toString() ? `?${query}` : '';

	return {
		method: operation.method,
		url: `${base.replace(/\/$/, '')}${buildPath(operation.path, pathValues)}${suffix}`,
		headers,
		body: sendsBody ? input.body : undefined,
		contentType: operation.requestBody?.contentType,
	};
}

/** Parâmetros obrigatórios ainda em branco — o que impede o envio. */
export function missingRequired(operation: ApiOperation, values: Record<string, string>): string[] {
	return operation.parameters
		.filter((parameter) => parameter.required && !values[parameter.name])
		.map((parameter) => parameter.name);
}
