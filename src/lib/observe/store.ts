/**
 * Persistência dos eventos observados (P3.2).
 *
 * Arquivo em `data/`, que é gitignored — nada disto entra no repositório. A
 * retenção é aplicada **na escrita**, não num processo de limpeza separado: um
 * processo que alguém precisa lembrar de rodar é um processo que não roda, e
 * dado que deveria ter sido apagado fica.
 */

import { readJson, withFileLock, writeJson } from '../auth/store';
import { loadObservabilityConfig } from './config';
import type { ObservedEvent, ObservedEventType } from './types';

const FILE = 'observability.json';
const MAX_EVENTS = 20_000;
const DAY = 86_400_000;

interface ObservabilityFile {
	events: ObservedEvent[];
	/**
	 * Contadores que sobrevivem à poda e ao desligamento do texto.
	 *
	 * Sem eles, apagar eventos antigos apagaria também a resposta para "quantas
	 * buscas houve no total" — e a série histórica passaria a mentir por omissão.
	 */
	totals: Record<ObservedEventType, number>;
	/** `true` quando algo já foi descartado por limite de volume. */
	truncated: boolean;
}

const EMPTY: ObservabilityFile = {
	events: [],
	totals: { 'page-view': 0, search: 0, 'search-click': 0, 'example-copy': 0, 'page-exit': 0, feedback: 0 },
	truncated: false,
};

/** Sessão: 32 caracteres hexadecimais no máximo, e nada mais. */
export function sanitizeSession(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim().toLowerCase();
	return /^[a-f0-9]{8,32}$/.test(trimmed) ? trimmed : null;
}

/** Caminho de página: relativo, sem `..`, sem barra inicial. */
export function sanitizePath(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	const trimmed = value.trim().replace(/^\/+/, '').replace(/\\/g, '/');
	if (trimmed === '' || trimmed.length > 200) return undefined;
	if (trimmed.split('/').includes('..')) return undefined;
	return trimmed;
}

function prune(events: readonly ObservedEvent[], retentionDays: number, now: number): ObservedEvent[] {
	const cutoff = now - retentionDays * DAY;
	const kept = events.filter((event) => event.at >= cutoff);
	return kept.length > MAX_EVENTS ? kept.slice(kept.length - MAX_EVENTS) : kept;
}

export async function recordEvent(event: ObservedEvent): Promise<void> {
	const config = await loadObservabilityConfig();
	if (!config.enabled) return;

	await withFileLock(FILE, async () => {
		const file = await readJson<ObservabilityFile>(FILE, EMPTY);
		const now = Date.now();

		const events = prune([...file.events, event], config.retentionDays, now);
		const truncated = file.truncated || file.events.length + 1 > events.length;

		await writeJson(FILE, {
			events,
			totals: { ...file.totals, [event.type]: (file.totals[event.type] ?? 0) + 1 },
			truncated,
		} satisfies ObservabilityFile);
	});
}

export interface EventSnapshot {
	events: ObservedEvent[];
	totals: Record<ObservedEventType, number>;
	truncated: boolean;
}

export async function readEvents(windowDays?: number): Promise<EventSnapshot> {
	const file = await readJson<ObservabilityFile>(FILE, EMPTY);
	if (windowDays === undefined) return file;

	const cutoff = Date.now() - windowDays * DAY;
	return { ...file, events: file.events.filter((event) => event.at >= cutoff) };
}

/**
 * Apaga tudo.
 *
 * Existe porque a spec pede exclusão, e porque um botão de apagar que ninguém
 * implementou é uma promessa de privacidade que o produto não cumpre.
 */
export async function forgetObservations(): Promise<void> {
	await withFileLock(FILE, async () => {
		await writeJson(FILE, EMPTY);
	});
}
