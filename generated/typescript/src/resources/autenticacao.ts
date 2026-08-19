// Gerado a partir de API do portal 1.0.0. Não edite à mão.

import type { Transport } from '../runtime/http.js';
import type { CurrentUser } from '../models/index.js';

/**
 * Operações de `autenticacao`.
 * Agrupadas por tag `autenticação`.
 */

export class AutenticacaoResource {
	constructor(private readonly transport: Transport) {}

	/**
	 * Quem está autenticado
	 * Devolve o usuário da sessão atual, ou 401 quando não há sessão.
	 * `GET /auth/me`
	 * @example
	 * await client.autenticacao.getCurrentUser();
	 */
	getCurrentUser(): Promise<CurrentUser> {
		return this.transport.request({
			method: "GET",
			path: "/auth/me",
		});
	}
}
