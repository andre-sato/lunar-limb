/**
 * Documentation Governance — modelo (P3.1).
 *
 * A pergunta que a camada responde: *quem é responsável por esta documentação,
 * quem pode alterá-la, quem precisa aprová-la e quando ela precisa ser revisada?*
 *
 * Uma decisão atravessa o arquivo inteiro e vale declarar antes do primeiro tipo:
 * **"revisada" é uma afirmação de alguém, não uma data de commit.** Seria fácil
 * derivar a última revisão do último commit da página, e o número ficaria bonito
 * — mas corrigir uma vírgula reiniciaria o relógio de 90 dias de uma página que
 * ninguém leu. Página sem revisão declarada é `never-reviewed`, e isso aparece.
 */

export type ActorType = 'team' | 'user';

export interface GovernanceActor {
	type: ActorType;
	id: string;
	/** Nome legível, quando o `governance.yml` declara o time. */
	label?: string;
}

/** O ciclo que a spec desenha: Draft → In Review → Approved → Published. */
export type ReviewState = 'draft' | 'in-review' | 'approved' | 'published' | 'review-required';

export const REVIEW_STATE_LABEL: Record<ReviewState, string> = {
	draft: 'Rascunho',
	'in-review': 'Em revisão',
	approved: 'Aprovada',
	published: 'Publicada',
	// Cobre os dois casos que levam ao mesmo trabalho: venceu, ou nunca começou.
	'review-required': 'Revisão pendente',
};

export type Severity = 'critical' | 'high' | 'medium' | 'low';

/** O que exige aprovação antes de publicar (§ Approval policy). */
export type ApprovalTrigger = 'public-api' | 'breaking-change' | 'security-sensitive';

export const APPROVAL_TRIGGER_LABEL: Record<ApprovalTrigger, string> = {
	'public-api': 'API pública',
	'breaking-change': 'Mudança incompatível',
	'security-sensitive': 'Sensível a segurança',
};

// ---------------------------------------------------------------------------
// Declaração na página
// ---------------------------------------------------------------------------

export interface PageGovernance {
	/** Caminho relativo a `src/content/docs`. */
	path: string;
	owner?: GovernanceActor;
	reviewer?: GovernanceActor;
	approver?: GovernanceActor;
	/** Intervalo de revisão em dias, quando a página declara o seu. */
	reviewIntervalDays?: number;
	/** Estado declarado. Ausente significa `published`. */
	state?: ReviewState;
	/**
	 * Quando alguém afirmou ter revisado, em ISO. **Não** é derivado do Git: um
	 * commit de digitação não é uma revisão.
	 */
	reviewedAt?: string;
	/** Quem afirmou. */
	reviewedBy?: string;
	/** De onde veio cada campo: a própria página ou uma regra do `governance.yml`. */
	inherited: {
		owner?: string;
		reviewer?: string;
		approver?: string;
		interval?: string;
	};
}

// ---------------------------------------------------------------------------
// Avaliação
// ---------------------------------------------------------------------------

export interface ReviewStatus {
	path: string;
	state: ReviewState;
	/** `null` quando ninguém declarou revisão — não é "revisada no commit". */
	reviewedAt: string | null;
	/** Dias desde a revisão declarada, ou `null`. */
	ageDays: number | null;
	/** Quando ela vence, ou `null` quando não há intervalo nem revisão. */
	dueAt: string | null;
	/** Negativo quando já venceu. */
	daysUntilDue: number | null;
	/** `true` quando houve revisão e o intervalo passou. */
	expired: boolean;
	/** `true` quando nunca houve revisão declarada. */
	neverReviewed: boolean;
	/** `true` quando alguma regra define intervalo de revisão para a página. */
	underRegime: boolean;
	/** Prazo de atendimento derivado da severidade, quando vencida. */
	slaDays: number | null;
	/** `true` quando o prazo do SLA também estourou. */
	slaBreached: boolean;
	severity: Severity;
}

export interface ComplianceReport {
	/** Páginas com dono declarado ou herdado de regra, sobre o total. */
	ownership: { covered: number; total: number; percentage: number | null };
	/** Páginas com revisão em dia, sobre as que têm intervalo definido. */
	review: { compliant: number; total: number; percentage: number | null };
	/** Páginas que exigem aprovação e a têm, sobre as que exigem. */
	approval: { compliant: number; total: number; percentage: number | null };
	expiredReviews: number;
	/**
	 * Páginas sob regime que nunca foram revisadas.
	 *
	 * Contada à parte de `expiredReviews` de propósito: no dia em que o regime
	 * entra, nada atrasou — só nunca começou. Somar as duas diria à equipe que ela
	 * está atrasada em algo que acabou de ser criado.
	 */
	neverReviewed: number;
	unownedPages: string[];
	slaBreaches: number;
}

export interface ApprovalRequirement {
	path: string;
	triggers: ApprovalTrigger[];
	/** Quem precisa aprovar, resolvido pela regra ou pela página. */
	approver?: GovernanceActor;
	satisfied: boolean;
	reason: string;
}

// ---------------------------------------------------------------------------
// Configuração (§ Exemplo de configuração)
// ---------------------------------------------------------------------------

export interface TeamDefinition {
	id: string;
	label: string;
	members?: string[];
}

export interface GovernanceRule {
	/** Prefixo de caminho ao qual a regra se aplica, relativo a `src/content/docs`. */
	path: string;
	owner?: GovernanceActor;
	reviewer?: GovernanceActor;
	approver?: GovernanceActor;
	reviewIntervalDays?: number;
}

export interface GovernanceConfig {
	teams: TeamDefinition[];
	/** Regra padrão, aplicada quando nenhuma outra casa. */
	defaults: Omit<GovernanceRule, 'path'>;
	rules: GovernanceRule[];
	approvalRequiredFor: ApprovalTrigger[];
	/** Prazo de atendimento por severidade, em dias. */
	sla: Record<Severity, number>;
	/** Caminhos considerados sensíveis a segurança. */
	securitySensitive: string[];
	/** `true` faz a CI falhar com revisão vencida de página crítica. */
	failOnExpired: boolean;
}

export const DEFAULT_CONFIG: GovernanceConfig = {
	teams: [],
	// Sem intervalo padrão: impor 90 dias a todo o portal produziria, no primeiro
	// dia, uma lista de "vencidas" do tamanho do portal — e uma lista que ninguém
	// consegue atender é uma lista que ninguém lê.
	defaults: {},
	rules: [],
	approvalRequiredFor: ['public-api', 'breaking-change', 'security-sensitive'],
	sla: { critical: 2, high: 5, medium: 15, low: 30 },
	securitySensitive: [],
	failOnExpired: false,
};
