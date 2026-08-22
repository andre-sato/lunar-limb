/**
 * Utilidades compartilhadas pelas rotas de API protegidas.
 */

import type { AuthUser } from './permissions';
import type { AuthErrorCode } from './users';

export function jsonResponse(body: unknown, status: number): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'cache-control': 'private, no-store',
		},
	});
}

/**
 * Recupera o ator da requisição.
 *
 * O middleware já barrou anônimos nestas rotas; isto é a rede de segurança
 * para o caso de a rota ser chamada por um caminho que não passou por ele.
 */
export function requireAuthUser(locals: App.Locals): AuthUser | null {
	const actor = locals.authUser;
	if (!actor || actor.status !== 'active') return null;
	return actor;
}

export function httpStatusFor(code: AuthErrorCode): number {
	switch (code) {
		case 'not_found':
			return 404;
		case 'forbidden':
			return 403;
		case 'email_taken':
		case 'last_admin':
			return 409;
		case 'invalid_input':
		default:
			return 400;
	}
}

/**
 * O corpo JSON de uma requisição, quando ele é mesmo um objeto.
 *
 * Existe porque `await request.json()` falha de três maneiras diferentes, e as
 * rotas tratavam no máximo uma delas:
 *
 *   1. corpo vazio ou malformado — lança `SyntaxError`;
 *   2. corpo `null`, `[]`, `"texto"`, `123` — **não** lança: o JSON é válido,
 *      e a rota só descobre no `body.campo`, com um `TypeError`;
 *   3. objeto legítimo.
 *
 * O caso 2 é o traiçoeiro. Um `try/catch` em volta do `json()` não pega, o
 * `as Record<string, unknown>` promete uma coisa que o valor não é, e o
 * estouro acontece na linha seguinte — longe do lugar onde dava para responder
 * "corpo inválido".
 *
 * As três viram a mesma coisa aqui: um erro de cliente, com mensagem própria.
 * Nenhuma delas é falha do servidor, e nenhuma delas deve devolver 500 nem
 * repetir para o cliente o texto do interpretador de JSON.
 */
export type JsonBodyResult =
	| { ok: true; value: Record<string, unknown> }
	| { ok: false; error: string };

export async function readJsonObject(request: Request): Promise<JsonBodyResult> {
	let parsed: unknown;

	try {
		parsed = await request.json();
	} catch {
		// A mensagem do interpretador ("Unexpected end of JSON input") descreve o
		// nosso parser, não o erro de quem chamou.
		return { ok: false, error: 'Corpo inválido: esperado JSON.' };
	}

	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return { ok: false, error: 'Corpo inválido: esperado um objeto JSON.' };
	}

	return { ok: true, value: parsed as Record<string, unknown> };
}
