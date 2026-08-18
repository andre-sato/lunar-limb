/**
 * Documentation Health & SLO — modelo (§2, §3, §4, §5, §9).
 *
 * As camadas anteriores medem cada uma o seu pedaço: o linter mede escrita, a
 * suíte mede comportamento, o Impact Engine mede consequência, o Trust mede
 * evidência. Nenhuma delas responde à pergunta que uma equipe faz na segunda-feira:
 *
 *     "a documentação está saudável, e o que fazemos primeiro?"
 *
 * É o que esta camada monta. Ela não mede nada de novo — ela junta o que já é
 * medido, compara com um alvo declarado e transforma a diferença em fila de
 * trabalho. Indicador que não vira tarefa é enfeite de painel.
 */

// ---------------------------------------------------------------------------
// Dimensões (§2, §3)
// ---------------------------------------------------------------------------

export type HealthDimension =
	/** Nota editorial do linter. */
	| 'quality'
	/** Percentual de conteúdo dentro do prazo de verificação. */
	| 'freshness'
	/** Consistência de terminologia, do linter e do glossário. */
	| 'consistency'
	/** Percentual de páginas cobertas pela Documentation Test Suite. */
	| 'testCoverage'
	/** Endpoints documentados sobre o total declarado nas especificações. */
	| 'apiCoverage'
	/** Proveniência válida. */
	| 'trust'
	/** Regras de acessibilidade do linter. */
	| 'accessibility';

export const HEALTH_DIMENSIONS: readonly HealthDimension[] = [
	'quality',
	'freshness',
	'consistency',
	'testCoverage',
	'apiCoverage',
	'trust',
	'accessibility',
];

export const DIMENSION_LABEL: Record<HealthDimension, string> = {
	quality: 'Qualidade',
	freshness: 'Frescor',
	consistency: 'Consistência',
	testCoverage: 'Cobertura de testes',
	apiCoverage: 'Cobertura de API',
	trust: 'Confiança',
	accessibility: 'Acessibilidade',
};

export interface DimensionScore {
	dimension: HealthDimension;
	/** 0–100. */
	value: number;
	/** De onde o número veio, em uma frase. Sem isso o painel não se audita. */
	basis: string;
	/**
	 * `false` quando não havia dado suficiente para medir.
	 *
	 * A diferença importa: uma dimensão sem dado **não** é uma dimensão em 0%.
	 * Tratar ausência de medida como nota zero faria o portal parecer doente por
	 * não ter sido medido, e ninguém confia num painel que faz isso.
	 */
	measured: boolean;
}

// ---------------------------------------------------------------------------
// SLO (§4, §5)
// ---------------------------------------------------------------------------

export type SloStatus = 'healthy' | 'at-risk' | 'breached';

export const SLO_MARK: Record<SloStatus, string> = {
	healthy: '🟢',
	'at-risk': '🟡',
	breached: '🔴',
};

export const SLO_LABEL: Record<SloStatus, string> = {
	healthy: 'Saudável',
	'at-risk': 'Em risco',
	breached: 'SLO violado',
};

export interface SloTarget {
	/** Alvo em pontos percentuais. */
	target: number;
	/**
	 * Margem de aviso: quantos pontos abaixo do alvo ainda contam como "em risco"
	 * em vez de violação. Sem essa faixa, o painel alterna entre verde e vermelho
	 * a cada ponto e a equipe aprende a ignorar o vermelho.
	 */
	warning: number;
}

export interface SloConfig {
	dimensions: Partial<Record<HealthDimension, SloTarget>>;
	/** Alvo absoluto de links quebrados — normalmente zero. */
	brokenLinks: number;
	/** Webhook de alerta. Vem do ambiente, nunca do arquivo. */
	webhookConfigured: boolean;
}

export interface SloEvaluation {
	dimension: HealthDimension;
	current: number;
	target: number;
	status: SloStatus;
	measured: boolean;
}

// ---------------------------------------------------------------------------
// Lacunas e backlog (§6, §9)
// ---------------------------------------------------------------------------

export type GapKind =
	/** Pergunta recorrente sem resposta na documentação. */
	| 'unanswered'
	/** Endpoint declarado na especificação e não documentado. */
	| 'undocumented-api'
	/** Página que os leitores marcam como inútil. */
	| 'negative-feedback'
	/** Página reprovada pelo portão de qualidade. */
	| 'low-quality'
	/** Página com evidência inválida ou vencida. */
	| 'untrusted'
	/** Defeito de comportamento apontado pelos testes. */
	| 'failing-test';

export type GapPriority = 'P0' | 'P1' | 'P2';

export interface Gap {
	kind: GapKind;
	/** O que falta, em uma frase que dá para virar tarefa. */
	title: string;
	/** Detalhe verificável: caminho, endpoint, contagem. */
	detail: string;
	priority: GapPriority;
	/** Quantas vezes o sinal apareceu — perguntas repetidas, votos negativos. */
	frequency: number;
	/** Caminho ou endpoint de origem, para navegar até lá. */
	target?: string;
	/** Componentes da prioridade, para o número não ser um oráculo. */
	factors: string[];
}

export interface HealthReport {
	/** Média das dimensões medidas, 0–100. */
	overall: number;
	dimensions: DimensionScore[];
	slo: SloEvaluation[];
	sloStatus: SloStatus;
	gaps: Gap[];
	/** Visão executiva (§11). */
	totals: {
		pages: number;
		endpoints: number;
		documentedEndpoints: number;
		tests: number;
		brokenLinks: number;
		stalePages: number;
		unansweredQuestions: number;
	};
	/** Saúde por responsável (§12). */
	teams: Array<{ owner: string; pages: number; health: number }>;
	generatedAt: number;
}

/**
 * O mínimo de um finding do linter que esta camada precisa ver.
 *
 * Tipo próprio em vez de importar `LintFinding`: a saúde só olha o `ruleId`, e
 * depender do tipo completo amarraria o painel a mudanças internas do linter.
 */
export interface LintFindingLike {
	ruleId: string;
}
