/**
 * Score Engine (§45–§51, §83).
 *
 * Transforma findings em avaliação de qualidade. Não conhece regras nem
 * parsing — recebe findings e devolve números.
 *
 * A §83 proíbe explicitamente `score = 10 - nErros`. O desenho aqui tem três
 * propriedades que evitam esse resultado:
 *
 *  1. **Multidimensional.** Cada categoria é pontuada isoladamente, e a nota
 *     final é a média ponderada (§46). Uma página sem erro de gramática mas com
 *     estrutura ruim e instruções vagas perde nas categorias correspondentes.
 *
 *  2. **Por densidade, não por contagem.** Três problemas em 200 palavras são
 *     piores do que três em 2000. Sem normalizar por tamanho, páginas longas
 *     seriam punidas só por serem longas — e o autor aprenderia a escrever
 *     menos, que é o oposto do objetivo.
 *
 *  3. **Peso por impacto (§49).** Um link quebrado e a palavra "simplesmente"
 *     não podem custar o mesmo. O peso vem da regra; a severidade multiplica.
 */

import type {
	CategoryScores,
	LintFinding,
	QualityScore,
	ScoredCategory,
	Severity,
	GateStatus,
} from './types';
import { SCORED_CATEGORIES } from './types';
import type { ResolvedConfig, ScoreBand } from './config';

/** Quanto cada severidade multiplica o peso da regra. */
const SEVERITY_FACTOR: Record<Severity, number> = {
	error: 1,
	warning: 0.5,
	suggestion: 0.2,
	info: 0,
};

/** Penalidade global do §48, aplicada sobre a média ponderada. */
const SEVERITY_PENALTY: Record<Severity, number> = {
	error: 0.5,
	warning: 0.2,
	suggestion: 0.05,
	info: 0,
};

/**
 * Teto da penalidade global.
 *
 * Sem ele, uma página com dezenas de problemas chegaria a zero apenas pela
 * contagem, e a nota deixaria de distinguir "ruim" de "péssimo" — voltando a
 * ser a contagem de erros que a §83 rejeita.
 */
const MAX_GLOBAL_PENALTY = 3;

/** Palavras que representam "um documento de tamanho típico". */
const SIZE_BASELINE_WORDS = 150;

/** Converte densidade de problemas em perda de pontos. */
const DENSITY_FACTOR = 2.2;

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

export function round1(value: number): number {
	return Math.round(value * 10) / 10;
}

/**
 * Legibilidade em nota 0–10.
 *
 * Usa um platô em vez de uma reta: documentação técnica tem termos longos por
 * necessidade, e mapear o índice diretamente puniria toda página que fale de
 * autenticação ou idempotência. Acima de 50 a leitura é considerada adequada;
 * abaixo disso a nota cai, mas nunca de forma abrupta.
 */
export function readabilityToScore(readingEase: number): number {
	if (readingEase >= 50) return 10;
	if (readingEase >= 30) return 6 + ((readingEase - 30) / 20) * 4;
	return clamp((readingEase / 30) * 6, 0, 6);
}

export function bandFor(score: number, bands: readonly ScoreBand[]): string {
	const ordered = [...bands].sort((a, b) => b.min - a.min);
	for (const band of ordered) {
		if (score >= band.min) return band.label;
	}
	return ordered[ordered.length - 1]?.label ?? '—';
}

export function countBySeverity(findings: readonly LintFinding[]): Record<Severity, number> {
	const counts: Record<Severity, number> = { error: 0, warning: 0, suggestion: 0, info: 0 };
	for (const finding of findings) counts[finding.severity]++;
	return counts;
}

export interface ScoreInput {
	findings: readonly LintFinding[];
	config: ResolvedConfig;
	/** Palavras do corpo, para normalizar por tamanho. */
	words: number;
	/** Índice de facilidade de leitura, 0–100. */
	readingEase: number;
}

export function calculateScore(input: ScoreInput): QualityScore {
	const { findings, config, words, readingEase } = input;

	// Documento minúsculo não deve ser normalizado para baixo: um problema em
	// 20 palavras é grave, mas dividir por 0,13 explodiria a penalidade.
	const sizeNorm = Math.max(1, words / SIZE_BASELINE_WORDS);

	const damage = new Map<string, number>();
	for (const finding of findings) {
		const factor = SEVERITY_FACTOR[finding.severity];
		if (factor === 0) continue;
		const current = damage.get(finding.category) ?? 0;
		damage.set(finding.category, current + finding.weight * factor);
	}

	const categories = {} as CategoryScores;
	for (const category of SCORED_CATEGORIES) {
		const raw = damage.get(category) ?? 0;
		const penalty = (raw / sizeNorm) * DENSITY_FACTOR;
		categories[category as ScoredCategory] = round1(clamp(10 - penalty, 0, 10));
	}

	// A legibilidade vem da métrica, não de findings: ela mede o texto, não
	// conta defeitos. Os findings da categoria (parágrafo longo) entram como
	// desconto sobre essa base.
	const readabilityBase = readabilityToScore(readingEase);
	const readabilityDamage = ((damage.get('readability') ?? 0) / sizeNorm) * DENSITY_FACTOR;
	categories.readability = round1(clamp(readabilityBase - readabilityDamage, 0, 10));

	// Média ponderada (§47).
	let weighted = 0;
	let totalWeight = 0;
	for (const category of SCORED_CATEGORIES) {
		const weight = config.categoryWeights[category] ?? 0;
		if (weight <= 0) continue;
		weighted += categories[category as ScoredCategory] * weight;
		totalWeight += weight;
	}
	const base = totalWeight > 0 ? weighted / totalWeight : 10;

	// Penalidade global do §48, com teto.
	let globalPenalty = 0;
	for (const finding of findings) globalPenalty += SEVERITY_PENALTY[finding.severity];
	globalPenalty = Math.min(globalPenalty / sizeNorm, MAX_GLOBAL_PENALTY);

	const score = round1(clamp(base - globalPenalty, 0, 10));

	// Preparo para IA é apresentado à parte para não distorcer a nota
	// editorial (§46).
	const aiDamage = (damage.get('aiReadiness') ?? 0) / sizeNorm;
	const aiReadiness = round1(clamp(10 - aiDamage * DENSITY_FACTOR, 0, 10));

	return {
		score,
		categories,
		aiReadiness,
		band: bandFor(score, config.bands),
		counts: countBySeverity(findings),
	};
}

/** Resultado do quality gate (§56). */
export function evaluateGate(
	score: number,
	counts: Record<Severity, number>,
	config: ResolvedConfig
): GateStatus {
	if (!config.qualityGate.enabled) return 'pass';
	if (config.qualityGate.failOnErrors && counts.error > 0) return 'fail';
	if (score < config.qualityGate.minimumScore) return 'fail';
	// Passou no mínimo, mas com avisos: vale sinalizar sem barrar.
	if (counts.warning > 0) return 'warning';
	return 'pass';
}
