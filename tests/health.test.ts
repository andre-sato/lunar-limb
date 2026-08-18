/**
 * Testes de Documentation Health & SLO.
 *
 * A distinção que mais precisa ficar presa no comportamento: **não medido não é
 * zero**. Um painel que trata ausência de medida como nota zero faz o portal
 * parecer doente por não ter sido medido, e um painel que faz isso a equipe
 * aprende a ignorar. Vários testes abaixo existem só para segurar essa diferença.
 */

import { describe, it, expect } from 'vitest';
import { computeDimensions, evaluateSlo, overallHealth, worstSloStatus } from '../src/lib/health/dimensions';
import { buildBacklog, composeAlert, detectGaps } from '../src/lib/health/gaps';
import { DEFAULT_SLO } from '../src/lib/health/config';
import { normalizeQuestion } from '../src/lib/health/analytics';
import type { HealthInputs } from '../src/lib/health/dimensions';
import type { DimensionScore, SloConfig } from '../src/lib/health/types';

const CONFIG: SloConfig = { ...DEFAULT_SLO };

function dimensionOf(scores: DimensionScore[], name: string): DimensionScore {
	const found = scores.find((score) => score.dimension === name);
	if (!found) throw new Error(`dimensão ausente: ${name}`);
	return found;
}

const FULL: HealthInputs = {
	lint: { averageScore: 9.4, analyzed: 40, consistencyAverage: 9.7, accessibilityRatio: 0.98 },
	trust: { documented: 10, verified: 9, stale: 1, invalid: 0, averageScore: 91, pages: 40 },
	tests: { total: 120, passed: 118, failed: 2, pagesCovered: 36, pages: 40, brokenLinks: 2 },
	coverage: { endpoints: 90, schemas: 96, examples: 82, features: 87 },
	contracts: { valid: 98, invalid: 1, warning: 1, unknown: 4 },
	freshness: { score: 90, measured: 40, stale: 2 },
	ai: { queries: 100, highConfidence: 91, unanswered: 4 },
};

// ---------------------------------------------------------------------------
// Dimensões (§3)
// ---------------------------------------------------------------------------

describe('dimensões', () => {
	it('converte a nota do linter para percentual', () => {
		expect(dimensionOf(computeDimensions(FULL), 'quality').value).toBe(94);
	});

	it('frescor vem da avaliação cruzada, não da idade pura', () => {
		const freshness = dimensionOf(computeDimensions(FULL), 'freshness');
		expect(freshness.value).toBe(90);
		expect(freshness.basis).toContain('obsoleta');
	});

	it('cobertura vem do Digital Twin, com as quatro fatias', () => {
		// Esta camada tinha o próprio cálculo de cobertura de API. Mantê-lo seria a
		// duplicação que o critério de aceite proíbe.
		const coverage = dimensionOf(computeDimensions(FULL), 'coverage');
		expect(coverage.value).toBe(89);
		expect(coverage.basis).toContain('endpoints 90%');
	});

	it('integridade de contrato ignora os desconhecidos', () => {
		// Contrato que ninguém documentou não está certo nem errado — está sem
		// documentação, e isso é assunto da cobertura.
		const integrity = dimensionOf(computeDimensions(FULL), 'contractIntegrity');
		expect(integrity.value).toBe(98);
		expect(integrity.basis).toContain('fora da conta');
	});

	it('confiabilidade conta defeitos sobre verificações', () => {
		const reliability = dimensionOf(computeDimensions(FULL), 'reliability');
		expect(reliability.measured).toBe(true);
		expect(reliability.basis).toContain('link(s) quebrado(s)');
	});

	it('preparo para IA é a proporção de respostas com confiança alta', () => {
		expect(dimensionOf(computeDimensions(FULL), 'aiReadiness').value).toBe(91);
	});

	it('sem consulta ao assistente, preparo para IA não é medido', () => {
		const scores = computeDimensions({ ...FULL, ai: { queries: 0, highConfidence: 0, unanswered: 0 } });
		expect(dimensionOf(scores, 'aiReadiness').measured).toBe(false);
	});

	it('cobertura de testes é páginas com teste sobre páginas', () => {
		expect(dimensionOf(computeDimensions(FULL), 'testCoverage').value).toBe(90);
	});

	it('cada dimensão declara de onde o número veio', () => {
		// Indicador que ninguém consegue conferir vira assunto de discussão em vez
		// de insumo de decisão.
		for (const dimension of computeDimensions(FULL)) {
			expect(dimension.basis.length).toBeGreaterThan(10);
		}
	});

	it('sem dado, a dimensão sai como não medida — não como zero', () => {
		const scores = computeDimensions({});
		expect(scores.every((score) => !score.measured)).toBe(true);
		expect(dimensionOf(scores, 'trust').basis).toContain('indisponível');
	});

	it('portal sem proveniência não derruba a confiança para zero', () => {
		const scores = computeDimensions({
			...FULL,
			trust: { documented: 0, verified: 0, stale: 0, invalid: 0, averageScore: 0, pages: 40 },
		});
		expect(dimensionOf(scores, 'trust').measured).toBe(false);
	});

	it('a ordem das dimensões é estável', () => {
		const first = computeDimensions(FULL).map((score) => score.dimension);
		const second = computeDimensions({}).map((score) => score.dimension);
		expect(first).toEqual(second);
	});
});

describe('nota geral', () => {
	it('é a média das dimensões medidas', () => {
		const scores: DimensionScore[] = [
			{ dimension: 'quality', value: 90, basis: '', measured: true },
			{ dimension: 'trust', value: 70, basis: '', measured: true },
		];
		expect(overallHealth(scores)).toBe(80);
	});

	it('dimensão não medida não entra como zero', () => {
		const scores: DimensionScore[] = [
			{ dimension: 'quality', value: 90, basis: '', measured: true },
			{ dimension: 'trust', value: 0, basis: 'sem dado', measured: false },
		];
		expect(overallHealth(scores)).toBe(90);
	});

	it('nada medido resulta em zero, e o painel dirá que não há medida', () => {
		expect(overallHealth(computeDimensions({}))).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// SLO (§4, §5)
// ---------------------------------------------------------------------------

describe('SLO', () => {
	const evaluate = (dimension: string, value: number, measured = true) =>
		evaluateSlo([{ dimension: dimension as never, value, basis: '', measured }], CONFIG)[0];

	it('no alvo ou acima é saudável', () => {
		expect(evaluate('quality', 90).status).toBe('healthy');
		expect(evaluate('quality', 97).status).toBe('healthy');
	});

	it('dentro da margem de aviso é risco, não violação', () => {
		// Sem a faixa, o painel alterna entre verde e vermelho a cada ponto e a
		// equipe aprende a ignorar o vermelho.
		expect(evaluate('quality', 86).status).toBe('at-risk');
	});

	it('abaixo da margem é violação', () => {
		expect(evaluate('quality', 70).status).toBe('breached');
	});

	it('dimensão não medida fica em risco — não se viola um alvo que não foi aferido', () => {
		expect(evaluate('quality', 0, false).status).toBe('at-risk');
	});

	it('dimensão sem alvo configurado não é avaliada', () => {
		const evaluations = evaluateSlo([{ dimension: 'quality', value: 50, basis: '', measured: true }], {
			...CONFIG,
			dimensions: {},
		});
		expect(evaluations).toEqual([]);
	});

	it('o pior status decide a cor do topo', () => {
		expect(
			worstSloStatus([
				{ dimension: 'quality', current: 95, target: 90, status: 'healthy', measured: true },
				{ dimension: 'trust', current: 50, target: 90, status: 'breached', measured: true },
			])
		).toBe('breached');
	});

	it('os orçamentos zerados são os que não têm justificativa', () => {
		expect(DEFAULT_SLO.budgets.brokenLinks).toBe(0);
		expect(DEFAULT_SLO.budgets.contractFailures).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Lacunas e backlog (§6, §9)
// ---------------------------------------------------------------------------

describe('lacunas', () => {
	it('pergunta muito repetida vira P0', () => {
		const gaps = detectGaps({ unanswered: [{ question: 'como girar a chave de api', count: 43 }] });
		expect(gaps[0]).toMatchObject({ kind: 'unanswered', priority: 'P0', frequency: 43 });
	});

	it('pergunta isolada não vira P0', () => {
		// Uma fila em que tudo é P0 é uma fila sem prioridade.
		const gaps = detectGaps({ unanswered: [{ question: 'algo', count: 1 }] });
		expect(gaps[0].priority).toBe('P2');
	});

	it('evidência inválida é o único sinal de página possivelmente errada — e entra como P0', () => {
		const gaps = detectGaps({ untrustedPages: [{ path: 'a.md', status: 'invalid' }] });
		expect(gaps[0]).toMatchObject({ kind: 'untrusted', priority: 'P0' });
	});

	it('verificação vencida é P2, não P0', () => {
		const gaps = detectGaps({ untrustedPages: [{ path: 'a.md', status: 'stale' }] });
		expect(gaps[0].priority).toBe('P2');
	});

	it('endpoint sem página é dívida certa, não hipótese', () => {
		const gaps = detectGaps({ undocumentedEndpoints: ['POST /users'] });
		expect(gaps[0]).toMatchObject({ kind: 'undocumented-api', priority: 'P1', target: 'POST /users' });
	});

	it('nota baixa entra por último: página malescrita e correta ainda ajuda', () => {
		const gaps = detectGaps({
			failingPages: [{ path: 'a.md', score: 5 }],
			untrustedPages: [{ path: 'b.md', status: 'invalid' }],
		});
		expect(gaps[0].kind).toBe('untrusted');
		expect(gaps.at(-1)?.kind).toBe('low-quality');
	});

	it('cada lacuna carrega por que recebeu a prioridade', () => {
		const gaps = detectGaps({ negativePages: [{ path: 'a.md', down: 7, total: 9 }] });
		expect(gaps[0].factors.join(' ')).toContain('7');
	});

	it('sem sinal nenhum, nenhuma lacuna', () => {
		expect(detectGaps({})).toEqual([]);
	});

	it('o backlog separa por prioridade mantendo a ordem', () => {
		const gaps = detectGaps({
			unanswered: [{ question: 'muito perguntada', count: 20 }],
			undocumentedEndpoints: ['GET /a'],
			failingPages: [{ path: 'x.md', score: 4 }],
		});

		const backlog = buildBacklog(gaps);
		expect(backlog.P0).toHaveLength(1);
		expect(backlog.P1).toHaveLength(1);
		expect(backlog.P2).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// Alerta (§10)
// ---------------------------------------------------------------------------

describe('alerta', () => {
	it('diz o que quebrou, quanto, e o que fazer', () => {
		const message = composeAlert({
			breached: [{ dimension: 'Cobertura de API', current: 94, target: 100 }],
			topGaps: detectGaps({ undocumentedEndpoints: ['POST /users'] }),
		});

		expect(message).toContain('Cobertura de API');
		expect(message).toContain('94%');
		expect(message).toContain('100%');
		expect(message).toContain('POST /users');
	});

	it('sem violação, não há alerta — nem mensagem dizendo que está tudo bem', () => {
		expect(composeAlert({ breached: [], topGaps: [] })).toBe('');
	});
});

// ---------------------------------------------------------------------------
// Analytics (§7)
// ---------------------------------------------------------------------------

describe('normalização de pergunta', () => {
	it('agrupa variações da mesma dúvida', () => {
		expect(normalizeQuestion('Como  ROTACIONAR a Chave de API?')).toBe('como rotacionar a chave de api?');
		expect(normalizeQuestion('Como rotacionar a chave de API')).toBe('como rotacionar a chave de api');
	});

	it('dobra acento', () => {
		expect(normalizeQuestion('autenticação')).toBe('autenticacao');
	});

	it('remove credencial antes de qualquer coisa', () => {
		// O texto só é guardado com autorização explícita, e mesmo assim uma chave
		// colada por engano na pergunta não pode ir para o arquivo.
		const normalized = normalizeQuestion('erro com sk-ant-api03-MaterialRealDeChave0123456789 no header');
		expect(normalized).not.toContain('MaterialRealDeChave');
	});

	it('trunca perguntas longas', () => {
		expect(normalizeQuestion('a'.repeat(500)).length).toBeLessThanOrEqual(160);
	});
});
