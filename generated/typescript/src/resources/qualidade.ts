// Gerado a partir de API do portal 1.0.0. Não edite à mão.

import type { Transport } from '../runtime/http.js';
import type { LintRequest, LintResult } from '../models/index.js';

/**
 * Operações de `qualidade`.
 * Agrupadas por tag `qualidade`.
 */

export class QualidadeResource {
	constructor(private readonly transport: Transport) {}

	/**
	 * Analisa um texto Markdown
	 * Roda o linter sobre o conteúdo enviado e devolve a nota, o veredito do
	 * quality gate e os apontamentos com linha e coluna.
	 * 
	 * `POST /editor/lint`
	 * @example
	 * await client.qualidade.lintContent({
	 *   body: { … }
	 * });
	 */
	lintContent(input: {
		body: LintRequest;
	}): Promise<LintResult> {
		return this.transport.request({
			method: "POST",
			path: "/editor/lint",
			body: input.body,
			contentType: "application/json",
		});
	}
}
