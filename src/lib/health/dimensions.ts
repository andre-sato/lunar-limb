/**
 * Cálculo das dimensões e avaliação dos SLOs (§4, §6, §10, §11).
 *
 * Puro: recebe os números que as outras camadas já produzem e devolve o painel.
 * **Nenhuma medição nova acontece aqui** — é o que o §3 e os critérios de aceite
 * exigem: consolidar o que Linter, Testes, Contratos, Twin, Trust e Gap Mining já
 * calculam, sem reimplementar nada.
 *
 * Se uma dimensão precisar de dado que ninguém coleta, ela sai marcada como não
 * medida em vez de receber um valor inventado.
 */

import type { DimensionScore, HealthDimension, SloConfig, SloEvaluation, SloStatus } from './types';
import { HEALTH_DIMENSIONS } from './types';

// ---------------------------------------------------------------------------
// Entradas
// ---------------------------------------------------------------------------

export interface HealthInputs {
	/** Do linter. */
	lint?: { averageScore: number; analyzed: number; consistencyAverage?: number; accessibilityRatio?: number };
	/** Do Trust. */
	trust?: { documented: number; verified: number; stale: number; invalid: number; averageScore: number; pages: number };
	/** Da Documentation Test Suite. */
	tests?: { total: number; passed: number; failed: number; pagesCovered: number; pages: number; brokenLinks: number };
	/** Do Digital Twin: as quatro fatias de cobertura, já calculadas lá. */
	coverage?: { endpoints: number | null; schemas: number | null; examples: number | null; features: number | null };
	/** Do Contract Testing. */
	contracts?: { valid: number; invalid: number; warning: number; unknown: number };
	/** Do frescor, já consolidado por `staleness.ts`. */
	freshness?: { score: number; measured: number; stale: number };
	/** Das analytics do assistente. */
	ai?: { queries: number; highConfidence: number; unanswered: number };
}

const clamp = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

function unmeasured(dimension: HealthDimension, reason: string): DimensionScore {
	return { dimension, value: 0, basis: reason, measured: false };
}

export function computeDimensions(inputs: HealthInputs): DimensionScore[] {
	const scores: DimensionScore[] = [];

	// --- linter: qualidade, consistência, acessibilidade -------------------
	if (inputs.lint && inputs.lint.analyzed > 0) {
		scores.push({
			dimension: 'quality',
			value: clamp(inputs.lint.averageScore * 10),
			basis: `nota média ${inputs.lint.averageScore.toFixed(1)}/10 em ${inputs.lint.analyzed} página(s)`,
			measured: true,
		});

		scores.push(
			inputs.lint.consistencyAverage === undefined
				? unmeasured('consistency', 'o linter não reportou a dimensão de consistência')
				: {
						dimension: 'consistency',
						value: clamp(inputs.lint.consistencyAverage * 10),
						basis: `consistência média ${inputs.lint.consistencyAverage.toFixed(1)}/10 (inclui glossário)`,
						measured: true,
					}
		);

		scores.push(
			inputs.lint.accessibilityRatio === undefined
				? unmeasured('accessibility', 'sem regras de acessibilidade avaliadas')
				: {
						dimension: 'accessibility',
						value: clamp(inputs.lint.accessibilityRatio * 100),
						basis: 'páginas sem apontamento de acessibilidade (alt, hierarquia de títulos, texto de link)',
						measured: true,
					}
		);
	} else {
		for (const dimension of ['quality', 'consistency', 'accessibility'] as const) {
			scores.push(unmeasured(dimension, 'o linter não analisou nenhuma página'));
		}
	}

	// --- cobertura, do Digital Twin ---------------------------------------
	const slices = [inputs.coverage?.endpoints, inputs.coverage?.schemas, inputs.coverage?.examples, inputs.coverage?.features]
		.filter((value): value is number => typeof value === 'number');

	scores.push(
		slices.length === 0
			? unmeasured('coverage', 'o Digital Twin não encontrou produto para medir')
			: {
					dimension: 'coverage',
					value: clamp(slices.reduce((sum, value) => sum + value, 0) / slices.length),
					basis: `endpoints ${inputs.coverage?.endpoints ?? '—'}%, schemas ${inputs.coverage?.schemas ?? '—'}%, exemplos ${inputs.coverage?.examples ?? '—'}%, domínios ${inputs.coverage?.features ?? '—'}%`,
					measured: true,
				}
	);

	// --- integridade de contrato ------------------------------------------
	const contracts = inputs.contracts;
	const verified = contracts ? contracts.valid + contracts.invalid + contracts.warning : 0;

	scores.push(
		verified === 0
			? unmeasured('contractIntegrity', 'nenhum contrato pôde ser verificado — falta exemplo documentado para comparar')
			: {
					dimension: 'contractIntegrity',
					// `unknown` fora da conta, como no próprio Contract Score: contrato que
					// ninguém documentou não está certo nem errado, está sem documentação —
					// e isso é assunto da cobertura.
					value: clamp((contracts!.valid / verified) * 100),
					basis: `${contracts!.valid} válido(s), ${contracts!.invalid} quebrado(s), ${contracts!.warning} com aviso (${contracts!.unknown} sem documentação, fora da conta)`,
					measured: true,
				}
	);

	// --- frescor ------------------------------------------------------------
	scores.push(
		!inputs.freshness || inputs.freshness.measured === 0
			? unmeasured('freshness', 'sem histórico de alteração para avaliar')
			: {
					dimension: 'freshness',
					value: clamp(inputs.freshness.score),
					basis: `${inputs.freshness.measured} página(s) avaliada(s), ${inputs.freshness.stale} obsoleta(s)`,
					measured: true,
				}
	);

	// --- confiabilidade -----------------------------------------------------
	if (inputs.tests) {
		const defects = inputs.tests.failed + (contracts?.invalid ?? 0);
		const checks = inputs.tests.total + (contracts ? verified : 0);

		scores.push(
			checks === 0
				? unmeasured('reliability', 'nenhuma verificação rodou')
				: {
						dimension: 'reliability',
						value: clamp(((checks - defects) / checks) * 100),
						basis: `${defects} defeito(s) em ${checks} verificação(ões): ${inputs.tests.brokenLinks} link(s) quebrado(s), ${inputs.tests.failed} teste(s) reprovado(s), ${contracts?.invalid ?? 0} contrato(s) quebrado(s)`,
						measured: true,
					}
		);
	} else {
		scores.push(unmeasured('reliability', 'a suíte de testes não rodou'));
	}

	// --- confiança ----------------------------------------------------------
	if (inputs.trust) {
		scores.push(
			inputs.trust.documented === 0
				? unmeasured('trust', 'nenhuma página declara proveniência ainda')
				: {
						dimension: 'trust',
						value: clamp(inputs.trust.averageScore),
						basis: `Trust Score médio ${inputs.trust.averageScore}/100 em ${inputs.trust.documented} página(s)`,
						measured: true,
					}
		);
	} else {
		scores.push(unmeasured('trust', 'camada de confiança indisponível'));
	}

	// --- cobertura de testes ------------------------------------------------
	scores.push(
		inputs.tests && inputs.tests.pages > 0
			? {
					dimension: 'testCoverage',
					value: clamp((inputs.tests.pagesCovered / inputs.tests.pages) * 100),
					basis: `${inputs.tests.pagesCovered} de ${inputs.tests.pages} página(s) com ao menos um teste`,
					measured: true,
				}
			: unmeasured('testCoverage', 'a suíte de testes não rodou')
	);

	// --- preparo para IA ----------------------------------------------------
	scores.push(
		!inputs.ai || inputs.ai.queries === 0
			? unmeasured('aiReadiness', 'ainda não houve consulta ao assistente')
			: {
					dimension: 'aiReadiness',
					value: clamp((inputs.ai.highConfidence / inputs.ai.queries) * 100),
					basis: `${inputs.ai.highConfidence} de ${inputs.ai.queries} resposta(s) com confiança alta; ${inputs.ai.unanswered} sem resposta`,
					measured: true,
				}
	);

	return HEALTH_DIMENSIONS.map(
		(dimension) => scores.find((score) => score.dimension === dimension) ?? unmeasured(dimension, 'sem dado')
	);
}

/**
 * A nota geral é a média das dimensões **medidas**.
 *
 * Incluir as não medidas como zero faria um portal ainda sem proveniência parecer
 * doente por não ter sido medido. Quando nada foi medido, o resultado é zero e o
 * painel diz que não há medida — o que é diferente de dizer que está mal.
 */
export function overallHealth(dimensions: readonly DimensionScore[]): number {
	const measured = dimensions.filter((dimension) => dimension.measured);
	if (measured.length === 0) return 0;
	return Math.round(measured.reduce((sum, dimension) => sum + dimension.value, 0) / measured.length);
}

// ---------------------------------------------------------------------------
// SLO (§10, §11)
// ---------------------------------------------------------------------------

export function evaluateSlo(dimensions: readonly DimensionScore[], config: SloConfig): SloEvaluation[] {
	const evaluations: SloEvaluation[] = [];

	for (const dimension of dimensions) {
		const slo = config.dimensions[dimension.dimension];
		if (!slo) continue;

		evaluations.push({
			dimension: dimension.dimension,
			current: dimension.value,
			target: slo.target,
			measured: dimension.measured,
			// Dimensão não medida **não** é violação: não se viola um alvo que não
			// foi aferido. Ela fica em risco, que é o convite a medir.
			status: !dimension.measured
				? 'at-risk'
				: dimension.value >= slo.target
					? 'healthy'
					: dimension.value >= slo.target - slo.warning
						? 'at-risk'
						: 'breached',
		});
	}

	return evaluations;
}

/** O pior status entre os SLOs — é ele que decide a cor do topo do painel. */
export function worstSloStatus(evaluations: readonly SloEvaluation[]): SloStatus {
	if (evaluations.some((evaluation) => evaluation.status === 'breached')) return 'breached';
	if (evaluations.some((evaluation) => evaluation.status === 'at-risk')) return 'at-risk';
	return 'healthy';
}
