/**
 * Cálculo das dimensões e avaliação dos SLOs (§3, §5).
 *
 * Puro: recebe os números que as outras camadas já produzem e devolve o painel.
 * Nenhuma medição nova acontece aqui — se uma dimensão precisar de dado que
 * ninguém coleta, ela sai marcada como não medida em vez de receber um valor
 * inventado.
 */

import type {
	DimensionScore,
	HealthDimension,
	SloConfig,
	SloEvaluation,
	SloStatus,
} from './types';
import { HEALTH_DIMENSIONS } from './types';

// ---------------------------------------------------------------------------
// Entradas
// ---------------------------------------------------------------------------

export interface HealthInputs {
	/** Do linter: nota média (0–10) e páginas analisadas. */
	lint?: { averageScore: number; analyzed: number; consistencyAverage?: number; accessibilityRatio?: number };
	/** Do Trust: páginas com proveniência, quantas verificadas, nota média. */
	trust?: { documented: number; verified: number; stale: number; invalid: number; averageScore: number; pages: number };
	/** Da Documentation Test Suite. */
	tests?: { total: number; passed: number; failed: number; pagesCovered: number; pages: number; brokenLinks: number };
	/** Das especificações de API. */
	api?: { endpoints: number; documented: number };
}

const clamp = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

function unmeasured(dimension: HealthDimension, reason: string): DimensionScore {
	return { dimension, value: 0, basis: reason, measured: false };
}

/**
 * Percentual de conteúdo dentro do prazo de verificação (§3, "Freshness").
 *
 * A base é o conteúdo **com proveniência declarada**, não o portal inteiro. As
 * duas leituras são defensáveis, e esta é a honesta: uma página que ninguém
 * anotou não está "vencida", está sem informação — e diluir o indicador com ela
 * faria o frescor cair conforme o portal cresce, mesmo que todo o conteúdo
 * anotado estivesse em dia. O tamanho da base aparece junto do número.
 */
function freshness(trust: NonNullable<HealthInputs['trust']>): DimensionScore {
	if (trust.documented === 0) {
		return unmeasured('freshness', 'nenhuma página declara proveniência ainda');
	}

	const inDate = trust.documented - trust.stale;
	return {
		dimension: 'freshness',
		value: clamp((inDate / trust.documented) * 100),
		basis: `${inDate} de ${trust.documented} página(s) com proveniência dentro do prazo`,
		measured: true,
	};
}

export function computeDimensions(inputs: HealthInputs): DimensionScore[] {
	const scores: DimensionScore[] = [];

	// --- qualidade e consistência, do linter ------------------------------
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
						basis: 'páginas sem apontamento de acessibilidade (alt ausente ou genérico, hierarquia de títulos, texto de link)',
						measured: true,
					}
		);
	} else {
		scores.push(unmeasured('quality', 'o linter não analisou nenhuma página'));
		scores.push(unmeasured('consistency', 'o linter não analisou nenhuma página'));
		scores.push(unmeasured('accessibility', 'o linter não analisou nenhuma página'));
	}

	// --- frescor e confiança, do Trust ------------------------------------
	if (inputs.trust) {
		scores.push(freshness(inputs.trust));
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
		scores.push(unmeasured('freshness', 'camada de confiança indisponível'));
		scores.push(unmeasured('trust', 'camada de confiança indisponível'));
	}

	// --- cobertura de testes ---------------------------------------------
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

	// --- cobertura de API -------------------------------------------------
	scores.push(
		inputs.api && inputs.api.endpoints > 0
			? {
					dimension: 'apiCoverage',
					value: clamp((inputs.api.documented / inputs.api.endpoints) * 100),
					basis: `${inputs.api.documented} de ${inputs.api.endpoints} endpoint(s) documentado(s)`,
					measured: true,
				}
			: unmeasured('apiCoverage', 'nenhuma especificação de API encontrada')
	);

	// Ordem estável, na sequência declarada — o painel não deve reordenar entre
	// duas visitas só porque um número mudou.
	return HEALTH_DIMENSIONS.map(
		(dimension) => scores.find((score) => score.dimension === dimension) ?? unmeasured(dimension, 'sem dado')
	);
}

/**
 * A nota geral é a média das dimensões **medidas**.
 *
 * Incluir as não medidas como zero faria um portal ainda sem proveniência
 * parecer doente por não ter sido medido. Quando nada foi medido, o resultado é
 * zero e o painel diz que não há medida — o que é diferente de dizer que está mal.
 */
export function overallHealth(dimensions: readonly DimensionScore[]): number {
	const measured = dimensions.filter((dimension) => dimension.measured);
	if (measured.length === 0) return 0;
	return Math.round(measured.reduce((sum, dimension) => sum + dimension.value, 0) / measured.length);
}

// ---------------------------------------------------------------------------
// SLO (§5)
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
