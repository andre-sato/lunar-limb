/**
 * Tipos do Documentation Linter.
 *
 * A arquitetura tem três responsabilidades separadas (§82):
 *
 *   Parser      entende Markdown/MDX  → parse.ts
 *   Linter      identifica problemas  → rules/
 *   Score Engine transforma problemas em avaliação → score.ts
 *
 * Nenhuma delas conhece as outras: as regras recebem um documento já
 * analisado e devolvem findings; o motor de score recebe findings e não sabe
 * como foram produzidos.
 */

export type Severity = 'error' | 'warning' | 'suggestion' | 'info';

export const SEVERITIES: readonly Severity[] = ['error', 'warning', 'suggestion', 'info'];

/**
 * Categorias pontuadas (§4). `aiReadiness` existe mas fica **fora** da média
 * ponderada: a §46 pede que ela seja apresentada à parte para não distorcer a
 * avaliação editorial.
 */
export const SCORED_CATEGORIES = [
	'grammar',
	'clarity',
	'conciseness',
	'structure',
	'technicalWriting',
	'consistency',
	'actionability',
	'terminology',
	'readability',
	'completeness',
] as const;

export type ScoredCategory = (typeof SCORED_CATEGORIES)[number];
export type Category = ScoredCategory | 'aiReadiness';

export const CATEGORY_LABELS: Record<Category, string> = {
	grammar: 'Gramática e ortografia',
	clarity: 'Clareza',
	conciseness: 'Concisão',
	structure: 'Estrutura',
	technicalWriting: 'Technical writing',
	consistency: 'Consistência',
	actionability: 'Acionabilidade',
	terminology: 'Terminologia',
	readability: 'Legibilidade',
	completeness: 'Completude',
	aiReadiness: 'Preparo para IA',
};

export interface SourceRange {
	startLine: number;
	startColumn: number;
	endLine?: number;
	endColumn?: number;
}

export interface LintFix {
	type: 'text-replacement';
	replacement: string;
}

export interface LintFinding {
	/** Identificador único deste finding nesta execução. */
	id: string;
	ruleId: string;
	category: Category;
	severity: Severity;
	message: string;
	explanation?: string;
	suggestion?: string;
	location: SourceRange;
	/** Peso do impacto no score. Um link quebrado não pesa como "simply" (§49). */
	weight: number;
	/**
	 * Confiança, para findings de origem semântica (§64). Regras
	 * determinísticas omitem — elas não "acham", elas encontram.
	 */
	confidence?: number;
	/** Presente apenas quando a correção é segura e mecânica (§43). */
	fix?: LintFix;
}

export type PageType =
	| 'tutorial'
	| 'how-to'
	| 'concept'
	| 'reference'
	| 'troubleshooting'
	| 'api-reference'
	| 'overview';

export const PAGE_TYPES: readonly PageType[] = [
	'tutorial',
	'how-to',
	'concept',
	'reference',
	'troubleshooting',
	'api-reference',
	'overview',
];

/** Idiomas com conjunto de regras próprio. */
export type LintLanguage = 'pt-BR' | 'en' | 'es';

export interface CategoryScores {
	grammar: number;
	clarity: number;
	conciseness: number;
	structure: number;
	technicalWriting: number;
	consistency: number;
	actionability: number;
	terminology: number;
	readability: number;
	completeness: number;
}

export interface QualityScore {
	/** 0.0 – 10.0, uma casa decimal. */
	score: number;
	categories: CategoryScores;
	/** Apresentada à parte da nota editorial (§46). */
	aiReadiness: number;
	band: string;
	counts: Record<Severity, number>;
}

export type GateStatus = 'pass' | 'warning' | 'fail';

export interface LintResult {
	documentId: string;
	path: string;
	language: LintLanguage;
	pageType: PageType | null;
	profile: string;
	score: number;
	band: string;
	categories: CategoryScores;
	aiReadiness: number;
	findings: LintFinding[];
	counts: Record<Severity, number>;
	/** Regras silenciadas por diretiva ou frontmatter, para auditoria (§59). */
	suppressed: Array<{ ruleId: string; line: number | null; reason: 'directive' | 'frontmatter' }>;
	gate: GateStatus;
	passed: boolean;
	/** Palavras do corpo, sem frontmatter nem blocos de código. */
	words: number;
}

export interface WorkspaceLintResult {
	pages: Array<Pick<LintResult, 'path' | 'score' | 'band' | 'gate' | 'counts' | 'passed'>>;
	averageScore: number;
	analyzed: number;
	passing: number;
	failing: number;
	bands: Record<string, number>;
	categoryAverages: CategoryScores;
	topProblems: Array<{ ruleId: string; message: string; count: number }>;
	gate: GateStatus;
}

// ---------------------------------------------------------------------------
// Contrato das regras
// ---------------------------------------------------------------------------

import type { ParsedDocument } from './parse';
import type { ResolvedConfig } from './config';

export interface RuleContext {
	document: ParsedDocument;
	config: ResolvedConfig;
	language: LintLanguage;
	pageType: PageType | null;
	/** Emite um finding; posição e severidade já resolvidas pelo runner. */
	report: (input: ReportInput) => void;
}

export interface ReportInput {
	ruleId: string;
	message: string;
	location: SourceRange;
	explanation?: string;
	suggestion?: string;
	fix?: LintFix;
	confidence?: number;
	/** Sobrescreve o peso declarado na regra, para ocorrências mais graves. */
	weight?: number;
}

export interface LintRule {
	id: string;
	category: Category;
	/** Severidade padrão; a configuração pode alterá-la (§39). */
	severity: Severity;
	/** Impacto no score (§49). */
	weight: number;
	description: string;
	/** Idiomas aos quais a regra se aplica. Ausente = todos. */
	languages?: readonly LintLanguage[];
	/** Tipos de página aos quais se aplica. Ausente = todos. */
	pageTypes?: readonly PageType[];
	run: (context: RuleContext) => void;
}
