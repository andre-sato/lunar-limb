/**
 * Leitura e agregação dos eventos do Do11y.
 *
 * A agregação é uma função pura sobre as linhas — dá para testá-la sem
 * Supabase, sem rede e sem mock de HTTP, que é o que torna essas contas
 * verificáveis.
 *
 * O payload do Do11y segue convenções do OpenTelemetry, com chaves **planas e
 * pontuadas** (`url.path`, `browser.do11y.ai_platform`). Não são objetos
 * aninhados: `payload['url.path']`, e não `payload.url.path`.
 */

export const PAYLOAD_KEYS = {
	eventName: 'eventName',
	path: 'url.path',
	sessionId: 'session.id',
	pageTitle: 'browser.do11y.page_title',
	referrerCategory: 'browser.do11y.referrer_category',
	aiPlatform: 'browser.do11y.ai_platform',
	deviceType: 'device.type',
	browserFamily: 'browser.family',
} as const;

/** Prefixo de todos os eventos do Do11y (`browser.do11y.page_view`). */
const EVENT_PREFIX = 'browser.do11y.';

export interface Do11yRow {
	created_at: string;
	payload: Record<string, unknown>;
}

export interface Counted {
	label: string;
	count: number;
}

export interface PageStat {
	path: string;
	title: string;
	views: number;
}

export interface Do11yMetrics {
	totalEvents: number;
	pageViews: number;
	sessions: number;
	/** Eventos por dia (ISO date), em ordem cronológica. */
	timeline: Array<{ date: string; count: number }>;
	topPages: PageStat[];
	eventTypes: Counted[];
	trafficSources: Counted[];
	aiPlatforms: Counted[];
	devices: Counted[];
	/** Fração das sessões vinda de plataformas de IA, entre 0 e 1. */
	aiShare: number;
	aiSessions: number;
	/** `true` quando o limite de linhas foi atingido e os números são parciais. */
	truncated: boolean;
}

function str(value: unknown): string | null {
	return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function tally(map: Map<string, number>, key: string | null, fallback = 'desconhecido'): void {
	const label = key ?? fallback;
	map.set(label, (map.get(label) ?? 0) + 1);
}

function toSorted(map: Map<string, number>, limit?: number): Counted[] {
	const entries = [...map.entries()]
		.map(([label, count]) => ({ label, count }))
		.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'pt-BR'));
	return limit ? entries.slice(0, limit) : entries;
}

/** Nome curto do evento: `browser.do11y.page_view` → `page_view`. */
export function shortEventName(eventName: string): string {
	return eventName.startsWith(EVENT_PREFIX) ? eventName.slice(EVENT_PREFIX.length) : eventName;
}

interface SessionMeta {
	category: string | null;
	device: string | null;
	aiPlatform: string | null;
}

export function aggregate(rows: readonly Do11yRow[], truncated = false): Do11yMetrics {
	/**
	 * Origem, dispositivo e plataforma de IA são atributos **da sessão**, não
	 * do evento. Contá-los por evento faria uma sessão com 40 eventos pesar 40
	 * vezes na distribuição — e sessões vindas de IA, que costumam ler mais
	 * páginas, apareceriam infladas justamente na métrica que interessa.
	 *
	 * As linhas chegam da consulta em ordem decrescente de data, então a última
	 * escrita por sessão corresponde ao evento mais antigo dela: a origem de
	 * entrada, que é a que importa.
	 */
	const sessionMeta = new Map<string, SessionMeta>();
	const pages = new Map<string, { title: string; views: number }>();
	const eventTypes = new Map<string, number>();
	const days = new Map<string, number>();

	let pageViews = 0;

	for (const row of rows) {
		const payload = row.payload ?? {};

		const eventName = str(payload[PAYLOAD_KEYS.eventName]);
		const sessionId = str(payload[PAYLOAD_KEYS.sessionId]);

		if (eventName) tally(eventTypes, shortEventName(eventName));

		if (sessionId) {
			const category = str(payload[PAYLOAD_KEYS.referrerCategory]);
			const device = str(payload[PAYLOAD_KEYS.deviceType]);
			const aiPlatform = str(payload[PAYLOAD_KEYS.aiPlatform]);
			const previous = sessionMeta.get(sessionId);
			sessionMeta.set(sessionId, {
				// Um evento posterior pode não repetir o atributo; preserva-se o
				// que já se sabe da sessão em vez de sobrescrever com null.
				category: category ?? previous?.category ?? null,
				device: device ?? previous?.device ?? null,
				aiPlatform: aiPlatform ?? previous?.aiPlatform ?? null,
			});
		}

		const day = row.created_at.slice(0, 10);
		if (day) days.set(day, (days.get(day) ?? 0) + 1);

		if (eventName && shortEventName(eventName) === 'page_view') {
			pageViews++;
			const path = str(payload[PAYLOAD_KEYS.path]) ?? '(sem caminho)';
			const title = str(payload[PAYLOAD_KEYS.pageTitle]) ?? path;
			const entry = pages.get(path);
			if (entry) entry.views++;
			else pages.set(path, { title, views: 1 });
		}
	}

	const sources = new Map<string, number>();
	const devices = new Map<string, number>();
	const aiPlatforms = new Map<string, number>();
	const aiSessionIds = new Set<string>();

	for (const [sessionId, meta] of sessionMeta) {
		tally(sources, meta.category);
		tally(devices, meta.device);
		if (meta.category === 'ai') {
			aiSessionIds.add(sessionId);
			tally(aiPlatforms, meta.aiPlatform, 'outra');
		}
	}

	const sessions = sessionMeta;

	const timeline = [...days.entries()]
		.map(([date, count]) => ({ date, count }))
		.sort((a, b) => a.date.localeCompare(b.date));

	const topPages = [...pages.entries()]
		.map(([path, value]) => ({ path, title: value.title, views: value.views }))
		.sort((a, b) => b.views - a.views || a.path.localeCompare(b.path, 'pt-BR'))
		.slice(0, 15);

	return {
		totalEvents: rows.length,
		pageViews,
		sessions: sessions.size,
		timeline,
		topPages,
		eventTypes: toSorted(eventTypes),
		trafficSources: toSorted(sources),
		aiPlatforms: toSorted(aiPlatforms),
		devices: toSorted(devices),
		aiSessions: aiSessionIds.size,
		aiShare: sessions.size > 0 ? aiSessionIds.size / sessions.size : 0,
		truncated,
	};
}

// ---------------------------------------------------------------------------
// Acesso ao Supabase
// ---------------------------------------------------------------------------

/**
 * Teto de linhas por consulta.
 *
 * A agregação acontece em memória, então precisa de um limite. Ao atingi-lo os
 * números viram uma amostra do período mais recente, e a interface diz isso em
 * vez de apresentar um total incorreto como se fosse completo.
 */
export const MAX_ROWS = 20000;

export interface FetchOptions {
	supabaseUrl: string;
	serviceRoleKey: string;
	table: string;
	since: Date;
	limit?: number;
	signal?: AbortSignal;
}

export class Do11yQueryError extends Error {
	constructor(
		message: string,
		readonly status?: number
	) {
		super(message);
		this.name = 'Do11yQueryError';
	}
}

function restUrl(options: FetchOptions): string {
	const base = options.supabaseUrl.replace(/\/+$/, '');
	const params = new URLSearchParams({
		select: 'created_at,payload',
		created_at: `gte.${options.since.toISOString()}`,
		order: 'created_at.desc',
		limit: String(options.limit ?? MAX_ROWS),
	});
	return `${base}/rest/v1/${encodeURIComponent(options.table)}?${params}`;
}

/**
 * Busca as linhas do período via PostgREST.
 *
 * Usa a API REST em vez do SDK do Supabase de propósito: a integração inteira
 * são duas chamadas HTTP, e uma dependência nova para isso não se paga.
 */
export async function fetchRows(options: FetchOptions): Promise<Do11yRow[]> {
	let response: Response;
	try {
		response = await fetch(restUrl(options), {
			headers: {
				apikey: options.serviceRoleKey,
				Authorization: `Bearer ${options.serviceRoleKey}`,
				Accept: 'application/json',
			},
			signal: options.signal,
		});
	} catch (error) {
		throw new Do11yQueryError(`Não foi possível conectar ao Supabase: ${(error as Error).message}`);
	}

	if (!response.ok) {
		const body = await response.text().catch(() => '');
		// A mensagem do PostgREST ajuda muito no diagnóstico ("relation does not
		// exist", "invalid API key"), mas é truncada para não despejar um corpo
		// enorme na interface.
		throw new Do11yQueryError(
			`Supabase respondeu ${response.status}. ${body.slice(0, 300)}`.trim(),
			response.status
		);
	}

	const data = await response.json().catch(() => null);
	if (!Array.isArray(data)) throw new Do11yQueryError('Resposta inesperada do Supabase.');

	return data
		.filter((row): row is Do11yRow => Boolean(row) && typeof row === 'object')
		.map((row) => ({
			created_at: typeof row.created_at === 'string' ? row.created_at : '',
			payload: row.payload && typeof row.payload === 'object' ? (row.payload as Record<string, unknown>) : {},
		}));
}

export async function loadMetrics(options: FetchOptions): Promise<Do11yMetrics> {
	const limit = options.limit ?? MAX_ROWS;
	const rows = await fetchRows({ ...options, limit });
	return aggregate(rows, rows.length >= limit);
}

/** Verifica credenciais e existência da tabela com o menor custo possível. */
export async function testConnection(
	options: Omit<FetchOptions, 'since' | 'limit'>
): Promise<{ ok: true; rows: number } | { ok: false; message: string }> {
	try {
		const rows = await fetchRows({
			...options,
			since: new Date(0),
			limit: 1,
		});
		return { ok: true, rows: rows.length };
	} catch (error) {
		return { ok: false, message: error instanceof Error ? error.message : 'Falha desconhecida.' };
	}
}
