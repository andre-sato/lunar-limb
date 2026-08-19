/**
 * Self-Healing Documentation — modelo (P3.6).
 *
 * O princípio que a spec coloca antes de tudo, e que decide a forma de cada tipo
 * aqui: *self-healing não significa permitir que a IA altere documentação de
 * produção de forma irrestrita.*
 *
 * Por isso o ciclo é `detectar → diagnosticar → propor → validar → revisar → PR`
 * e não `detectar → corrigir`. Cada etapa produz um artefato inspecionável, e
 * duas fronteiras são intransponíveis:
 *
 * - **Nada é escrito fora do workspace isolado** do Agent Orchestrator.
 * - **Nada é publicado sem aprovação humana.** O nível padrão é 3 — detectar,
 *   redigir, validar e abrir PR — com merge automático desligado.
 *
 * E a regra que governa o conteúdo: **sem evidência não há correção.** Quando as
 * fontes conflitam ou nenhuma é autoritativa, o sistema não escolhe — ele cria
 * uma lacuna para intervenção humana.
 */

export type IssueType =
	| 'stale'
	| 'contract-mismatch'
	| 'broken-example'
	| 'missing-documentation'
	| 'terminology'
	| 'behavioral-gap';

export const ISSUE_LABEL: Record<IssueType, string> = {
	stale: 'Documentação defasada',
	'contract-mismatch': 'Divergência de contrato',
	'broken-example': 'Exemplo quebrado',
	'missing-documentation': 'Documentação ausente',
	terminology: 'Inconsistência de terminologia',
	'behavioral-gap': 'Lacuna sugerida por comportamento',
};

export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type Risk = Severity;

export type IssueStatus = 'detected' | 'candidate' | 'in-progress' | 'pr-created' | 'resolved' | 'failed';

/** Uma evidência, com de onde veio. Sem isto não há correção. */
export interface Evidence {
	fact: string;
	source: string;
	/** 0–1. O quanto a fonte sustenta a afirmação — nunca "verdade absoluta". */
	confidence: number;
	quote?: string;
}

export interface HealingIssue {
	id: string;
	type: IssueType;
	severity: Severity;
	/** 0–1. O quanto o sinal sustenta a existência do problema. */
	confidence: number;
	evidence: Evidence[];
	affectedPages: string[];
	/** Entidade do produto envolvida, quando há uma. */
	entityId?: string;
	status: IssueStatus;
	detectedAt: string;
	summary: string;
}

// ---------------------------------------------------------------------------
// Diagnóstico (§6, §25, §26)
// ---------------------------------------------------------------------------

/**
 * Hierarquia de fontes (§26).
 *
 * Ela decide **qual fonte descreve o produto** quando duas discordam em grau de
 * autoridade. Não é licença para escolher: divergência real de conteúdo entre
 * contrato e código continua sendo conflito, e conflito não é resolvido por
 * ordenação.
 */
export type SourceKind =
	| 'production-contract'
	| 'source-code'
	| 'tests'
	| 'release-notes'
	| 'documentation'
	| 'generated-content';

export const DEFAULT_AUTHORITY: SourceKind[] = [
	'production-contract',
	'source-code',
	'tests',
	'release-notes',
	'documentation',
	'generated-content',
];

export interface Conflict {
	/** As fontes que discordam, com o que cada uma afirma. */
	claims: Array<{ source: SourceKind; reference: string; claim: string }>;
	reason: string;
}

export interface Diagnosis {
	issueId: string;
	/** A causa provável, em uma frase. */
	rootCause: string;
	evidence: Evidence[];
	/** 0–1. Cai a zero quando há conflito: não se diagnostica o que não se sabe. */
	confidence: number;
	/** Quando existe, nenhum candidato é gerado. */
	conflict?: Conflict;
	/** `true` quando não há fonte autoritativa para sustentar correção alguma. */
	unhealable: boolean;
	reason?: string;
}

// ---------------------------------------------------------------------------
// Candidato (§8, §9, §10, §11)
// ---------------------------------------------------------------------------

export interface DocumentationChange {
	path: string;
	/** Diff unificado. Obrigatório: nenhuma correção existe sem diff (§9). */
	diff: string;
	/** Linhas adicionadas e removidas, para dimensionar o risco. */
	added: number;
	removed: number;
}

export type ValidationName =
	| 'markdown'
	| 'linter'
	| 'glossary'
	| 'contract'
	| 'examples'
	| 'links'
	| 'health'
	| 'ai-eval';

export interface ValidationResult {
	name: ValidationName;
	/** `null` quando a validação não pôde rodar. Nunca contada como aprovação. */
	passed: boolean | null;
	detail: string;
}

export interface RiskAssessment {
	risk: Risk;
	factors: string[];
}

export interface HealingCandidate {
	id: string;
	issueId: string;
	changes: DocumentationChange[];
	evidence: Evidence[];
	confidence: number;
	risk: Risk;
	validations: ValidationResult[];
	/** `true` quando toda validação aplicável passou. */
	validated: boolean;
	/** Execução do Agent Orchestrator que produziu isto, quando houve. */
	runId?: string;
	createdAt: string;
}

// ---------------------------------------------------------------------------
// Autonomia e política (§2, §12, §15)
// ---------------------------------------------------------------------------

/**
 * Níveis da §2. O padrão é 3, e o 4 exige ligar explicitamente — o produto não
 * decide sozinho fazer merge de conteúdo gerado.
 */
export type AutonomyLevel = 0 | 1 | 2 | 3 | 4;

export const AUTONOMY_LABEL: Record<AutonomyLevel, string> = {
	0: 'Só detectar',
	1: 'Detectar e explicar',
	2: 'Detectar e redigir',
	3: 'Detectar, redigir, validar e abrir PR',
	4: 'Merge automático',
};

export interface RiskPolicy {
	autoCreatePR: boolean;
	requireApproval: boolean;
}

export interface SelfHealingPolicy {
	autonomy: AutonomyLevel;
	byRisk: Record<Risk, RiskPolicy>;
	maxAttempts: number;
	/** O que fazer quando esgotar as tentativas. */
	onFailure: 'create-gap' | 'ignore';
	authority: SourceKind[];
	/** Confiança mínima do diagnóstico para gerar candidato. */
	minimumConfidence: number;
}

export const DEFAULT_HEALING_POLICY: SelfHealingPolicy = {
	// Nível 3: detectar, redigir, validar, abrir PR. Merge automático desligado.
	autonomy: 3,
	byRisk: {
		low: { autoCreatePR: true, requireApproval: false },
		medium: { autoCreatePR: true, requireApproval: true },
		high: { autoCreatePR: true, requireApproval: true },
		// Crítico não abre PR sozinho: um PR aberto é um convite a aprovar sem ler,
		// e o que é crítico merece a fricção de alguém decidir abrir.
		critical: { autoCreatePR: false, requireApproval: true },
	},
	maxAttempts: 2,
	onFailure: 'create-gap',
	authority: DEFAULT_AUTHORITY,
	// Abaixo disto o diagnóstico é palpite, e palpite não vira texto publicado.
	minimumConfidence: 0.6,
};

// ---------------------------------------------------------------------------
// Histórico (§17)
// ---------------------------------------------------------------------------

export interface HealingRecord {
	issueId: string;
	issue: HealingIssue;
	diagnosis?: Diagnosis;
	candidate?: HealingCandidate;
	attempts: number;
	status: IssueStatus;
	/** Quem aprovou ou rejeitou, quando houve revisão humana. */
	reviewedBy?: string;
	pullRequest?: string;
	updatedAt: string;
	/** Registro cronológico do que aconteceu. */
	timeline: Array<{ at: string; event: string; detail?: string }>;
}

export interface HealingSummary {
	detected: number;
	candidates: number;
	drafted: number;
	pullRequests: number;
	resolved: number;
	failed: number;
	/** `null` quando nada chegou ao fim — nunca 0%. */
	successRate: number | null;
	byType: Record<string, number>;
}
