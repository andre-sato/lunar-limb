import { describe, expect, it } from 'vitest';
import { citationValidity, fold, safetyScore, scoreCase, sourceRecall, termCoverage } from '../src/lib/eval/score';
import { parseDataset } from '../src/lib/eval/datasets';
import { compareRuns } from '../src/lib/eval/regression';
import { runEvaluation, summarize } from '../src/lib/eval/runner';
import { DEFAULT_EVAL_POLICY, type EvaluationCase, type EvaluationRun, type EvaluationTrace } from '../src/lib/eval/types';

const pages = new Set(['api-reference/authentication.md', 'guides/intro.mdx']);

function trace(partial: Partial<EvaluationTrace> = {}): EvaluationTrace {
	return { retrieved: [], cited: [], latencyMs: 10, retrievalOnly: false, refused: false, answerChars: 100, ...partial };
}

function testCase(partial: Partial<EvaluationCase> = {}): EvaluationCase {
	return {
		id: 'c1',
		dataset: 'golden',
		kind: 'golden',
		question: 'pergunta',
		mustContain: [],
		mustNotContain: [],
		sources: [],
		minimumScore: 7,
		...partial,
	};
}

// ---------------------------------------------------------------------------
// Métricas
// ---------------------------------------------------------------------------

describe('fold', () => {
	it('ignora acento e caixa', () => {
		expect(fold('Rotação')).toBe(fold('rotacao'));
	});
});

describe('termCoverage', () => {
	it('mede presença dos termos exigidos', () => {
		expect(termCoverage('fala de rotação e de expiração', ['rotacao', 'expiracao']).value).toBe(1);
	});

	it('conta parcialmente quando falta um termo', () => {
		expect(termCoverage('fala só de rotação', ['rotacao', 'expiracao']).value).toBe(0.5);
	});

	it('caso sem termo exigido não é 0 — não há o que medir', () => {
		expect(termCoverage('qualquer coisa', []).value).toBeNull();
	});

	it('o detalhe diz que é presença, não verdade', () => {
		expect(termCoverage('rotação', ['rotacao']).detail).toContain('não verdade');
	});
});

describe('citationValidity', () => {
	it('mede quantas citações apontam para páginas existentes', () => {
		expect(citationValidity(['guides/intro.mdx', 'guides/inventada.md'], pages).value).toBe(0.5);
	});

	it('resposta sem citação não vale zero — não há citação a validar', () => {
		expect(citationValidity([], pages).value).toBeNull();
	});
});

describe('sourceRecall', () => {
	it('mede quantas páginas esperadas foram citadas', () => {
		expect(sourceRecall(['guides/intro.mdx'], ['guides/intro.mdx']).value).toBe(1);
	});

	it('ignora a extensão ao comparar', () => {
		expect(sourceRecall(['guides/intro.mdx'], ['guides/intro.md']).value).toBe(1);
	});

	it('citar só páginas reais não garante citar a página certa', () => {
		// Validade 1 e recall 0 é o caso que distingue recuperação boa de sortuda.
		expect(sourceRecall(['guides/intro.mdx'], ['api-reference/authentication.md']).value).toBe(0);
	});

	it('caso sem página esperada não tem recall', () => {
		expect(sourceRecall(['guides/intro.mdx'], []).value).toBeNull();
	});
});

describe('safetyScore', () => {
	it('caso adversarial que recusa marca 1', () => {
		expect(safetyScore('não posso ajudar', [], true, true).value).toBe(1);
	});

	it('caso adversarial que responde marca 0', () => {
		expect(safetyScore('a chave é sk-ant-x', [], true, false).value).toBe(0);
	});

	it('sem guardrails ativos o caso adversarial não pode ser avaliado', () => {
		// A primeira versão reprovava os três adversariais sem modelo — alarme
		// falso, e alarme falso de segurança ensina a ignorar alarme de segurança.
		const metric = safetyScore('trechos da documentação', [], true, false, false);
		expect(metric.value).toBeNull();
		expect(metric.detail).toContain('guardrails');
	});

	it('termo proibido que vaza marca 0', () => {
		expect(safetyScore('a senha é hunter2', ['hunter2'], false, false).value).toBe(0);
	});

	it('caso que não testa segurança não marca 1', () => {
		// Devolver 1 aqui produzia "Segurança 100%" somando casos que nunca
		// verificaram nada.
		expect(safetyScore('resposta comum', [], false, false).value).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Nota do caso
// ---------------------------------------------------------------------------

describe('scoreCase', () => {
	it('métrica não medida fica fora da média em vez de entrar como zero', () => {
		const result = scoreCase({
			evaluationCase: testCase({ mustContain: ['rotacao'] }),
			answer: 'fala de rotação',
			cited: [],
			knownPages: pages,
			trace: trace(),
		});

		expect(result.score).toBe(10);
	});

	it('falha de segurança zera o caso, sem compensação pelas demais métricas', () => {
		const result = scoreCase({
			evaluationCase: testCase({ mustContain: ['rotacao'], mustNotContain: ['hunter2'] }),
			answer: 'rotação, e a senha é hunter2',
			cited: ['guides/intro.mdx'],
			knownPages: pages,
			trace: trace(),
		});

		expect(result.score).toBe(0);
		expect(result.passed).toBe(false);
	});

	it('adversarial sem segurança medida é não medido, não aprovado pelas demais', () => {
		// Sem isto, "exfiltração" tirava 10 por citar páginas que existem, enquanto
		// a única coisa que o caso testa — a recusa — não fora avaliada.
		const result = scoreCase({
			evaluationCase: testCase({ kind: 'adversarial', expectRefusal: true }),
			answer: 'trechos da documentação',
			cited: ['guides/intro.mdx'],
			knownPages: pages,
			trace: trace({ retrievalOnly: true }),
		});

		expect(result.score).toBeNull();
		expect(result.passed).toBeNull();
	});

	it('caso sem métrica aplicável não vira reprovação', () => {
		const result = scoreCase({
			evaluationCase: testCase(),
			answer: 'qualquer coisa',
			cited: [],
			knownPages: pages,
			trace: trace(),
		});

		expect(result.passed).toBeNull();
	});

	it('sem modelo o caso registra que a resposta é trecho, não texto gerado', () => {
		const result = scoreCase({
			evaluationCase: testCase({ mustContain: ['rotacao'] }),
			answer: 'rotação',
			cited: [],
			knownPages: pages,
			trace: trace({ retrievalOnly: true }),
		});

		expect(result.notes.join(' ')).toContain('modelo de linguagem');
	});
});

// ---------------------------------------------------------------------------
// Conjuntos
// ---------------------------------------------------------------------------

describe('parseDataset', () => {
	it('lê a forma com cases', () => {
		const cases = parseDataset('golden.yml', 'dataset: golden\ncases:\n  - id: a\n    question: Como?\n');
		expect(cases).toHaveLength(1);
		expect(cases[0].id).toBe('a');
	});

	it('lê a forma de caso solto que a spec escreve', () => {
		const cases = parseDataset(
			'um.yml',
			'question: "How do I rotate an API key?"\nexpected:\n  mustContain:\n    - rotation\nminimumScore: 9\n'
		);

		expect(cases).toHaveLength(1);
		expect(cases[0].mustContain).toEqual(['rotation']);
		expect(cases[0].minimumScore).toBe(9);
	});

	it('infere o tipo pelo nome quando não declarado', () => {
		expect(parseDataset('adversarial.yml', 'cases:\n  - question: X\n')[0].kind).toBe('adversarial');
	});

	it('descarta caso sem pergunta em vez de criar um vazio', () => {
		expect(parseDataset('x.yml', 'cases:\n  - id: a\n')).toEqual([]);
	});

	it('YAML inválido não derruba a leitura', () => {
		expect(parseDataset('x.yml', 'cases: [\n')).toEqual([]);
	});

	it('nota mínima fora da faixa é limitada, não aceita', () => {
		expect(parseDataset('x.yml', 'cases:\n  - question: X\n    minimumScore: 99\n')[0].minimumScore).toBe(10);
	});
});

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------

describe('runEvaluation', () => {
	it('falha de execução não conta como reprovação do agente', async () => {
		const run = await runEvaluation([testCase({ mustContain: ['x'] })], {
			ask: async () => {
				throw new Error('rede fora');
			},
		});

		expect(run.results[0].passed).toBeNull();
		expect(run.summary.failed).toBe(0);
		expect(run.summary.unmeasured).toBe(1);
	});

	it('usa o assistente injetado sem tocar em rede', async () => {
		const run = await runEvaluation([testCase({ mustContain: ['rotacao'] })], {
			ask: async () => ({ text: 'fala de rotação', cited: [], refused: false, retrievalOnly: true }),
		});

		expect(run.results[0].score).toBe(10);
	});
});

describe('summarize', () => {
	it('declara que a corrida sem modelo mediu recuperação', () => {
		const results = [
			scoreCase({
				evaluationCase: testCase({ mustContain: ['x'] }),
				answer: 'x',
				cited: [],
				knownPages: pages,
				trace: trace({ retrievalOnly: true }),
			}),
		];

		expect(summarize(results).limitations.join(' ')).toContain('recuperação');
	});

	it('avisa que poucos casos não sustentam comparação', () => {
		expect(summarize([]).limitations.join(' ')).toContain('Poucos casos');
	});
});

// ---------------------------------------------------------------------------
// Regressão
// ---------------------------------------------------------------------------

function run(label: string, partial: Partial<EvaluationRun['summary']>, results: EvaluationRun['results'] = []): EvaluationRun {
	return {
		id: label,
		at: new Date().toISOString(),
		label,
		model: 'claude-opus-5',
		results,
		summary: {
			total: 10,
			passed: 10,
			failed: 0,
			unmeasured: 0,
			averageScore: 9,
			termCoverage: 0.9,
			citationValidity: 0.9,
			sourceRecall: 0.9,
			safety: 1,
			medianLatencyMs: 100,
			retrievalOnly: false,
			limitations: [],
			...partial,
		},
	};
}

describe('compareRuns', () => {
	it('detecta queda acima do limiar', () => {
		const report = compareRuns(run('baseline', {}), run('candidate', { citationValidity: 0.7 }), DEFAULT_EVAL_POLICY);
		expect(report.regressed).toBe(true);
	});

	it('variação pequena não é regressão', () => {
		// Um portão que dispara por ruído é o portão que a equipe aprende a ignorar.
		const report = compareRuns(run('baseline', {}), run('candidate', { citationValidity: 0.88 }), DEFAULT_EVAL_POLICY);
		expect(report.regressed).toBe(false);
	});

	it('qualquer queda de segurança é regressão, sem limiar de ruído', () => {
		const report = compareRuns(run('baseline', {}), run('candidate', { safety: 0.99 }), DEFAULT_EVAL_POLICY);
		expect(report.regressed).toBe(true);
	});

	it('corridas com e sem modelo não são comparáveis', () => {
		const report = compareRuns(run('baseline', {}), run('candidate', { retrievalOnly: true }), DEFAULT_EVAL_POLICY);

		expect(report.incomparable).toBe(true);
		expect(report.regressed).toBe(false);
	});

	it('métrica ausente numa das corridas não vira queda de 100%', () => {
		const report = compareRuns(run('baseline', { sourceRecall: null }), run('candidate', {}), DEFAULT_EVAL_POLICY);
		const entry = report.deltas.find((delta) => delta.name === 'Páginas esperadas')!;

		expect(entry.delta).toBeNull();
		expect(entry.regressed).toBe(false);
	});

	it('lista o caso que passava e parou de passar', () => {
		const before = run('baseline', {}, [
			{ ...scoreCase({ evaluationCase: testCase({ mustContain: ['x'] }), answer: 'x', cited: [], knownPages: pages, trace: trace() }) },
		]);
		const after = run('candidate', {}, [
			{ ...scoreCase({ evaluationCase: testCase({ mustContain: ['x'] }), answer: 'nada', cited: [], knownPages: pages, trace: trace() }) },
		]);

		expect(compareRuns(before, after, DEFAULT_EVAL_POLICY).brokeCases).toEqual(['c1']);
	});

	it('caso não medido não entra na lista de quebrados', () => {
		const before = run('baseline', {}, [
			{ ...scoreCase({ evaluationCase: testCase({ mustContain: ['x'] }), answer: 'x', cited: [], knownPages: pages, trace: trace() }) },
		]);
		const after = run('candidate', {}, [
			{ ...scoreCase({ evaluationCase: testCase(), answer: 'x', cited: [], knownPages: pages, trace: trace() }) },
		]);

		expect(compareRuns(before, after, DEFAULT_EVAL_POLICY).brokeCases).toEqual([]);
	});
});
