/**
 * Testes da observabilidade de leitura (P3.2).
 *
 * O nome distingue de `observability.test.ts`, que cobre a saúde técnica: uma
 * camada mede se a documentação está correta, esta mede se ela resolve o
 * problema de quem chegou. São perguntas diferentes e não se somam.
 */

import { describe, expect, it } from 'vitest';
import {
	agentMetrics,
	analyzeObservability,
	behavioralGaps,
	confidenceFor,
	groupBySession,
	journeys,
	pageMetrics,
	searchMetrics,
	userSuccessScore,
} from '../src/lib/observe/analyze';
import { sanitizePath, sanitizeSession } from '../src/lib/observe/store';
import { DEFAULT_OBSERVABILITY, type ObservabilityConfig, type ObservedEvent } from '../src/lib/observe/types';

const MINUTE = 60_000;
const NOW = Date.parse('2026-08-18T12:00:00Z');

const config: ObservabilityConfig = { ...DEFAULT_OBSERVABILITY, minimumSessions: 2, windowDays: 30 };

// ---------------------------------------------------------------------------
// Sanitização
// ---------------------------------------------------------------------------

describe('sanitizeSession', () => {
	it('aceita hexadecimal do tamanho esperado', () => {
		expect(sanitizeSession('aaaa1111bbbb2222')).toBe('aaaa1111bbbb2222');
	});

	it('recusa qualquer outra coisa em vez de aparar', () => {
		expect(sanitizeSession('../../etc/passwd')).toBeNull();
		expect(sanitizeSession('a'.repeat(64))).toBeNull();
		expect(sanitizeSession(42)).toBeNull();
		expect(sanitizeSession(undefined)).toBeNull();
	});
});

describe('sanitizePath', () => {
	it('normaliza barra invertida e barra inicial', () => {
		expect(sanitizePath('/guides\\intro.md')).toBe('guides/intro.md');
	});

	it('recusa travessia de diretório', () => {
		expect(sanitizePath('../../../data/users.json')).toBeUndefined();
		expect(sanitizePath('guides/../../data/users.json')).toBeUndefined();
	});

	it('recusa vazio e caminho absurdamente longo', () => {
		expect(sanitizePath('  ')).toBeUndefined();
		expect(sanitizePath('a'.repeat(300))).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Agrupamento
// ---------------------------------------------------------------------------

describe('groupBySession', () => {
	it('ordena os eventos de cada sessão no tempo', () => {
		const grouped = groupBySession([
			{ type: 'page-view', session: 's1', at: 200, path: 'b.md' },
			{ type: 'page-view', session: 's1', at: 100, path: 'a.md' },
			{ type: 'page-view', session: 's2', at: 150, path: 'c.md' },
		]);

		expect(grouped.get('s1')?.map((entry) => entry.path)).toEqual(['a.md', 'b.md']);
		expect(grouped.size).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// Páginas
// ---------------------------------------------------------------------------

describe('pageMetrics', () => {
	const events: ObservedEvent[] = [
		{ type: 'page-view', session: 's1', at: 1, path: 'a.md' },
		{ type: 'page-view', session: 's2', at: 2, path: 'a.md' },
		{ type: 'page-exit', session: 's1', at: 3, path: 'a.md', dwellSeconds: 30 },
		{ type: 'page-exit', session: 's2', at: 4, path: 'a.md', dwellSeconds: 90 },
		{ type: 'page-view', session: 's3', at: 5, path: 'b.md' },
	];

	it('conta visitas e sessões distintas separadamente', () => {
		const metrics = pageMetrics([...events, { type: 'page-view', session: 's1', at: 6, path: 'a.md' }], 2);

		const page = metrics.find((entry) => entry.path === 'a.md')!;
		expect(page.views).toBe(3);
		expect(page.readers).toBe(2);
	});

	it('esconde a página que não atinge o limiar de agregação', () => {
		// Com uma sessão só, a linha poderia identificar uma pessoa para quem
		// conhece a equipe — e a agregação deixaria de agregar.
		expect(pageMetrics(events, 2).map((entry) => entry.path)).toEqual(['a.md']);
	});

	it('mediana de permanência vem das saídas registradas', () => {
		expect(pageMetrics(events, 2)[0].medianDwellSeconds).toBe(60);
	});

	it('página sem saída registrada tem mediana null, não zero', () => {
		const metrics = pageMetrics(
			[
				{ type: 'page-view', session: 's1', at: 1, path: 'c.md' },
				{ type: 'page-view', session: 's2', at: 2, path: 'c.md' },
			],
			2
		);

		expect(metrics[0].medianDwellSeconds).toBeNull();
	});

	it('conta como saída a última página da visita', () => {
		expect(pageMetrics(events, 2)[0].exits).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// Busca
// ---------------------------------------------------------------------------

describe('searchMetrics', () => {
	it('busca seguida de clique conta como clique', () => {
		const metrics = searchMetrics([
			{ type: 'search', session: 's1', at: 1, results: 5 },
			{ type: 'search-click', session: 's1', at: 2, path: 'a.md' },
		]);

		expect(metrics.clicked).toBe(1);
		expect(metrics.clickThroughRate).toBe(100);
	});

	it('busca seguida de outra busca conta como refinamento', () => {
		const metrics = searchMetrics([
			{ type: 'search', session: 's1', at: 1, results: 5 },
			{ type: 'search', session: 's1', at: 2, results: 3 },
		]);

		expect(metrics.refined).toBe(1);
		expect(metrics.abandoned).toBe(1);
	});

	it('clique depois da busca seguinte pertence àquela busca, não a esta', () => {
		const metrics = searchMetrics([
			{ type: 'search', session: 's1', at: 1, results: 5 },
			{ type: 'search', session: 's1', at: 2, results: 3 },
			{ type: 'search-click', session: 's1', at: 3, path: 'a.md' },
		]);

		expect(metrics.refined).toBe(1);
		expect(metrics.clicked).toBe(1);
	});

	it('busca sem resultado sai do denominador de clique', () => {
		const metrics = searchMetrics([
			{ type: 'search', session: 's1', at: 1, results: 0 },
			{ type: 'search', session: 's2', at: 2, results: 4 },
			{ type: 'search-click', session: 's2', at: 3, path: 'a.md' },
		]);

		expect(metrics.zeroResult).toBe(1);
		expect(metrics.clickThroughRate).toBe(100);
		expect(metrics.zeroResultRate).toBe(50);
	});

	it('portal sem buscas não tem 0% de sucesso — não tem busca', () => {
		const metrics = searchMetrics([]);
		expect(metrics.clickThroughRate).toBeNull();
		expect(metrics.zeroResultRate).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Jornadas
// ---------------------------------------------------------------------------

describe('journeys', () => {
	function visit(session: string, ...paths: string[]): ObservedEvent[] {
		return paths.map((path, index) => ({ type: 'page-view' as const, session, at: index + 1, path }));
	}

	it('agrupa sessões que percorreram o mesmo caminho', () => {
		const result = journeys([...visit('s1', 'a.md', 'b.md'), ...visit('s2', 'a.md', 'b.md')], 2);

		expect(result).toHaveLength(1);
		expect(result[0].sessions).toBe(2);
		expect(result[0].steps).toEqual(['a.md', 'b.md']);
	});

	it('recarregar a mesma página não vira um passo', () => {
		const result = journeys([...visit('s1', 'a.md', 'a.md', 'b.md'), ...visit('s2', 'a.md', 'b.md')], 2);
		expect(result[0].steps).toEqual(['a.md', 'b.md']);
	});

	it('visita de uma página só não é jornada', () => {
		expect(journeys([...visit('s1', 'a.md'), ...visit('s2', 'a.md')], 2)).toEqual([]);
	});

	it('abandono é a ausência de sinal de conclusão, não uma inferência', () => {
		const withClick = [
			...visit('s1', 'a.md', 'b.md'),
			{ type: 'search-click' as const, session: 's1', at: 9, path: 'b.md' },
			...visit('s2', 'a.md', 'b.md'),
		];

		expect(journeys(withClick, 2)[0].abandonmentRate).toBe(50);
	});

	it('caminho abaixo do limiar não aparece', () => {
		expect(journeys(visit('s1', 'a.md', 'b.md'), 2)).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Confiança e lacunas
// ---------------------------------------------------------------------------

describe('confidenceFor', () => {
	it('cresce com a repetição', () => {
		expect(confidenceFor(3, 2)).toBeLessThan(confidenceFor(12, 2));
	});

	it('satura abaixo de 1 — comportamento nunca é prova', () => {
		expect(confidenceFor(10_000, 2)).toBeLessThanOrEqual(0.9);
	});

	it('abaixo do limiar não há confiança nenhuma', () => {
		expect(confidenceFor(1, 2)).toBe(0);
	});
});

describe('behavioralGaps', () => {
	it('busca sem resultado com texto vira lacuna com o termo', () => {
		const events: ObservedEvent[] = [
			{ type: 'search', session: 's1', at: 1, results: 0, query: 'rotacionar chave' },
			{ type: 'search', session: 's2', at: 2, results: 0, query: 'rotacionar chave' },
		];

		const gaps = behavioralGaps(events, [], config);
		expect(gaps[0].topic).toBe('rotacionar chave');
		expect(gaps[0].signal).toBe('zero-result');
	});

	it('sem o texto guardado a lacuna existe e não tem nome', () => {
		// Omiti-la esconderia o problema mais grave que a camada consegue ver.
		const events: ObservedEvent[] = [
			{ type: 'search', session: 's1', at: 1, results: 0 },
			{ type: 'search', session: 's2', at: 2, results: 0 },
		];

		const gaps = behavioralGaps(events, [], config);
		expect(gaps).toHaveLength(1);
		expect(gaps[0].evidence.join(' ')).toContain('storeUnansweredQuestions');
	});

	it('voto negativo só vira lacuna quando supera o positivo', () => {
		const pages = [{ path: 'a.md', views: 10, readers: 10, medianDwellSeconds: null, exits: 0, up: 5, down: 2 }];
		expect(behavioralGaps([], pages, config)).toEqual([]);
	});

	it('saída em massa vem com a ressalva de que não distingue causa', () => {
		const pages = [{ path: 'a.md', views: 10, readers: 10, medianDwellSeconds: null, exits: 9, up: 0, down: 0 }];
		const gaps = behavioralGaps([], pages, config);

		expect(gaps[0].signal).toBe('high-exit');
		expect(gaps[0].evidence.join(' ')).toMatch(/não distingue/);
	});
});

// ---------------------------------------------------------------------------
// Relatório
// ---------------------------------------------------------------------------

describe('analyzeObservability', () => {
	it('declara as limitações em vez de mostrar número pequeno como realidade', () => {
		const report = analyzeObservability({ events: [], config, now: NOW });

		expect(report.limited).toBe(true);
		expect(report.limitations.join(' ')).toContain('Volume baixo');
	});

	it('ignora eventos fora da janela', () => {
		const old: ObservedEvent = { type: 'page-view', session: 's1', at: NOW - 40 * 86_400_000, path: 'a.md' };
		expect(analyzeObservability({ events: [old], config, now: NOW }).sessions).toBe(0);
	});

	it('avisa quando eventos já foram descartados por volume', () => {
		const report = analyzeObservability({ events: [], config, truncated: true, now: NOW });
		expect(report.limitations.join(' ')).toContain('descartados');
	});
});

describe('userSuccessScore', () => {
	it('sem volume devolve null, não zero', () => {
		// Um portal recém instrumentado teria "sucesso 0" e derrubaria a nota de
		// saúde por ausência de dado, que é o oposto do que a nota deveria dizer.
		const report = analyzeObservability({ events: [], config, now: NOW });
		expect(userSuccessScore(report)).toBeNull();
	});

	it('combina clique e ausência de busca vazia', () => {
		const events: ObservedEvent[] = [];
		for (let index = 0; index < 12; index++) {
			const session = `s${index}`;
			events.push({ type: 'search', session, at: NOW - (20 - index) * MINUTE, results: 4 });
			events.push({ type: 'search-click', session, at: NOW - (20 - index) * MINUTE + 1, path: 'a.md' });
		}

		const report = analyzeObservability({ events, config, now: NOW });
		expect(userSuccessScore(report)).toBe(100);
	});
});

// ---------------------------------------------------------------------------
// Leitura por agentes
// ---------------------------------------------------------------------------

describe('leitura por agentes', () => {
	const read = (
		surface: 'llms-index' | 'llms-full' | 'markdown',
		path?: string,
		at = 1_000
	): ObservedEvent => ({ type: 'agent-read', surface, path, at });

	const view = (session: string, path: string, at = 1_000): ObservedEvent => ({
		type: 'page-view',
		session,
		path,
		at,
	});

	it('conta por superfície', () => {
		const metrics = agentMetrics([read('llms-index'), read('llms-index'), read('markdown', 'guides/x.md')]);

		expect(metrics.reads).toBe(3);
		expect(metrics.bySurface).toEqual([
			{ surface: 'llms-index', label: 'llms.txt', reads: 2 },
			{ surface: 'markdown', label: 'Markdown bruto', reads: 1 },
		]);
	});

	it('lista as páginas mais buscadas em Markdown bruto', () => {
		const metrics = agentMetrics([
			read('markdown', 'guides/a.md'),
			read('markdown', 'guides/a.md'),
			read('markdown', 'guides/b.md'),
			read('llms-index'),
		]);

		expect(metrics.topPaths).toEqual([
			{ path: 'guides/a.md', reads: 2 },
			{ path: 'guides/b.md', reads: 1 },
		]);
	});

	it('calcula a fatia contra a leitura por pessoas', () => {
		expect(agentMetrics([read('llms-index'), view('aaaa1111', 'guides/x.md')]).share).toBe(0.5);
	});

	it('devolve null quando não houve leitura nenhuma dos dois lados', () => {
		// Denominador zero nunca vira 0%: um portal sem leitura não tem "0% de
		// leitura por agente" — ele não tem leitura.
		expect(agentMetrics([]).share).toBeNull();
	});

	it('evento de agente não conta como sessão nem como leitor', () => {
		// É a razão de `session` ser opcional. Uma requisição de agente não tem
		// sessão, e inventar uma por requisição inflaria a contagem de leitores
		// com um número que não corresponde a ninguém.
		const events = [read('llms-index'), read('markdown', 'guides/x.md'), view('aaaa1111', 'guides/x.md')];

		expect(groupBySession(events).size).toBe(1);

		const page = pageMetrics(events, 1).find((entry) => entry.path === 'guides/x.md');
		expect(page?.readers).toBe(1);
		// Ler o Markdown bruto não vira visualização de página.
		expect(page?.views).toBe(1);
	});

	it('entra no relatório sem mexer nas métricas de pessoas', () => {
		const report = analyzeObservability({
			events: [read('llms-full'), view('aaaa1111', 'guides/x.md')],
			config: { ...config, minimumSessions: 1 },
			now: 2_000,
		});

		expect(report.agents.reads).toBe(1);
		expect(report.sessions).toBe(1);
	});
});
