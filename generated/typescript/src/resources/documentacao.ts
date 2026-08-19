// Gerado a partir de API do portal 1.0.0. Não edite à mão.

import type { Transport } from '../runtime/http.js';
import type { FeedbackRequest, SearchAnswer, SearchRequest } from '../models/index.js';

/**
 * Operações de `documentacao`.
 * Agrupadas por tag `documentação`.
 */

export class DocumentacaoResource {
	constructor(private readonly transport: Transport) {}

	/**
	 * Busca conversacional na documentação
	 * Recebe uma pergunta em linguagem natural e devolve um resumo extrativo,
	 * os trechos encontrados e os links das páginas. Não há modelo de
	 * linguagem: o resumo cita a documentação.
	 * 
	 * `POST /chat/message`
	 * @example
	 * await client.documentacao.searchDocumentation({
	 *   body: { … }
	 * });
	 */
	searchDocumentation(input: {
		body: SearchRequest;
	}): Promise<SearchAnswer> {
		return this.transport.request({
			method: "POST",
			path: "/chat/message",
			body: input.body,
			contentType: "application/json",
		});
	}

	/**
	 * Registra o feedback de uma página
	 * Guarda o voto de utilidade de uma página da documentação.
	 * `POST /feedback`
	 * @example
	 * await client.documentacao.sendFeedback({
	 *   body: { … }
	 * });
	 */
	sendFeedback(input: {
		body: FeedbackRequest;
	}): Promise<unknown> {
		return this.transport.request({
			method: "POST",
			path: "/feedback",
			body: input.body,
			contentType: "application/json",
		});
	}
}
