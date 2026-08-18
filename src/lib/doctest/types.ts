/**
 * Testes de documentação (§1).
 *
 * A separação com o linter é conceitual e vale repetir, porque as duas coisas
 * são confundidas o tempo todo:
 *
 *     Linter  →  "isto está bem escrito?"
 *     Testes  →  "isto funciona?"
 *
 * Um link para uma página que não existe passa em qualquer regra de estilo. Um
 * exemplo de resposta que não bate com o schema da API está impecavelmente
 * redigido. São defeitos de **comportamento**, e é isso que esta camada mede.
 */

export type TestStatus = 'pass' | 'fail' | 'skip';

/** Perfis (§11): cada um é um conjunto de categorias, do mais barato ao mais caro. */
export type TestProfile = 'quick' | 'standard' | 'strict';

export type TestCategory =
	/** Links internos, âncoras e referências de Markdown. */
	| 'link'
	/** Referências do Content Graph: quebradas, circulares, órfãs. */
	| 'graph'
	/** Exemplos contra o schema OpenAPI. */
	| 'api'
	/** Blocos de código marcados como executáveis. */
	| 'snippet'
	/** Links externos — exigem rede. */
	| 'external'
	/** Chamadas reais à API — exigem rede e credencial. */
	| 'runtime';

/** O que cada perfil executa. */
export const PROFILE_CATEGORIES: Record<TestProfile, TestCategory[]> = {
	// Barato e sem rede: roda a cada salvamento sem incomodar.
	quick: ['link', 'graph'],
	// O que dá para verificar sem sair da máquina.
	standard: ['link', 'graph', 'api', 'snippet'],
	// Tudo, inclusive o que depende de rede e de credencial.
	strict: ['link', 'graph', 'api', 'snippet', 'external', 'runtime'],
};

export interface TestLocation {
	/** Caminho relativo a `src/content/docs`. */
	path: string;
	line?: number;
	column?: number;
}

export interface TestResult {
	/** Identificador estável da regra: `DOC-LINK-001`. */
	id: string;
	category: TestCategory;
	status: TestStatus;
	/** O que foi verificado, em uma frase. */
	name: string;
	/** O que deu errado, quando deu. */
	message?: string;
	/** O que se esperava e o que se encontrou, quando a comparação ajuda. */
	expected?: string;
	actual?: string;
	location?: TestLocation;
	/** Motivo de ter sido pulado — nunca fica em branco num `skip`. */
	skipReason?: string;
	durationMs?: number;
}

export interface TestSummary {
	total: number;
	passed: number;
	failed: number;
	skipped: number;
	durationMs: number;
	/** `true` quando nenhum teste falhou. */
	passing: boolean;
}

export interface TestReport {
	profile: TestProfile;
	results: TestResult[];
	summary: TestSummary;
	/** Categorias que rodaram, para o relatório não mentir por omissão. */
	categories: TestCategory[];
}

export function summarize(results: readonly TestResult[], durationMs: number): TestSummary {
	const passed = results.filter((result) => result.status === 'pass').length;
	const failed = results.filter((result) => result.status === 'fail').length;
	const skipped = results.filter((result) => result.status === 'skip').length;

	return {
		total: results.length,
		passed,
		failed,
		skipped,
		durationMs,
		// Pulado não reprova: um teste que não pôde rodar não é evidência de
		// defeito. Ele aparece no relatório para ninguém achar que rodou.
		passing: failed === 0,
	};
}
