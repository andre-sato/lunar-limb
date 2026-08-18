/**
 * Documentation Gap Mining — modelo (§2, §4, §5, §11, §22).
 *
 * O princípio da spec, que é o que separa esta camada de analytics comum:
 *
 *     Não basta saber "esta página teve 10.000 acessos".
 *     O que se quer descobrir é que informação as pessoas procuram e não acham.
 *
 * O ciclo se fecha em dois lugares que a maioria das ferramentas deixa aberto. O
 * primeiro é a resolução: um gap **não** é considerado resolvido porque alguém
 * criou uma página — só quando o sinal que o originou some (§21). O segundo é a
 * privacidade: o que alimenta a análise é a distribuição, não o rastro de quem
 * perguntou (§27).
 */

export type GapCategory =
	/** Nenhuma documentação relevante. */
	| 'missing'
	/** Existe conteúdo, e ele não responde por inteiro. */
	| 'incomplete'
	/** Existe conteúdo e ele diverge do produto — Twin ou Contract acusaram. */
	| 'outdated'
	/** Existe documentação e as pessoas continuam perguntando. */
	| 'unclear'
	/** A informação existe e ninguém chega até ela. */
	| 'hard-to-find'
	/** Duas fontes dizem coisas diferentes. */
	| 'contradictory';

export const CATEGORY_LABEL: Record<GapCategory, string> = {
	missing: 'Falta documentação',
	incomplete: 'Incompleta',
	outdated: 'Desatualizada',
	unclear: 'Pouco clara',
	'hard-to-find': 'Difícil de achar',
	contradictory: 'Contraditória',
};

export type GapPriority = 'P0' | 'P1' | 'P2' | 'P3';

export type GapStatus = 'new' | 'acknowledged' | 'in-progress' | 'resolved' | 'dismissed' | 'duplicate';

export const STATUS_LABEL: Record<GapStatus, string> = {
	new: 'Novo',
	acknowledged: 'Reconhecido',
	'in-progress': 'Em andamento',
	resolved: 'Resolvido',
	dismissed: 'Descartado',
	duplicate: 'Duplicado',
};

export interface GapEvidence {
	/** Consultas de busca que caíram neste agrupamento. */
	searches: number;
	/** Perguntas ao assistente. */
	aiQuestions: number;
	/** Respostas com confiança baixa ou sem resposta. */
	aiFailures: number;
	/** Consultas vindas de agentes por MCP. */
	mcpQueries: number;
	/** Votos negativos nas páginas relacionadas. */
	negativeFeedback: number;
	/** Contratos quebrados nas páginas relacionadas. */
	brokenContracts: number;
}

export const EMPTY_EVIDENCE: GapEvidence = {
	searches: 0,
	aiQuestions: 0,
	aiFailures: 0,
	mcpQueries: 0,
	negativeFeedback: 0,
	brokenContracts: 0,
};

export interface GapScore {
	value: number;
	/** Cada fator com pontos e motivo — um score sem decomposição não se audita. */
	factors: Array<{ name: string; points: number; detail: string }>;
}

export interface DocumentationGap {
	id: string;
	/** A pergunta representativa do agrupamento. */
	query: string;
	/** As variações agrupadas nele (§12). */
	variants: string[];
	category: GapCategory;
	frequency: number;
	evidence: GapEvidence;
	score: GapScore;
	priority: GapPriority;
	status: GapStatus;
	/** Páginas relacionadas, do índice de busca. */
	relatedContent: string[];
	/** Nós do Digital Twin — endpoints, código (§24). */
	relatedProductNodes: string[];
	/** Cobertura estimada do assunto pelo conteúdo existente, 0–100. */
	coverage: number;
	/** O que fazer (§18). */
	recommendation: GapRecommendation;
	createdAt: string;
	updatedAt: string;
	/** Sinal registrado no momento em que o gap foi marcado como em andamento. */
	baseline?: { searches: number; aiFailures: number; at: string };
}

export type RecommendedAction =
	| 'create-page'
	| 'update-page'
	| 'add-example'
	| 'add-api-reference'
	| 'fix-terminology'
	| 'fix-navigation'
	| 'update-outdated';

export const ACTION_LABEL: Record<RecommendedAction, string> = {
	'create-page': 'Criar página',
	'update-page': 'Atualizar página',
	'add-example': 'Acrescentar exemplo',
	'add-api-reference': 'Documentar na referência da API',
	'fix-terminology': 'Corrigir terminologia',
	'fix-navigation': 'Melhorar a navegação',
	'update-outdated': 'Atualizar conteúdo divergente',
};

export interface GapRecommendation {
	action: RecommendedAction;
	/** Caminho sugerido, quando a ação é criar. */
	target?: string;
	/** Estrutura sugerida, em tópicos. */
	outline: string[];
	/** Por que esta ação e não outra. */
	reason: string;
}

/** Faixas de prioridade (§11), configuráveis. */
export interface PriorityThresholds {
	p0: number;
	p1: number;
	p2: number;
}

export const DEFAULT_THRESHOLDS: PriorityThresholds = { p0: 90, p1: 70, p2: 40 };

export function priorityFor(score: number, thresholds: PriorityThresholds = DEFAULT_THRESHOLDS): GapPriority {
	if (score >= thresholds.p0) return 'P0';
	if (score >= thresholds.p1) return 'P1';
	if (score >= thresholds.p2) return 'P2';
	return 'P3';
}

export interface GapFilters {
	status?: GapStatus;
	priority?: GapPriority;
	category?: GapCategory;
}

export interface GapReport {
	gaps: DocumentationGap[];
	counts: Record<GapPriority, number>;
	/** `true` quando o texto das perguntas não está sendo guardado. */
	limited: boolean;
	generatedAt: number;
}
