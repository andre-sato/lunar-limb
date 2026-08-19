/**
 * AI Evaluation — modelo (P3.3).
 *
 * A pergunta: *o agente está correto, fundamentado, completo e seguro?*
 *
 * Uma distinção organiza o arquivo inteiro, e ignorá-la é como uma avaliação de
 * IA vira teatro: **há métricas verificáveis e métricas inferidas.**
 *
 * - *Verificável* é o que dá para conferir contra o repositório: a citação
 *   aponta para uma página que existe? O trecho citado está mesmo lá? A resposta
 *   contém o termo que a pergunta exige?
 * - *Inferido* é tudo que exige julgamento — se a resposta é "boa", "completa",
 *   "relevante".
 *
 * O portal mede as verificáveis por padrão e **não** finge medir as outras. Um
 * modelo julgando a saída de outro modelo é circular, caro, e produz um número
 * confortável que ninguém consegue auditar. Quando o julgamento por modelo é
 * ligado explicitamente, cada nota vem marcada como `judge: 'model'`.
 */

export type DatasetKind = 'golden' | 'regression' | 'adversarial' | 'real';

export const DATASET_LABEL: Record<DatasetKind, string> = {
	golden: 'Perguntas de referência',
	regression: 'Regressão',
	adversarial: 'Adversariais',
	real: 'Perguntas reais',
};

export interface EvaluationCase {
	id: string;
	dataset: string;
	kind: DatasetKind;
	question: string;
	/** Termos que a resposta precisa conter. Comparados sem acento e sem caixa. */
	mustContain: string[];
	/** Termos que a resposta **não** pode conter. */
	mustNotContain: string[];
	/** Páginas que deveriam ser citadas, relativas a `src/content/docs`. */
	sources: string[];
	/** Nota mínima, de 0 a 10, para o caso passar. */
	minimumScore: number;
	/**
	 * `true` quando a resposta correta é **recusar**. Usado nas adversariais:
	 * injeção de prompt, exfiltração, pedido fora de escopo.
	 */
	expectRefusal?: boolean;
}

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------

export type MetricJudge = 'verifiable' | 'model';

export interface Metric {
	/** 0 a 1, ou `null` quando não foi possível medir. */
	value: number | null;
	judge: MetricJudge;
	detail: string;
}

export interface CaseResult {
	caseId: string;
	dataset: string;
	kind: DatasetKind;
	/** Nota de 0 a 10 derivada das métricas verificáveis. */
	score: number | null;
	passed: boolean | null;
	metrics: {
		/** Fração dos termos exigidos que apareceram. Não é verdade — é presença. */
		termCoverage: Metric;
		/** Fração das citações que apontam para páginas existentes. */
		citationValidity: Metric;
		/** Fração das páginas esperadas que foram efetivamente citadas. */
		sourceRecall: Metric;
		/** `1` quando nenhum termo proibido apareceu. */
		safety: Metric;
	};
	/** Metadados operacionais. Nunca o raciocínio interno do modelo. */
	trace: EvaluationTrace;
	notes: string[];
}

/**
 * O rastro de uma avaliação (§ Agent trace).
 *
 * A spec é explícita: *não armazenar chain-of-thought privado; somente metadados
 * necessários para avaliação e debugging*. Por isso aqui há **o que** foi
 * recuperado e citado, e não o texto do raciocínio.
 */
export interface EvaluationTrace {
	retrieved: string[];
	cited: string[];
	/** Milissegundos da pergunta à resposta. */
	latencyMs: number;
	/** `true` quando o pipeline respondeu sem modelo (só trechos). */
	retrievalOnly: boolean;
	refused: boolean;
	answerChars: number;
}

export interface EvaluationRun {
	id: string;
	at: string;
	/** Rótulo da configuração avaliada: `baseline`, `candidate`, um commit. */
	label: string;
	model: string | null;
	results: CaseResult[];
	summary: EvaluationSummary;
}

export interface EvaluationSummary {
	total: number;
	passed: number;
	failed: number;
	/** Casos que não puderam ser medidos. Nunca contados como falha. */
	unmeasured: number;
	/** Média das notas, ou `null` quando nada foi medido. */
	averageScore: number | null;
	termCoverage: number | null;
	citationValidity: number | null;
	sourceRecall: number | null;
	safety: number | null;
	medianLatencyMs: number | null;
	/** `true` quando a corrida rodou sem modelo de linguagem. */
	retrievalOnly: boolean;
	limitations: string[];
}

// ---------------------------------------------------------------------------
// Regressão
// ---------------------------------------------------------------------------

export interface MetricDelta {
	name: string;
	before: number | null;
	after: number | null;
	delta: number | null;
	regressed: boolean;
}

export interface RegressionReport {
	baseline: string;
	candidate: string;
	deltas: MetricDelta[];
	/** Casos que passavam e pararam de passar. */
	brokeCases: string[];
	/** Casos que falhavam e passaram a passar. */
	fixedCases: string[];
	regressed: boolean;
	/** `true` quando as duas corridas não são comparáveis. */
	incomparable: boolean;
	reason?: string;
}

export interface EvaluationPolicy {
	/** Queda em pontos percentuais que caracteriza regressão. */
	regressionThreshold: number;
	/** Nota mínima da corrida para o portão passar. */
	minimumAverageScore: number;
	/** Casos adversariais que falham bloqueiam sempre. */
	failOnSafety: boolean;
}

export const DEFAULT_EVAL_POLICY: EvaluationPolicy = {
	// 5 pontos: abaixo disso a variação é ruído de recuperação, e um portão que
	// dispara por ruído é o portão que a equipe aprende a ignorar.
	regressionThreshold: 5,
	minimumAverageScore: 7,
	failOnSafety: true,
};
