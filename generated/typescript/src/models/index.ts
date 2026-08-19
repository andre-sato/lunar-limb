// Gerado a partir de API do portal 1.0.0. Não edite à mão.

/**
 * Um usuário do portal.
 * Derivado de `components/schemas/User`.
 */
export interface User {
	id: string;
	email: string;
	/** Papel que decide o que a pessoa pode ver e editar. */
	role: "viewer" | "editor" | "admin";
}

/**
 * A sessão atual.
 * Derivado de `components/schemas/CurrentUser`.
 */
export interface CurrentUser {
	user: User;
}

/**
 * Derivado de `components/schemas/SearchRequest`.
 */
export interface SearchRequest {
	/** A pergunta, em português, inglês ou espanhol. */
	message: string;
	/** Continua uma conversa existente. */
	conversationId?: string;
}

/**
 * Um trecho da documentação, já recortado.
 * Derivado de `components/schemas/Excerpt`.
 */
export interface Excerpt {
	title: string;
	section?: string;
	/** Texto do trecho, com credenciais redigidas. */
	text: string;
	url: string;
	/** Caminho da página em `src/content/docs`. */
	path: string;
}

/**
 * Uma página citada na resposta.
 * Derivado de `components/schemas/Source`.
 */
export interface Source {
	documentId: string;
	title: string;
	url: string;
	/** Maior relevância entre os trechos desta página. */
	relevance: number;
}

/**
 * Resposta da busca. O `message` é uma frase de enquadramento extrativa —
 * não há modelo de linguagem gerando texto novo.
 * 
 * Derivado de `components/schemas/SearchAnswer`.
 */
export interface SearchAnswer {
	message: string;
	excerpts: Array<Excerpt>;
	sources: Array<Source>;
	/** Verdadeiro quando nada passou do limiar de relevância. */
	empty: boolean;
	conversationId?: string;
}

/**
 * Derivado de `components/schemas/Branch`.
 */
export interface Branch {
	name: string;
	/** Commits à frente do remoto. */
	ahead?: number;
	/** Commits atrás do remoto. */
	behind?: number;
}

/**
 * Derivado de `components/schemas/BranchList`.
 */
export interface BranchList {
	current: string;
	defaultBranch?: string;
	branches: Array<Branch>;
}

/**
 * Derivado de `components/schemas/LintRequest`.
 */
export interface LintRequest {
	/** O Markdown a analisar, com frontmatter. */
	content: string;
	/** Caminho relativo, usado para regras por tipo de página. */
	path?: string;
}

/**
 * Um apontamento do linter, com onde ele está.
 * Derivado de `components/schemas/LintFinding`.
 */
export interface LintFinding {
	rule: string;
	message: string;
	severity: "error" | "warning" | "info";
	line?: number;
	column?: number;
}

/**
 * Derivado de `components/schemas/LintResult`.
 */
export interface LintResult {
	/** Nota de 0 a 100. */
	score: number;
	gate: "pass" | "warning" | "fail";
	findings: Array<LintFinding>;
}

/**
 * Derivado de `components/schemas/FeedbackRequest`.
 */
export interface FeedbackRequest {
	/** Caminho da página avaliada. */
	path: string;
	vote: "up" | "down";
}
