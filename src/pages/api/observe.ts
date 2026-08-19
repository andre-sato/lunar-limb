import type { APIRoute } from 'astro';
import { loadObservabilityConfig } from '../../lib/observe/config';
import { recordEvent, sanitizePath, sanitizeSession } from '../../lib/observe/store';
import type { ObservedEvent, ObservedEventType } from '../../lib/observe/types';

export const prerender = false;

/**
 * Ingestão de sinais de leitura (P3.2).
 *
 * Pública, porque quem lê a documentação não faz login. Isso obriga a rota a ser
 * paranoica com o que aceita, e é por isso que ela reconstrói o evento campo a
 * campo em vez de gravar o corpo recebido: **nada que o cliente mandou a mais
 * chega ao disco.** Se um dia alguém acrescentar `email` ao beacon, ele é
 * descartado aqui e não vira um vazamento silencioso.
 *
 * O que a rota nunca lê: IP, `User-Agent`, `Referer`, cookies. Não porque seja
 * difícil — porque nenhum deles muda a resposta que a camada existe para dar, e
 * cada um seria mais um dado a proteger.
 */

const TYPES: readonly ObservedEventType[] = [
	'page-view',
	'search',
	'search-click',
	'example-copy',
	'page-exit',
	'feedback',
];

const MINUTE = 60_000;
const MAX_QUERY_CHARS = 120;

/** Limite por sessão, na memória do processo. Evita que um laço encha o disco. */
const seen = new Map<string, { count: number; resetAt: number }>();
const MAX_EVENTS_PER_MINUTE = 60;

function withinLimit(session: string): boolean {
	const now = Date.now();
	const entry = seen.get(session);

	if (!entry || now > entry.resetAt) {
		seen.set(session, { count: 1, resetAt: now + MINUTE });
		// Poda oportunista: sem isto o mapa cresceria com toda sessão já expirada.
		if (seen.size > 5000) for (const [key, value] of seen) if (now > value.resetAt) seen.delete(key);
		return true;
	}

	entry.count++;
	return entry.count <= MAX_EVENTS_PER_MINUTE;
}

function accepted(): Response {
	// 204 sempre que o pedido é bem formado, inclusive quando nada foi gravado.
	// Devolver "não gravei" diria ao cliente se a coleta está ligada, e isso é
	// informação sobre a configuração do portal que ele não precisa ter.
	return new Response(null, { status: 204 });
}

export const POST: APIRoute = async ({ request }) => {
	// Do Not Track e Global Privacy Control são pedidos explícitos de quem está
	// lendo. Honrá-los é o mínimo, e não custa nada.
	if (request.headers.get('dnt') === '1' || request.headers.get('sec-gpc') === '1') return accepted();

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return new Response(null, { status: 400 });
	}

	const record = (body ?? {}) as Record<string, unknown>;

	const type = TYPES.includes(record.type as ObservedEventType) ? (record.type as ObservedEventType) : null;
	const session = sanitizeSession(record.session);
	if (!type || !session) return new Response(null, { status: 400 });

	if (!withinLimit(session)) return accepted();

	const config = await loadObservabilityConfig();
	if (!config.enabled) return accepted();

	const event: ObservedEvent = {
		type,
		session,
		// O instante é do servidor e arredondado para o minuto. Aceitar o relógio do
		// cliente permitiria forjar a série; o minuto basta para toda análise desta
		// camada e reduz o quanto um evento isolado diz sobre uma pessoa.
		at: Math.floor(Date.now() / MINUTE) * MINUTE,
	};

	const path = sanitizePath(record.path);
	if (path) event.path = path;

	// Evento de página sem página é ruído: ele contaria uma visita a lugar nenhum.
	// Um caminho recusado pela sanitização (travessia, tamanho) cai aqui, e a
	// alternativa — gravar o evento sem o campo — inflaria a contagem de visitas
	// com pedidos malformados.
	if (!path && (type === 'page-view' || type === 'page-exit' || type === 'search-click' || type === 'example-copy')) {
		return new Response(null, { status: 400 });
	}

	if (type === 'search' && typeof record.results === 'number' && Number.isFinite(record.results)) {
		event.results = Math.max(0, Math.min(999, Math.round(record.results)));
	}

	if (type === 'page-exit' && typeof record.dwellSeconds === 'number' && Number.isFinite(record.dwellSeconds)) {
		// Teto de uma hora: uma aba esquecida aberta a noite inteira distorceria a
		// mediana sem dizer nada sobre leitura.
		event.dwellSeconds = Math.max(0, Math.min(3600, Math.round(record.dwellSeconds)));
	}

	if (type === 'feedback' && (record.vote === 'up' || record.vote === 'down')) event.vote = record.vote;

	// O texto só entra quando o portal está configurado para guardá-lo. O padrão é
	// não guardar, e essa é a mesma chave que o resto do portal já respeita.
	if (type === 'search' && config.storeQueryText && typeof record.query === 'string') {
		const query = record.query.trim().slice(0, MAX_QUERY_CHARS);
		if (query !== '') event.query = query;
	}

	await recordEvent(event);
	return accepted();
};
