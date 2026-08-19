/**
 * Diagnóstico e avaliação de risco (P3.6 — §6, §11, §25, §26).
 *
 * Puro: recebe o problema e o que se sabe das fontes, devolve a causa provável.
 * Quem lê disco é `service.ts`.
 *
 * A regra que atravessa o arquivo: **o sistema não escolhe entre fontes que
 * discordam.** A hierarquia da §26 resolve autoridade, não contradição. Quando o
 * contrato diz que `client_secret` é obrigatório e o código diz que é opcional,
 * escolher um dos dois produziria documentação confiante e possivelmente errada
 * — e a documentação errada com ar de certeza é pior que a lacuna.
 */

import type {
	Conflict,
	Diagnosis,
	Evidence,
	HealingIssue,
	Risk,
	RiskAssessment,
	SelfHealingPolicy,
	SourceKind,
} from './types';

export interface SourceClaim {
	source: SourceKind;
	reference: string;
	/** O que esta fonte afirma, normalizado para comparação. */
	claim: string;
	/** Quando a fonte mudou pela última vez, em ISO. */
	changedAt?: string;
}

/** A fonte mais autoritativa entre as disponíveis. */
export function mostAuthoritative(claims: readonly SourceClaim[], authority: readonly SourceKind[]): SourceClaim | undefined {
	return [...claims].sort((a, b) => authority.indexOf(a.source) - authority.indexOf(b.source))[0];
}

/**
 * Fontes que discordam entre si.
 *
 * Só conta como conflito quando duas fontes **não-documentais** afirmam coisas
 * diferentes. Documentação divergindo do contrato não é conflito — é justamente
 * o problema que o healing existe para corrigir.
 */
export function detectConflict(claims: readonly SourceClaim[]): Conflict | undefined {
	const authoritative = claims.filter((claim) => claim.source !== 'documentation' && claim.source !== 'generated-content');

	const distinct = new Map<string, SourceClaim>();
	for (const claim of authoritative) distinct.set(claim.claim, claim);

	if (distinct.size < 2) return undefined;

	return {
		claims: [...distinct.values()].map((claim) => ({ source: claim.source, reference: claim.reference, claim: claim.claim })),
		reason:
			'Fontes autoritativas discordam entre si. Escolher uma delas produziria documentação confiante e possivelmente errada.',
	};
}

export interface DiagnoseInput {
	issue: HealingIssue;
	claims: readonly SourceClaim[];
	policy: SelfHealingPolicy;
	/** Quando a página foi alterada pela última vez, em ISO. */
	documentationChangedAt?: string;
}

/**
 * A causa provável de um problema.
 *
 * Ela sai da comparação de datas entre a fonte autoritativa e a documentação —
 * "o contrato mudou em agosto, a página em junho" é uma afirmação verificável.
 * Quando as datas não estão disponíveis, o diagnóstico diz o que sabe e reduz a
 * confiança, em vez de narrar uma história plausível.
 */
export function diagnose(input: DiagnoseInput): Diagnosis {
	const { issue } = input;
	const evidence: Evidence[] = [...issue.evidence];

	const conflict = detectConflict(input.claims);

	if (conflict) {
		return {
			issueId: issue.id,
			rootCause: 'Fontes autoritativas em conflito.',
			evidence,
			confidence: 0,
			conflict,
			unhealable: true,
			reason: conflict.reason,
		};
	}

	const authoritative = mostAuthoritative(input.claims, input.policy.authority);

	if (!authoritative && issue.type !== 'behavioral-gap' && issue.type !== 'missing-documentation') {
		// Sem fonte autoritativa não há o que copiar para a documentação. Redigir
		// assim mesmo seria inventar, que é o primeiro item da lista de coisas que o
		// self-healing não pode fazer.
		return {
			issueId: issue.id,
			rootCause: 'Indeterminada.',
			evidence,
			confidence: 0,
			unhealable: true,
			reason: 'Nenhuma fonte autoritativa encontrada para sustentar uma correção.',
		};
	}

	if (authoritative) {
		evidence.push({
			fact: `A fonte autoritativa é \`${authoritative.reference}\` (${authoritative.source}).`,
			source: authoritative.reference,
			confidence: 0.9,
			quote: authoritative.claim,
		});
	}

	const sourceDate = authoritative?.changedAt ? Date.parse(authoritative.changedAt) : Number.NaN;
	const docsDate = input.documentationChangedAt ? Date.parse(input.documentationChangedAt) : Number.NaN;
	const datesKnown = !Number.isNaN(sourceDate) && !Number.isNaN(docsDate);

	let rootCause: string;
	let confidence: number;

	if (datesKnown && sourceDate > docsDate) {
		rootCause = 'A documentação não acompanhou uma mudança na fonte autoritativa.';
		confidence = 0.95;
		evidence.push({
			fact: `A fonte mudou em ${authoritative!.changedAt!.slice(0, 10)}; a documentação, em ${input.documentationChangedAt!.slice(0, 10)}.`,
			source: authoritative!.reference,
			confidence: 0.95,
		});
	} else if (issue.type === 'missing-documentation') {
		rootCause = 'A entidade foi publicada sem página vinculada.';
		confidence = 0.9;
	} else if (issue.type === 'behavioral-gap') {
		// Comportamento não diz a causa. Ele diz que houve atrito, e o diagnóstico
		// não deve soar mais certo que o sinal que o originou.
		rootCause = 'Leitores procuraram um assunto que o portal não cobre.';
		confidence = Math.min(issue.confidence, 0.6);
	} else if (datesKnown) {
		rootCause = 'A documentação é mais recente que a fonte; a divergência tem outra causa.';
		confidence = 0.4;
	} else {
		rootCause = 'Divergência entre documentação e fonte, sem datas para determinar a ordem.';
		confidence = 0.5;
	}

	return {
		issueId: issue.id,
		rootCause,
		evidence,
		// A confiança do diagnóstico nunca supera a do problema: diagnosticar bem
		// um problema duvidoso continua sendo duvidoso.
		confidence: Math.round(Math.min(confidence, issue.confidence) * 100) / 100,
		unhealable: false,
	};
}

// ---------------------------------------------------------------------------
// Risco (§11)
// ---------------------------------------------------------------------------

export interface RiskInput {
	issue: HealingIssue;
	/** Linhas adicionadas e removidas pela correção proposta. */
	added: number;
	removed: number;
	/** Páginas tocadas. */
	pages: number;
	/** `true` quando alguma página tocada documenta API pública. */
	touchesPublicApi?: boolean;
	/** `true` quando alguma página tocada é sensível a segurança. */
	securitySensitive?: boolean;
}

/**
 * O risco de aplicar uma correção.
 *
 * Cresce com o que a mudança pode quebrar, não com o quanto ela é difícil.
 * Corrigir um erro de digitação numa página de autenticação é fácil e arriscado;
 * reescrever um guia interno é trabalhoso e barato de errar.
 */
export function assessRisk(input: RiskInput): RiskAssessment {
	const factors: string[] = [];
	let score = 0;

	if (input.securitySensitive) {
		score += 3;
		factors.push('Toca página marcada como sensível a segurança.');
	}

	if (input.touchesPublicApi) {
		score += 2;
		factors.push('Toca página que documenta API pública.');
	}

	if (input.issue.type === 'contract-mismatch') {
		score += 2;
		factors.push('Divergência de contrato: a correção afirma como a API se comporta.');
	}

	// Remoção pesa mais que adição. Acrescentar um parágrafo errado é ruim;
	// apagar um parágrafo certo destrói informação que ninguém vai perceber que
	// sumiu — foi assim que o Writer destruiu uma página inteira antes de existir
	// a checagem de remoção de conteúdo.
	if (input.removed > 20) {
		score += 3;
		factors.push(`Remove ${input.removed} linha(s).`);
	} else if (input.removed > 0) {
		score += 1;
		factors.push(`Remove ${input.removed} linha(s).`);
	}

	if (input.added > 80) {
		score += 2;
		factors.push(`Acrescenta ${input.added} linha(s).`);
	}

	if (input.pages > 1) {
		score += 1;
		factors.push(`Altera ${input.pages} páginas de uma vez.`);
	}

	if (input.issue.confidence < 0.7) {
		score += 1;
		factors.push('Confiança do sinal abaixo de 70%.');
	}

	const risk: Risk = score >= 6 ? 'critical' : score >= 4 ? 'high' : score >= 2 ? 'medium' : 'low';

	if (factors.length === 0) factors.push('Alteração pequena, aditiva, em página sem marcação especial.');

	return { risk, factors };
}
