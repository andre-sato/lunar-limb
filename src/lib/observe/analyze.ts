/**
 * Análise dos eventos observados (P3.2).
 *
 * Puro: recebe eventos e configuração, devolve o relatório. Quem lê disco é
 * `service.ts`.
 *
 * O limite que organiza o arquivo inteiro: **o portal enxerga cliques, não
 * satisfação.** Um leitor que busca, clica e some pode ter resolvido o problema
 * na primeira linha da página ou ter desistido do produto. Nenhuma métrica aqui
 * afirma qual dos dois — os nomes carregam o que a instrumentação realmente vê
 * (`clickThroughRate`, não `successRate`), e cada inferência vem com o que a
 * sustenta.
 */

import { AGENT_SURFACE_LABEL } from './types';
import type {
	AgentMetrics,
	AgentSurface,
	BehavioralGap,
	Journey,
	ObservabilityConfig,
	ObservabilityReport,
	ObservedEvent,
	PageMetrics,
	SearchMetrics,
} from './types';

const DAY = 86_400_000;

function median(values: readonly number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1] + sorted[middle]) / 2) : sorted[middle];
}

function rate(part: number, whole: number): number | null {
	// Denominador zero devolve `null`, nunca 0%. Um portal sem buscas não tem 0%
	// de sucesso — não tem busca, e são coisas diferentes.
	return whole === 0 ? null : Math.round((part / whole) * 100);
}

/**
 * Os eventos de cada sessão, em ordem cronológica.
 *
 * Evento sem sessão fica de fora — é o caso de `agent-read`, que vem do servidor
 * e não de um navegador. Ele tem a sua própria conta em `agentMetrics`.
 */
export function groupBySession(events: readonly ObservedEvent[]): Map<string, ObservedEvent[]> {
	const sessions = new Map<string, ObservedEvent[]>();

	for (const event of events) {
		if (!event.session) continue;
		const list = sessions.get(event.session) ?? [];
		list.push(event);
		sessions.set(event.session, list);
	}

	for (const list of sessions.values()) list.sort((a, b) => a.at - b.at);
	return sessions;
}

// ---------------------------------------------------------------------------
// Páginas
// ---------------------------------------------------------------------------

export function pageMetrics(events: readonly ObservedEvent[], minimumSessions: number): PageMetrics[] {
	const byPath = new Map<string, { views: number; readers: Set<string>; dwell: number[]; exits: number; up: number; down: number }>();

	const entryFor = (path: string) => {
		const existing = byPath.get(path);
		if (existing) return existing;
		const created = { views: 0, readers: new Set<string>(), dwell: [] as number[], exits: 0, up: 0, down: 0 };
		byPath.set(path, created);
		return created;
	};

	for (const event of events) {
		if (!event.path) continue;
		const entry = entryFor(event.path);

		if (event.type === 'page-view') {
			entry.views++;
			if (event.session) entry.readers.add(event.session);
		} else if (event.type === 'page-exit' && typeof event.dwellSeconds === 'number') {
			entry.dwell.push(event.dwellSeconds);
		} else if (event.type === 'feedback') {
			if (event.vote === 'up') entry.up++;
			else if (event.vote === 'down') entry.down++;
		}
	}

	// Sessões que abriram uma página e nada mais: a página foi o fim da visita.
	for (const [, list] of groupBySession(events)) {
		const views = list.filter((event) => event.type === 'page-view' && event.path);
		const last = views.at(-1);
		if (!last?.path) continue;

		const afterwards = list.filter((event) => event.at > last.at && event.type !== 'page-exit');
		if (afterwards.length === 0) entryFor(last.path).exits++;
	}

	return [...byPath.entries()]
		// Abaixo do limiar de agregação a linha não aparece: com uma sessão só,
		// "quem leu esta página" pode ser uma pessoa identificável para quem
		// conhece a equipe, e a agregação deixaria de agregar.
		.filter(([, entry]) => entry.readers.size >= minimumSessions)
		.map(([path, entry]) => ({
			path,
			views: entry.views,
			readers: entry.readers.size,
			medianDwellSeconds: median(entry.dwell),
			exits: entry.exits,
			up: entry.up,
			down: entry.down,
		}))
		.sort((a, b) => b.views - a.views);
}

// ---------------------------------------------------------------------------
// Busca
// ---------------------------------------------------------------------------

export function searchMetrics(events: readonly ObservedEvent[]): SearchMetrics {
	let searches = 0;
	let zeroResult = 0;
	let clicked = 0;
	let refined = 0;
	let abandoned = 0;

	for (const [, list] of groupBySession(events)) {
		const searchEvents = list.filter((event) => event.type === 'search');

		searchEvents.forEach((search, index) => {
			searches++;
			if ((search.results ?? 0) === 0) {
				zeroResult++;
				return;
			}

			const next = searchEvents[index + 1];
			// A janela de atribuição termina na busca seguinte: um clique depois de
			// outra busca pertence àquela busca, não a esta.
			const boundary = next?.at ?? Number.POSITIVE_INFINITY;
			const followedByClick = list.some(
				(event) => event.type === 'search-click' && event.at >= search.at && event.at < boundary
			);

			if (followedByClick) clicked++;
			else if (next) refined++;
			else abandoned++;
		});
	}

	const withResults = searches - zeroResult;

	return {
		searches,
		zeroResult,
		clicked,
		refined,
		abandoned,
		clickThroughRate: rate(clicked, withResults),
		zeroResultRate: rate(zeroResult, searches),
		refinementRate: rate(refined, withResults),
		abandonmentRate: rate(abandoned, withResults),
	};
}

// ---------------------------------------------------------------------------
// Jornadas
// ---------------------------------------------------------------------------

export function journeys(events: readonly ObservedEvent[], minimumSessions: number, maxSteps = 4): Journey[] {
	const counts = new Map<string, { sessions: number; abandoned: number }>();

	for (const [, list] of groupBySession(events)) {
		const steps = list
			.filter((event) => event.type === 'page-view' && event.path)
			.map((event) => event.path!)
			// Recarregar a mesma página não é um passo da jornada.
			.filter((path, index, all) => path !== all[index - 1])
			.slice(0, maxSteps);

		if (steps.length < 2) continue;

		const key = steps.join(' → ');
		const entry = counts.get(key) ?? { sessions: 0, abandoned: 0 };
		entry.sessions++;

		// Abandono aqui é o que dá para ver: a sessão terminou sem clique de busca
		// e sem voto positivo. Não é "o leitor foi embora frustrado" — é a ausência
		// dos únicos sinais de conclusão que a instrumentação registra.
		const concluded = list.some((event) => event.type === 'search-click' || (event.type === 'feedback' && event.vote === 'up'));
		if (!concluded) entry.abandoned++;

		counts.set(key, entry);
	}

	return [...counts.entries()]
		.filter(([, entry]) => entry.sessions >= minimumSessions)
		.map(([key, entry]) => ({
			steps: key.split(' → '),
			sessions: entry.sessions,
			abandonmentRate: Math.round((entry.abandoned / entry.sessions) * 100),
		}))
		.sort((a, b) => b.sessions - a.sessions);
}

// ---------------------------------------------------------------------------
// Lacunas comportamentais
// ---------------------------------------------------------------------------

/**
 * A confiança de uma hipótese comportamental.
 *
 * Cresce com a repetição e satura: dez ocorrências não valem dez vezes uma. E
 * nunca chega a 1 — comportamento é evidência de atrito, não prova de causa.
 */
export function confidenceFor(occurrences: number, minimumSessions: number): number {
	if (occurrences < minimumSessions) return 0;
	return Math.min(0.9, Math.round((1 - Math.exp(-occurrences / 8)) * 100) / 100);
}

export function behavioralGaps(
	events: readonly ObservedEvent[],
	pages: readonly PageMetrics[],
	config: ObservabilityConfig
): BehavioralGap[] {
	const gaps: BehavioralGap[] = [];

	// --- busca sem resultado ------------------------------------------------
	const zeroByQuery = new Map<string, number>();
	let zeroWithoutText = 0;

	for (const event of events) {
		if (event.type !== 'search' || (event.results ?? 0) > 0) continue;
		if (event.query) zeroByQuery.set(event.query, (zeroByQuery.get(event.query) ?? 0) + 1);
		else zeroWithoutText++;
	}

	for (const [query, occurrences] of zeroByQuery) {
		if (occurrences < config.minimumSessions) continue;
		gaps.push({
			topic: query,
			signal: 'zero-result',
			occurrences,
			confidence: confidenceFor(occurrences, config.minimumSessions),
			evidence: [`${occurrences} busca(s) sem nenhum resultado`],
		});
	}

	// Sem o texto guardado a lacuna ainda existe — ela só não tem nome. Omiti-la
	// esconderia o problema mais grave que a camada consegue ver.
	if (zeroWithoutText >= config.minimumSessions) {
		gaps.push({
			topic: 'buscas sem resultado (texto não guardado)',
			signal: 'zero-result',
			occurrences: zeroWithoutText,
			confidence: confidenceFor(zeroWithoutText, config.minimumSessions),
			evidence: [
				`${zeroWithoutText} busca(s) sem resultado`,
				'o texto das consultas está desligado; ligue `storeUnansweredQuestions` para saber o quê',
			],
		});
	}

	// --- páginas de saída ---------------------------------------------------
	for (const page of pages) {
		if (page.views < config.minimumSessions * 2) continue;
		const exitRate = page.exits / page.views;
		if (exitRate < 0.7) continue;

		gaps.push({
			topic: page.path,
			signal: 'high-exit',
			occurrences: page.exits,
			confidence: confidenceFor(page.exits, config.minimumSessions),
			evidence: [
				`${Math.round(exitRate * 100)}% das visitas terminaram nesta página`,
				'pode ser resposta encontrada ou desistência — a instrumentação não distingue',
			],
		});
	}

	// --- voto negativo ------------------------------------------------------
	for (const page of pages) {
		if (page.down < config.minimumSessions || page.down <= page.up) continue;

		gaps.push({
			topic: page.path,
			signal: 'negative-feedback',
			occurrences: page.down,
			confidence: confidenceFor(page.down, config.minimumSessions),
			evidence: [`${page.down} voto(s) negativo(s) contra ${page.up} positivo(s)`],
		});
	}

	return gaps.sort((a, b) => b.confidence - a.confidence || b.occurrences - a.occurrences);
}

// ---------------------------------------------------------------------------
// Relatório
// ---------------------------------------------------------------------------

export interface AnalyzeInput {
	events: readonly ObservedEvent[];
	config: ObservabilityConfig;
	/** `true` quando o armazenamento já descartou eventos por volume. */
	truncated?: boolean;
	now?: number;
}

/**
 * Leitura por agentes, a partir dos eventos gravados pelas próprias rotas.
 *
 * Contar aqui é o que substitui a detecção por referrer que a integração
 * externa fazia: aquela via uma pessoa clicando num link dentro do ChatGPT, e
 * não via o agente buscando `llms.txt` — que é como agentes realmente leem.
 */
export function agentMetrics(events: readonly ObservedEvent[]): AgentMetrics {
	const reads = events.filter((event) => event.type === 'agent-read');
	const bySurfaceCount = new Map<AgentSurface, number>();
	const byPath = new Map<string, number>();

	for (const event of reads) {
		if (event.surface) bySurfaceCount.set(event.surface, (bySurfaceCount.get(event.surface) ?? 0) + 1);
		if (event.path) byPath.set(event.path, (byPath.get(event.path) ?? 0) + 1);
	}

	const humanViews = events.filter((event) => event.type === 'page-view').length;
	const total = reads.length + humanViews;

	return {
		reads: reads.length,
		bySurface: [...bySurfaceCount.entries()]
			.map(([surface, count]) => ({ surface, label: AGENT_SURFACE_LABEL[surface], reads: count }))
			.sort((a, b) => b.reads - a.reads),
		topPaths: [...byPath.entries()]
			.map(([path, count]) => ({ path, reads: count }))
			.sort((a, b) => b.reads - a.reads || a.path.localeCompare(b.path, 'pt-BR'))
			.slice(0, 10),
		// Sem leitura nenhuma dos dois lados não há fração a informar — `null`,
		// nunca 0%, pela mesma razão do resto da camada.
		share: total === 0 ? null : reads.length / total,
	};
}

export function analyzeObservability(input: AnalyzeInput): ObservabilityReport {
	const now = input.now ?? Date.now();
	const cutoff = now - input.config.windowDays * DAY;
	const events = input.events.filter((event) => event.at >= cutoff);

	const pages = pageMetrics(events, input.config.minimumSessions);
	const search = searchMetrics(events);
	const agents = agentMetrics(events);
	// Sessão de gente, só: `agent-read` não tem sessão e não é leitor.
	const sessions = new Set(events.map((event) => event.session).filter(Boolean)).size;

	const limitations: string[] = [];
	if (!input.config.enabled) limitations.push('A coleta está desligada; o relatório mostra apenas o que já havia sido gravado.');
	if (!input.config.storeQueryText) limitations.push('O texto das buscas não é guardado: as lacunas aparecem sem o termo.');
	if (input.truncated) limitations.push('Eventos antigos já foram descartados por limite de volume.');
	if (sessions < input.config.minimumSessions * 3) {
		limitations.push(`Volume baixo (${sessions} sessões): as taxas oscilam muito e não sustentam conclusão.`);
	}

	return {
		pages,
		search,
		agents,
		journeys: journeys(events, input.config.minimumSessions),
		gaps: behavioralGaps(events, pages, input.config),
		sessions,
		windowDays: input.config.windowDays,
		limited: limitations.length > 0,
		limitations,
		generatedAt: now,
	};
}

/**
 * Sucesso do leitor, para compor com a saúde técnica (§ Health integration).
 *
 * Devolve `null` quando não há volume — e isso é importante: um portal recém
 * instrumentado teria "sucesso do usuário 0" e derrubaria a nota de saúde por
 * ausência de dado, que é o oposto do que a nota deveria dizer.
 */
export function userSuccessScore(report: ObservabilityReport): number | null {
	if (report.search.searches < 10) return null;

	const clickThrough = report.search.clickThroughRate ?? 0;
	const zeroResult = report.search.zeroResultRate ?? 0;

	return Math.max(0, Math.min(100, Math.round(clickThrough * 0.7 + (100 - zeroResult) * 0.3)));
}
