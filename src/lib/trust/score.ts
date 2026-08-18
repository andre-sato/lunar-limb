/**
 * Trust Score (§9) e a dimensão que ele acrescenta ao Quality Score (§10).
 *
 * Quatro componentes, como na spec: validade da fonte, cobertura por teste,
 * frescor e responsável. O Quality Score existente **não** é substituído nem
 * recalculado — a nota editorial continua sendo o que era, e o Trust entra ao
 * lado, do mesmo jeito que o preparo para IA já entrava. Misturar as duas coisas
 * numa média faria uma página impecavelmente escrita e sem evidência nenhuma
 * parecer pior do que é, e uma página malescrita com boa proveniência parecer
 * melhor.
 */

import type { PageTrust, TrustScore, VerifiedClaim } from './types';
import { statusFor } from './verify';

function percentage(part: number, total: number): number {
	if (total === 0) return 0;
	return Math.round((part / total) * 100);
}

/**
 * Trust Score de uma página.
 *
 * Página sem afirmação nenhuma recebe zero — e isso é uma escolha, não um
 * descuido. Zero significa "não sabemos de onde isso vem", que é a verdade. Dar
 * nota cheia à ausência de evidência premiaria exatamente o que a camada existe
 * para corrigir.
 */
export function scoreTrust(claims: readonly VerifiedClaim[], freshnessDays: number): TrustScore {
	if (claims.length === 0) {
		return { value: 0, sourceValidity: 0, testCoverage: 0, freshness: 0, ownership: 0 };
	}

	const evidence = claims.flatMap((claim) => claim.evidence);

	// Validade: a evidência confere? `stale` conta como válida — a fonte está lá,
	// o que venceu foi a conferência, e isso é o que o componente de frescor mede.
	const valid = evidence.filter((item) => item.status === 'verified' || item.status === 'stale').length;
	const sourceValidity = percentage(valid, evidence.length);

	const withTest = claims.filter((claim) =>
		claim.provenance.some((provenance) => provenance.sourceType === 'test')
	).length;
	const testCoverage = percentage(withTest, claims.length);

	// Frescor: cada evidência vale entre 0 e 100 conforme a idade dentro do prazo.
	// Degradar aos poucos evita o penhasco em que a página é excelente no dia 179
	// e péssima no 181.
	const freshnessValues = evidence.map((item) => {
		if (item.ageDays === undefined) return 0;
		if (item.ageDays <= 0) return 100;
		if (item.ageDays >= freshnessDays) return 0;
		return Math.round(100 * (1 - item.ageDays / freshnessDays));
	});
	const freshness =
		freshnessValues.length === 0
			? 0
			: Math.round(freshnessValues.reduce((sum, value) => sum + value, 0) / freshnessValues.length);

	const owned = claims.filter((claim) =>
		claim.provenance.some((provenance) => provenance.owner || provenance.verifiedBy)
	).length;
	const ownership = percentage(owned, claims.length);

	// Pesos: validade e frescor pesam mais porque respondem "isto ainda bate com a
	// realidade?". Responsável pesa menos: importa para saber a quem perguntar, não
	// para saber se a informação está correta.
	const value = Math.round(sourceValidity * 0.4 + freshness * 0.3 + testCoverage * 0.2 + ownership * 0.1);

	return { value, sourceValidity, testCoverage, freshness, ownership };
}

export function pageTrust(path: string, claims: readonly VerifiedClaim[], freshnessDays: number, owner?: string): PageTrust {
	const dates = claims
		.flatMap((claim) => claim.provenance.map((provenance) => provenance.verifiedAt))
		.filter((date): date is string => typeof date === 'string' && !Number.isNaN(Date.parse(date)))
		.sort();

	return {
		path,
		claims: [...claims],
		score: scoreTrust(claims, freshnessDays),
		status: statusFor(claims),
		owner: owner ?? claims.flatMap((claim) => claim.provenance).find((provenance) => provenance.owner)?.owner,
		lastVerified: dates.at(-1),
	};
}

/**
 * O Trust na escala do Quality Score, para aparecer ao lado das outras dimensões
 * (§10). Conversão direta de 0–100 para 0–10, uma casa decimal, sem reponderar
 * nada do que já existe.
 */
export function trustDimension(score: TrustScore): number {
	return Math.round(score.value) / 10;
}

export interface TrustSummary {
	pages: number;
	/** Páginas com pelo menos uma afirmação com proveniência. */
	documented: number;
	verified: number;
	stale: number;
	unverified: number;
	invalid: number;
	averageScore: number;
	/** Páginas cuja evidência não confere — a primeira fila da revisão. */
	worst: Array<{ path: string; score: number; status: string }>;
}

export function summarizeTrust(pages: readonly PageTrust[]): TrustSummary {
	const documented = pages.filter((page) => page.claims.length > 0);

	const count = (status: string) => documented.filter((page) => page.status === status).length;

	return {
		pages: pages.length,
		documented: documented.length,
		verified: count('verified'),
		stale: count('stale'),
		unverified: count('unverified'),
		invalid: count('invalid'),
		averageScore:
			documented.length === 0
				? 0
				: Math.round(documented.reduce((sum, page) => sum + page.score.value, 0) / documented.length),
		// Inválidas primeiro, depois as de nota mais baixa: é a ordem em que alguém
		// deve mexer, não a ordem alfabética.
		worst: [...documented]
			.sort((a, b) => {
				if (a.status === 'invalid' && b.status !== 'invalid') return -1;
				if (b.status === 'invalid' && a.status !== 'invalid') return 1;
				return a.score.value - b.score.value;
			})
			.slice(0, 10)
			.map((page) => ({ path: page.path, score: page.score.value, status: page.status })),
	};
}
