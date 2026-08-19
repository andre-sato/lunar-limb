/**
 * Comparação entre duas corridas (P3.3 — § Regression detection).
 *
 * Duas armadilhas evitadas aqui, e as duas transformariam o portão em ruído:
 *
 * 1. **Comparar corridas que não são comparáveis.** Uma corrida com modelo e
 *    outra sem medem coisas diferentes; achatar as duas numa diferença produziria
 *    "regressão de 40 pontos" quando o que mudou foi a presença da chave de API.
 * 2. **Disparar por variação pequena.** Abaixo do limiar a diferença é ruído de
 *    recuperação, e um portão que dispara por ruído é o portão que a equipe
 *    aprende a ignorar.
 */

import type { EvaluationPolicy, EvaluationRun, MetricDelta, RegressionReport } from './types';

function delta(name: string, before: number | null, after: number | null, threshold: number): MetricDelta {
	if (before === null || after === null) {
		// Métrica que não existia numa das corridas não regrediu — ela não tem
		// comparação, e tratá-la como queda de 100% inventaria um problema.
		return { name, before, after, delta: null, regressed: false };
	}

	const difference = Math.round((after - before) * 100) / 100;
	return { name, before, after, delta: difference, regressed: difference * 100 < -threshold };
}

export function compareRuns(
	baseline: EvaluationRun,
	candidate: EvaluationRun,
	policy: EvaluationPolicy
): RegressionReport {
	if (baseline.summary.retrievalOnly !== candidate.summary.retrievalOnly) {
		return {
			baseline: baseline.label,
			candidate: candidate.label,
			deltas: [],
			brokeCases: [],
			fixedCases: [],
			regressed: false,
			incomparable: true,
			reason:
				'Uma das corridas rodou sem modelo de linguagem e a outra não. Elas medem coisas diferentes, e a diferença entre elas não é regressão.',
		};
	}

	const deltas = [
		delta('Nota média', scale(baseline.summary.averageScore), scale(candidate.summary.averageScore), policy.regressionThreshold),
		delta('Termos presentes', baseline.summary.termCoverage, candidate.summary.termCoverage, policy.regressionThreshold),
		delta('Citações válidas', baseline.summary.citationValidity, candidate.summary.citationValidity, policy.regressionThreshold),
		delta('Páginas esperadas', baseline.summary.sourceRecall, candidate.summary.sourceRecall, policy.regressionThreshold),
		// Segurança regride com qualquer queda: aqui não há limiar de ruído, porque
		// um caso adversarial que passou a ser respondido é um caso adversarial que
		// passou a ser respondido.
		delta('Segurança', baseline.summary.safety, candidate.summary.safety, 0),
	];

	const before = new Map(baseline.results.map((result) => [result.caseId, result.passed]));
	const after = new Map(candidate.results.map((result) => [result.caseId, result.passed]));

	const brokeCases: string[] = [];
	const fixedCases: string[] = [];

	for (const [caseId, passedAfter] of after) {
		const passedBefore = before.get(caseId);
		// Caso novo, caso removido e caso não medido ficam fora: nenhum deles é
		// mudança de comportamento do agente.
		if (passedBefore === undefined || passedBefore === null || passedAfter === null) continue;
		if (passedBefore && !passedAfter) brokeCases.push(caseId);
		if (!passedBefore && passedAfter) fixedCases.push(caseId);
	}

	const safetyRegressed = deltas.find((entry) => entry.name === 'Segurança')?.regressed === true;

	return {
		baseline: baseline.label,
		candidate: candidate.label,
		deltas,
		brokeCases: brokeCases.sort(),
		fixedCases: fixedCases.sort(),
		regressed: deltas.some((entry) => entry.regressed) || (policy.failOnSafety && safetyRegressed),
		incomparable: false,
	};
}

/** Nota de 0–10 para a mesma escala 0–1 das demais métricas. */
function scale(value: number | null): number | null {
	return value === null ? null : Math.round((value / 10) * 100) / 100;
}
