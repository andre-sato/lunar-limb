/**
 * Estado de revisão, expiração, SLA e conformidade (P3.1).
 *
 * Puro: recebe a governança declarada, a configuração e o instante de agora, e
 * devolve o veredito. Quem lê disco é `service.ts`.
 */

import type {
	ApprovalRequirement,
	ApprovalTrigger,
	ComplianceReport,
	GovernanceConfig,
	PageGovernance,
	ReviewState,
	ReviewStatus,
	Severity,
} from './types';

const DAY = 86_400_000;

/**
 * O estado efetivo de uma página.
 *
 * A transição que a spec pede — `Published → Review Required` quando a revisão
 * vence — é derivada, não armazenada. Guardá-la exigiria alguém rodar um
 * processo para escrever de volta no arquivo, e uma página vencida ficaria
 * "publicada" até esse processo rodar.
 */
export function effectiveState(page: PageGovernance, expired: boolean): ReviewState {
	const declared = page.state ?? 'published';
	if (declared === 'draft' || declared === 'in-review') return declared;
	return expired ? 'review-required' : declared;
}

/**
 * A severidade de uma revisão vencida.
 *
 * Cresce com o atraso, não com a importância declarada da página — o portal não
 * tem um campo de importância, e inventar um a partir do caminho produziria uma
 * hierarquia que ninguém decidiu.
 */
export function severityFor(daysOverdue: number | null, neverReviewed: boolean): Severity {
	if (neverReviewed) return 'medium';
	if (daysOverdue === null || daysOverdue <= 0) return 'low';
	if (daysOverdue > 90) return 'critical';
	if (daysOverdue > 30) return 'high';
	return 'medium';
}

export interface StatusInput {
	page: PageGovernance;
	config: GovernanceConfig;
	/** Intervalo efetivo em dias, já resolvido contra as regras. */
	intervalDays?: number;
	now?: number;
}

export function reviewStatus(input: StatusInput): ReviewStatus {
	const now = input.now ?? Date.now();
	const { page } = input;

	const reviewedAt = page.reviewedAt ?? null;
	const reviewedMs = reviewedAt ? Date.parse(reviewedAt) : Number.NaN;
	const hasReview = !Number.isNaN(reviewedMs);

	const ageDays = hasReview ? Math.floor((now - reviewedMs) / DAY) : null;
	const interval = input.intervalDays ?? page.reviewIntervalDays;

	// Sem intervalo não há vencimento. Uma página que ninguém pediu para revisar
	// periodicamente não está atrasada — está fora do regime de revisão, e são
	// coisas diferentes.
	const dueMs = interval && hasReview ? reviewedMs + interval * DAY : null;
	const daysUntilDue = dueMs === null ? null : Math.ceil((dueMs - now) / DAY);

	// "Nunca revisada" **não** é "vencida", e juntar as duas foi a primeira coisa
	// que o relatório real desmentiu: no dia em que o regime entrou, 27 páginas
	// apareceram como atrasadas sem que nada tivesse atrasado. Vencida é a página
	// que foi revisada e cujo intervalo passou; nunca revisada é uma pendência de
	// outra natureza, e a equipe as trata de formas diferentes.
	const neverReviewed = !hasReview;
	const underRegime = Boolean(interval);
	const expired = dueMs !== null && now > dueMs;

	const daysOverdue = daysUntilDue !== null && daysUntilDue < 0 ? -daysUntilDue : null;
	const severity = severityFor(daysOverdue, neverReviewed && underRegime);

	const slaDays = expired || (neverReviewed && underRegime) ? input.config.sla[severity] : null;
	const slaBreached = slaDays !== null && daysOverdue !== null && daysOverdue > slaDays;

	return {
		path: page.path,
		state: effectiveState(page, expired || (neverReviewed && underRegime)),
		reviewedAt,
		ageDays,
		dueAt: dueMs === null ? null : new Date(dueMs).toISOString(),
		daysUntilDue,
		expired,
		neverReviewed,
		underRegime,
		slaDays,
		slaBreached,
		severity,
	};
}

// ---------------------------------------------------------------------------
// Aprovação
// ---------------------------------------------------------------------------

export interface ApprovalInput {
	page: PageGovernance;
	config: GovernanceConfig;
	/** `true` quando a página documenta endpoint público (vínculo do Code Loop). */
	documentsPublicApi?: boolean;
	/** `true` quando alguma entidade vinculada tem mudança incompatível. */
	hasBreakingChange?: boolean;
	/** `true` quando o caminho ou as tags marcam a página como sensível. */
	securitySensitive?: boolean;
	approver?: PageGovernance['approver'];
}

/**
 * O que esta página exige antes de publicar.
 *
 * "Satisfeita" aqui significa **existe um aprovador designado**, não que alguém
 * clicou em aprovar. O portal não faz merge; quem registra a aprovação é o
 * provedor de Git, no pull request. Afirmar aqui que a mudança foi aprovada
 * seria afirmar algo que esta camada não pode ver.
 */
export function approvalRequirement(input: ApprovalInput): ApprovalRequirement | null {
	const triggers: ApprovalTrigger[] = [];

	if (input.documentsPublicApi) triggers.push('public-api');
	if (input.hasBreakingChange) triggers.push('breaking-change');
	if (input.securitySensitive) triggers.push('security-sensitive');

	const required = triggers.filter((trigger) => input.config.approvalRequiredFor.includes(trigger));
	if (required.length === 0) return null;

	const approver = input.approver ?? input.page.approver;

	return {
		path: input.page.path,
		triggers: required,
		approver,
		satisfied: Boolean(approver),
		reason: approver
			? `Aprovação de ${approver.type === 'team' ? 'time' : ''} \`${approver.id}\` designada.`
			: 'Nenhum aprovador designado para uma página que exige aprovação.',
	};
}

// ---------------------------------------------------------------------------
// Conformidade (§ Governance dashboard)
// ---------------------------------------------------------------------------

export interface ComplianceInput {
	pages: readonly PageGovernance[];
	statuses: readonly ReviewStatus[];
	approvals: readonly ApprovalRequirement[];
}

function ratio(covered: number, total: number) {
	// Denominador zero devolve `null`, nunca 0%: um portal sem página que exija
	// aprovação tem 100% de conformidade ou nenhuma? Nenhuma das duas — não há o
	// que medir, e dizer 0% acusaria a equipe de algo que não aconteceu.
	return { covered, total, percentage: total === 0 ? null : Math.round((covered / total) * 100) };
}

export function computeCompliance(input: ComplianceInput): ComplianceReport {
	const owned = input.pages.filter((page) => Boolean(page.owner));
	const unowned = input.pages.filter((page) => !page.owner).map((page) => page.path);

	// Só entram na conta de revisão as páginas sob regime — as que têm intervalo
	// declarado. Uma página fora do regime não está em dia nem atrasada.
	const underReview = input.statuses.filter((status) => status.underRegime);
	const compliantReviews = underReview.filter((status) => !status.expired && !status.neverReviewed);

	const approvals = ratio(input.approvals.filter((entry) => entry.satisfied).length, input.approvals.length);

	return {
		ownership: {
			covered: owned.length,
			total: input.pages.length,
			percentage: input.pages.length === 0 ? null : Math.round((owned.length / input.pages.length) * 100),
		},
		review: {
			compliant: compliantReviews.length,
			total: underReview.length,
			percentage: underReview.length === 0 ? null : Math.round((compliantReviews.length / underReview.length) * 100),
		},
		approval: { compliant: approvals.covered, total: approvals.total, percentage: approvals.percentage },
		expiredReviews: input.statuses.filter((status) => status.expired).length,
		neverReviewed: input.statuses.filter((status) => status.neverReviewed && status.underRegime).length,
		unownedPages: unowned.sort(),
		slaBreaches: input.statuses.filter((status) => status.slaBreached).length,
	};
}
