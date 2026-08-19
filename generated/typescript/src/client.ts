// Gerado a partir de API do portal 1.0.0. Não edite à mão.

import { Transport, type TransportOptions } from './runtime/http.js';
import { AutenticacaoResource } from './resources/autenticacao.js';
import { DocumentacaoResource } from './resources/documentacao.js';
import { QualidadeResource } from './resources/qualidade.js';
import { WorkflowResource } from './resources/workflow.js';

export interface ClientOptions extends Partial<TransportOptions> {}

/**
 * Cliente de API do portal.
 * @example
 * const client = new ApiClient({ token: process.env.API_TOKEN });
 */
export class ApiClient {
	readonly autenticacao: AutenticacaoResource;
	readonly documentacao: DocumentacaoResource;
	readonly qualidade: QualidadeResource;
	readonly workflow: WorkflowResource;

	constructor(options: ClientOptions = {}) {
		const transport = new Transport({ baseUrl: "/api", ...options });
		this.autenticacao = new AutenticacaoResource(transport);
		this.documentacao = new DocumentacaoResource(transport);
		this.qualidade = new QualidadeResource(transport);
		this.workflow = new WorkflowResource(transport);
	}
}
