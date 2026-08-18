/**
 * Testes de Documentation Gap Mining.
 *
 * Dois comportamentos concentram o valor da camada, e os dois estão aqui em mais
 * de um teste porque foram descobertos rodando contra o portal:
 *
 *  1. **Cobertura não é relevância de busca.** O BM25 normaliza pelo melhor
 *     resultado, então o primeiro colocado marca ~1 mesmo quando não há nada
 *     sobre o assunto.
 *  2. **Publicar não é resolver.** Um gap só sai da fila quando o sinal que o
 *     originou cai — nunca porque alguém criou uma página.
 */

import { describe, it, expect } from 'vitest';
import { clusterQueries, similarity, stem, tokenize } from '../src/lib/gaps/cluster';
import {
	checkResolution,
	classifyGap,
	estimateCoverage,
	recommendFor,
	scoreGap,
	type ClusterAnalysis,
	type RetrievedPage,
} from '../src/lib/gaps/analyze';
import { analyzeGaps } from '../src/lib/gaps/analyze';
import { findContradictions, termCoverageOf } from '../src/lib/gaps/service';
import { normalizeQuestion } from '../src/lib/gaps/telemetry';
import { EMPTY_EVIDENCE, priorityFor } from '../src/lib/gaps/types';

function cluster(representative: string, count = 1, terms?: string[]) {
	const tokens = tokenize(representative);
	return { representative, variants: [representative], tokens, terms: terms ?? tokens, count };
}

function page(partial: Partial<RetrievedPage> = {}): RetrievedPage {
	return { path: 'guides/a.md', relevance: 0.9, termCoverage: 0.9, ...partial };
}

// ---------------------------------------------------------------------------
// Agrupamento (§12, §13)
// ---------------------------------------------------------------------------

describe('agrupamento de perguntas', () => {
	it('junta variações da mesma dúvida', () => {
		// Sem isto, o sistema criaria quatro tarefas para um problema.
		const clusters = clusterQueries([
			{ question: 'como rotacionar a chave de api', count: 12 },
			{ question: 'como faço para rotacionar a chave de api', count: 7 },
		]);

		expect(clusters).toHaveLength(1);
		expect(clusters[0].count).toBe(19);
		expect(clusters[0].variants).toHaveLength(2);
	});

	it('a pergunta mais frequente nomeia o grupo', () => {
		const clusters = clusterQueries([
			{ question: 'como rotacionar a chave de api', count: 3 },
			{ question: 'como rotacionar a chave de api do portal', count: 30 },
		]);
		expect(clusters[0].representative).toBe('como rotacionar a chave de api do portal');
	});

	it('dúvidas diferentes não são fundidas', () => {
		// Agrupar demais produz uma página que responde metade de cada uma.
		const clusters = clusterQueries([
			{ question: 'como rotacionar a chave de api', count: 5 },
			{ question: 'como configurar o webhook de entrega', count: 5 },
		]);
		expect(clusters).toHaveLength(2);
	});

	it('os termos comuns admitem no grupo; os termos da união medem cobertura', () => {
		// A diferença entre os dois campos foi um erro real: a interseção de
		// "rotacionar a chave de api" com "trocar a chave de api" é `chave, api`,
		// que o portal documenta — e a cobertura saía 100% para rotação de chave.
		const clusters = clusterQueries([
			{ question: 'como rotacionar a chave de api', count: 10 },
			{ question: 'como trocar a chave de api', count: 8 },
		]);

		expect(clusters[0].tokens).not.toContain('rotacion');
		expect(clusters[0].terms).toContain('rotacion');
	});

	it('ignora palavras vazias e reduz ao radical', () => {
		expect(tokenize('Como faço para autenticar na API?')).toEqual(['autentic', 'api']);
		expect(stem('autenticacao')).toBe('autentic');
	});

	it('similaridade é 0 para conjuntos disjuntos e 1 para iguais', () => {
		expect(similarity(['a', 'b'], ['c', 'd'])).toBe(0);
		expect(similarity(['a', 'b'], ['a', 'b'])).toBe(1);
		expect(similarity([], ['a'])).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Cobertura (§14)
// ---------------------------------------------------------------------------

describe('cobertura do assunto', () => {
	it('sem página nenhuma, cobertura zero', () => {
		expect(estimateCoverage([])).toBe(0);
	});

	it('relevância alta sem os termos da pergunta não é cobertura', () => {
		// A busca sempre devolve algo. Se nenhum termo aparece, ela devolveu
		// resultado por construção, não porque o assunto está documentado.
		expect(estimateCoverage([page({ relevance: 1, termCoverage: 0 })])).toBe(0);
	});

	it('presença dos termos domina o cálculo', () => {
		const bom = estimateCoverage([page({ relevance: 0.4, termCoverage: 1 })]);
		const ruim = estimateCoverage([page({ relevance: 1, termCoverage: 0.34 })]);
		expect(bom).toBeGreaterThan(ruim);
	});

	it('conta os termos com prefixo, não com correspondência exata', () => {
		expect(termCoverageOf(['autentic'], 'A autenticação usa cabeçalho.')).toBe(1);
	});

	it('não conta um termo só porque a página tem uma palavra parecida mais curta', () => {
		// `rota` (de rota HTTP, que aparece em todo lugar neste portal) casava com
		// `rotacion` na regra frouxa, e "como rotacionar a chave" saía como assunto
		// totalmente coberto.
		expect(termCoverageOf(['rotacion'], 'A rota responde em /api/x.')).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Classificação (§5)
// ---------------------------------------------------------------------------

describe('tipo de lacuna', () => {
	const analysis = (pages: RetrievedPage[], extra: Partial<ClusterAnalysis> = {}): ClusterAnalysis => ({
		cluster: cluster('como rotacionar a chave de api'),
		pages,
		...extra,
	});

	it('nada relevante é falta de documentação', () => {
		expect(classifyGap(analysis([]))).toBe('missing');
		expect(classifyGap(analysis([page({ termCoverage: 0.1, relevance: 0.2 })]))).toBe('missing');
	});

	it('conteúdo que diverge do produto é desatualizado', () => {
		expect(classifyGap(analysis([page({ brokenContracts: 1 })]))).toBe('outdated');
		expect(classifyGap(analysis([page({ trust: 'invalid' })]))).toBe('outdated');
	});

	it('página muito completa e gente perguntando é problema de descoberta', () => {
		expect(classifyGap(analysis([page({ termCoverage: 1, relevance: 1 })]))).toBe('hard-to-find');
	});

	it('cobertura parcial é conteúdo incompleto', () => {
		expect(classifyGap(analysis([page({ termCoverage: 0.5, relevance: 0.6 })]))).toBe('incomplete');
	});

	it('contradição vence tudo', () => {
		expect(
			classifyGap(analysis([page()], { contradiction: { pages: ['a.md', 'b.md'], detail: 'discordam' } }))
		).toBe('contradictory');
	});

	it('grafias concorrentes viram problema de terminologia', () => {
		const result = classifyGap(
			analysis([page({ termCoverage: 0.6, relevance: 0.7 })], {
				terminology: { term: 'API key', variants: ['api token', 'chave de acesso'] },
			})
		);
		expect(result).toBe('unclear');
	});
});

describe('contradição entre páginas', () => {
	it('acha números discordando sobre o mesmo assunto', () => {
		const found = findContradictions(
			[
				{ path: 'a.md', content: 'O número de tentativas é 3 por padrão.' },
				{ path: 'b.md', content: 'tentativas: 5' },
			],
			['tentativ']
		);

		expect(found?.pages).toEqual(['a.md', 'b.md']);
		expect(found?.detail).toContain('3');
	});

	it('não acusa quando as duas páginas dizem o mesmo', () => {
		expect(
			findContradictions(
				[
					{ path: 'a.md', content: 'tentativas: 3' },
					{ path: 'b.md', content: 'tentativas: 3' },
				],
				['tentativ']
			)
		).toBeUndefined();
	});

	it('ignora números sobre assunto que não é o da pergunta', () => {
		expect(
			findContradictions(
				[
					{ path: 'a.md', content: 'porta: 3000' },
					{ path: 'b.md', content: 'porta: 8080' },
				],
				['tentativ']
			)
		).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Score e prioridade (§10, §11, §25)
// ---------------------------------------------------------------------------

describe('gap score', () => {
	it('demanda alta com cobertura baixa vira prioridade alta', () => {
		const score = scoreGap({ ...EMPTY_EVIDENCE, searches: 40, aiFailures: 12 }, 10, 'missing');
		expect(score.value).toBeGreaterThanOrEqual(70);
	});

	it('contrato quebrado pesa muito: documentação errada é pior que ausente', () => {
		const semContrato = scoreGap({ ...EMPTY_EVIDENCE, searches: 5 }, 60, 'incomplete');
		const comContrato = scoreGap({ ...EMPTY_EVIDENCE, searches: 5, brokenContracts: 1 }, 60, 'outdated');
		expect(comContrato.value).toBeGreaterThan(semContrato.value + 20);
	});

	it('cada fator declara os pontos e o motivo', () => {
		const score = scoreGap({ ...EMPTY_EVIDENCE, searches: 10 }, 50, 'incomplete');
		expect(score.factors.every((factor) => factor.detail.length > 0)).toBe(true);
		expect(score.value).toBe(score.factors.reduce((sum, factor) => sum + factor.points, 0));
	});

	it('nunca passa de 100', () => {
		const score = scoreGap(
			{ searches: 999, aiQuestions: 999, aiFailures: 999, mcpQueries: 999, negativeFeedback: 99, brokenContracts: 9 },
			0,
			'contradictory'
		);
		expect(score.value).toBe(100);
	});

	it('as faixas de prioridade seguem a spec', () => {
		expect(priorityFor(95)).toBe('P0');
		expect(priorityFor(75)).toBe('P1');
		expect(priorityFor(50)).toBe('P2');
		expect(priorityFor(10)).toBe('P3');
	});
});

// ---------------------------------------------------------------------------
// Recomendação (§18)
// ---------------------------------------------------------------------------

describe('recomendação', () => {
	const base: ClusterAnalysis = { cluster: cluster('como rotacionar a chave de api'), pages: [] };

	it('falta de documentação sobre endpoint manda documentar a API', () => {
		const recommendation = recommendFor({ ...base, productNodes: ['endpoint:POST /api/keys'] }, 'missing');
		expect(recommendation.action).toBe('add-api-reference');
	});

	it('falta de documentação sem endpoint manda criar página, com roteiro', () => {
		const recommendation = recommendFor(base, 'missing');
		expect(recommendation.action).toBe('create-page');
		expect(recommendation.target).toContain('src/content/docs/');
		expect(recommendation.outline.length).toBeGreaterThan(2);
	});

	it('difícil de achar vira problema de navegação, não de conteúdo', () => {
		const recommendation = recommendFor({ ...base, pages: [page()] }, 'hard-to-find');
		expect(recommendation.action).toBe('fix-navigation');
	});

	it('contradição aponta a página divergente', () => {
		const recommendation = recommendFor(
			{ ...base, contradiction: { pages: ['guides/a.md'], detail: 'discordam sobre tentativas' } },
			'contradictory'
		);
		expect(recommendation).toMatchObject({ action: 'update-page', target: 'guides/a.md' });
	});

	it('toda recomendação explica por quê', () => {
		for (const category of ['missing', 'incomplete', 'outdated', 'unclear', 'hard-to-find'] as const) {
			expect(recommendFor({ ...base, pages: [page()] }, category).reason.length).toBeGreaterThan(10);
		}
	});
});

// ---------------------------------------------------------------------------
// Montagem e ciclo de vida (§4, §21, §22)
// ---------------------------------------------------------------------------

describe('montagem dos gaps', () => {
	it('ordena por score e guarda as variações', () => {
		const gaps = analyzeGaps({
			analyses: [
				{ cluster: cluster('assunto raro', 1), pages: [page()] },
				{ cluster: cluster('assunto muito perguntado', 40), pages: [] },
			],
		});

		expect(gaps[0].query).toBe('assunto muito perguntado');
		expect(gaps[0].status).toBe('new');
	});

	it('todo gap nasce com recomendação e evidência', () => {
		const [gap] = analyzeGaps({ analyses: [{ cluster: cluster('algo', 5), pages: [] }] });
		expect(gap.recommendation.action).toBeTruthy();
		expect(gap.evidence.searches).toBe(5);
	});
});

describe('resolução', () => {
	it('publicar não resolve: a queda do sinal resolve', () => {
		// A exigência mais importante da spec. O gap só sai da fila quando menos
		// gente procura e menos resposta sai sem lastro.
		const check = checkResolution({ searches: 843, aiFailures: 87 }, { searches: 800, aiFailures: 80 });
		expect(check.resolved).toBe(false);
	});

	it('queda grande resolve', () => {
		const check = checkResolution({ searches: 843, aiFailures: 87 }, { searches: 74, aiFailures: 12 });
		expect(check.resolved).toBe(true);
		expect(check.reason).toContain('%');
	});

	it('não exige queda a zero: a pergunta continua sendo feita mesmo com resposta', () => {
		const check = checkResolution({ searches: 100, aiFailures: 30 }, { searches: 30, aiFailures: 9 });
		expect(check.resolved).toBe(true);
	});

	it('queda numa dimensão só não basta', () => {
		expect(checkResolution({ searches: 100, aiFailures: 30 }, { searches: 5, aiFailures: 28 }).resolved).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Privacidade (§27)
// ---------------------------------------------------------------------------

describe('normalização da pergunta', () => {
	it('agrupa variações de escrita', () => {
		expect(normalizeQuestion('Como  ROTACIONAR a Chave?')).toBe('como rotacionar a chave?');
	});

	it('dobra acento', () => {
		expect(normalizeQuestion('autenticação')).toBe('autenticacao');
	});

	it('remove credencial antes de gravar', () => {
		const normalized = normalizeQuestion('erro com sk-ant-api03-MaterialRealDeChave0123456789');
		expect(normalized).not.toContain('MaterialRealDeChave');
	});

	it('trunca pergunta longa', () => {
		expect(normalizeQuestion('a'.repeat(500)).length).toBeLessThanOrEqual(160);
	});
});
