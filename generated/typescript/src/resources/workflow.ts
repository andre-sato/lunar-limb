// Gerado a partir de API do portal 1.0.0. Não edite à mão.

import type { Transport } from '../runtime/http.js';
import type { BranchList } from '../models/index.js';

/**
 * Operações de `workflow`.
 * Agrupadas por tag `workflow`.
 */

export class WorkflowResource {
	constructor(private readonly transport: Transport) {}

	/**
	 * Branches do repositório
	 * Lista as branches locais, indicando a atual e a padrão.
	 * `GET /editor/git/branches`
	 * @example
	 * await client.workflow.listBranches();
	 */
	listBranches(): Promise<BranchList> {
		return this.transport.request({
			method: "GET",
			path: "/editor/git/branches",
		});
	}
}
