/**
 * Documentation Contract Testing — modelo (§1, §4, §5, §8, §16).
 *
 * A diferença entre esta camada e a Documentation Test Suite é a pergunta:
 *
 *     Documentation Test  →  "este exemplo funciona?"
 *     Contract Test       →  "este exemplo representa o contrato de verdade?"
 *
 * O exemplo da spec é exato. Uma API exige `amount` e `currency`; a documentação
 * mostra só `amount`. O exemplo até roda em algumas circunstâncias — e está
 * incompleto em relação ao contrato. Nenhum teste de execução pega isso; a
 * comparação com o schema pega.
 *
 * Esta camada **não mantém grafo próprio** (§25): as relações página↔endpoint vêm
 * do Digital Twin. Um segundo grafo divergiria do primeiro na primeira mudança.
 */

export type ContractStatus = 'valid' | 'invalid' | 'warning' | 'unknown';

export const CONTRACT_MARK: Record<ContractStatus, string> = {
	valid: '🟢',
	warning: '🟡',
	invalid: '🔴',
	unknown: '⚪',
};

export const CONTRACT_LABEL: Record<ContractStatus, string> = {
	valid: 'Válido',
	warning: 'Aviso',
	invalid: 'Quebrado',
	unknown: 'Desconhecido',
};

export const CONTRACT_STATUS_ORDER: Record<ContractStatus, number> = {
	invalid: 0,
	warning: 1,
	unknown: 2,
	valid: 3,
};

export type ContractSource =
	| { type: 'openapi'; path: string; pointer: string }
	| { type: 'asyncapi'; path: string; pointer: string }
	| { type: 'code'; path: string; symbol: string }
	| { type: 'baseline'; path: string; pointer: string };

/** As dimensões verificadas (§8). */
export type ContractDimension =
	| 'method'
	| 'path'
	| 'parameters'
	| 'request'
	| 'response'
	| 'status'
	| 'authentication'
	| 'code-example';

export const DIMENSION_LABEL: Record<ContractDimension, string> = {
	method: 'Método',
	path: 'Caminho',
	parameters: 'Parâmetros',
	request: 'Requisição',
	response: 'Resposta',
	status: 'Códigos de status',
	authentication: 'Autenticação',
	'code-example': 'Exemplo de código',
};

export interface ContractAssertion {
	/** `CONTRACT-REQ-001`, `CONTRACT-AUTH-001`. */
	id: string;
	dimension: ContractDimension;
	status: ContractStatus;
	/** O que se verificou, em uma frase. */
	message: string;
	expected?: string;
	actual?: string;
	/** Onde corrigir. */
	location?: { path: string; line?: number };
}

export interface DocumentationReference {
	/** Caminho da página, relativo a `src/content/docs`. */
	path: string;
	/** Como a associação foi feita — declarada no frontmatter, ou inferida. */
	association: 'declared' | 'inferred';
	line?: number;
}

export interface DocumentationContract {
	/** `POST /api/users`, ou o identificador da baseline. */
	id: string;
	source: ContractSource;
	documentation: DocumentationReference[];
	assertions: ContractAssertion[];
	status: ContractStatus;
}

// ---------------------------------------------------------------------------
// Score (§18)
// ---------------------------------------------------------------------------

export interface ContractScore {
	/** 0–100. */
	value: number;
	byDimension: Array<{ dimension: ContractDimension; value: number; checked: number }>;
}

export interface ContractReport {
	contracts: DocumentationContract[];
	score: ContractScore;
	counts: Record<ContractStatus, number>;
	/** Mudanças incompatíveis apuradas contra o estado anterior (§9). */
	breaking: Array<{ contract: string; message: string; pages: string[] }>;
	generatedAt: number;
}

export function worstContractStatus(statuses: readonly ContractStatus[]): ContractStatus {
	if (statuses.length === 0) return 'unknown';
	return statuses.reduce(
		(worst, status) => (CONTRACT_STATUS_ORDER[status] < CONTRACT_STATUS_ORDER[worst] ? status : worst),
		'valid' as ContractStatus
	);
}

export function countByStatus(contracts: readonly DocumentationContract[]): Record<ContractStatus, number> {
	const counts: Record<ContractStatus, number> = { valid: 0, invalid: 0, warning: 0, unknown: 0 };
	for (const contract of contracts) counts[contract.status]++;
	return counts;
}
