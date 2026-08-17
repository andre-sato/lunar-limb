/**
 * Feedback de página ("Esta página foi útil?").
 *
 * A Starlight não traz um componente de feedback, e as alternativas prontas
 * (PushFeedback, Feelback, Encatch) são serviços de terceiros. Aqui o dado
 * fica no próprio portal: quem escreve a documentação consegue ler o retorno
 * sem depender de conta externa, e nada sai para fora.
 *
 * O envio é **anônimo**: sem login, sem cookie, sem identificador de visitante.
 * O que se guarda é o caminho da página, o voto e, opcionalmente, um
 * comentário. Nada que identifique quem escreveu.
 */

import { randomUUID } from 'node:crypto';
import { readJson, withFileLock, writeJson } from '../auth/store';

const FILE = 'feedback.json';

/** Teto do arquivo: o feedback não pode crescer sem fim no disco. */
export const MAX_ENTRIES = 5000;

export const MAX_COMMENT_LENGTH = 500;
const MAX_PATH_LENGTH = 512;

export type Rating = 'up' | 'down';

export interface FeedbackEntry {
	id: string;
	/** Caminho interno da página, ex.: `/guides/authentication/`. */
	path: string;
	locale: string;
	rating: Rating;
	comment?: string;
	createdAt: string;
}

export interface SubmitInput {
	path: unknown;
	locale: unknown;
	rating: unknown;
	comment?: unknown;
}

export class FeedbackError extends Error {}

/**
 * Só aceita caminho interno.
 *
 * O valor vem do navegador e é exibido depois no dashboard como link. Sem esta
 * checagem, alguém poderia gravar `https://site-malicioso.example` e fazer o
 * painel administrativo apresentar um link externo como se fosse uma página do
 * portal.
 */
export function normalizePath(value: unknown): string {
	if (typeof value !== 'string') throw new FeedbackError('Caminho ausente.');
	const trimmed = value.trim();
	if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
		throw new FeedbackError('Caminho inválido.');
	}
	if (trimmed.length > MAX_PATH_LENGTH) throw new FeedbackError('Caminho longo demais.');
	if (trimmed.includes('\0')) throw new FeedbackError('Caminho inválido.');
	// Descarta query e fragmento: `/guia?x=1` e `/guia#secao` são a mesma página.
	return trimmed.split(/[?#]/)[0];
}

export function normalizeRating(value: unknown): Rating {
	if (value === 'up' || value === 'down') return value;
	throw new FeedbackError('Avaliação inválida.');
}

export function normalizeComment(value: unknown): string | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	if (typeof value !== 'string') throw new FeedbackError('Comentário inválido.');
	const trimmed = value.trim();
	if (trimmed === '') return undefined;
	if (trimmed.length > MAX_COMMENT_LENGTH) {
		throw new FeedbackError(`O comentário pode ter no máximo ${MAX_COMMENT_LENGTH} caracteres.`);
	}
	return trimmed;
}

export function normalizeLocale(value: unknown): string {
	if (typeof value !== 'string') return 'pt-BR';
	const trimmed = value.trim();
	return /^[a-zA-Z-]{2,10}$/.test(trimmed) ? trimmed : 'pt-BR';
}

export async function submitFeedback(input: SubmitInput): Promise<FeedbackEntry> {
	const entry: FeedbackEntry = {
		id: randomUUID(),
		path: normalizePath(input.path),
		locale: normalizeLocale(input.locale),
		rating: normalizeRating(input.rating),
		comment: normalizeComment(input.comment),
		createdAt: new Date().toISOString(),
	};

	await withFileLock(FILE, async () => {
		const entries = await readJson<FeedbackEntry[]>(FILE, []);
		entries.push(entry);
		const trimmed = entries.length > MAX_ENTRIES ? entries.slice(entries.length - MAX_ENTRIES) : entries;
		await writeJson(FILE, trimmed);
	});

	return entry;
}

/**
 * Anexa um comentário a um voto já gravado.
 *
 * O voto é enviado assim que o leitor clica no polegar — quem fechar a página
 * em seguida não some da contagem. O comentário é opcional e chega depois,
 * então precisa **complementar** aquele registro em vez de criar outro: um
 * segundo registro contaria o mesmo voto duas vezes e estragaria a métrica.
 *
 * Só preenche comentário vazio: assim uma requisição repetida não reescreve o
 * que já foi dito.
 */
export async function attachComment(id: unknown, rawComment: unknown): Promise<boolean> {
	if (typeof id !== 'string' || id.length > 64) throw new FeedbackError('Identificador inválido.');
	const comment = normalizeComment(rawComment);
	if (!comment) return false;

	return withFileLock(FILE, async () => {
		const entries = await readJson<FeedbackEntry[]>(FILE, []);
		const index = entries.findIndex((entry) => entry.id === id);
		if (index === -1) return false;
		if (entries[index].comment) return false;

		entries[index] = { ...entries[index], comment };
		await writeJson(FILE, entries);
		return true;
	});
}

export async function listFeedback(): Promise<FeedbackEntry[]> {
	return readJson<FeedbackEntry[]>(FILE, []);
}

// ---------------------------------------------------------------------------
// Agregação (pura)
// ---------------------------------------------------------------------------

export interface PageFeedback {
	path: string;
	up: number;
	down: number;
	total: number;
	/** Fração de votos positivos, entre 0 e 1. */
	score: number;
}

export interface FeedbackComment {
	id: string;
	path: string;
	rating: Rating;
	comment: string;
	createdAt: string;
}

export interface FeedbackSummary {
	total: number;
	up: number;
	down: number;
	score: number;
	/** Piores páginas com volume mínimo — onde mexer primeiro. */
	needsAttention: PageFeedback[];
	topPages: PageFeedback[];
	comments: FeedbackComment[];
	timeline: Array<{ date: string; up: number; down: number }>;
}

/**
 * Volume mínimo para uma página entrar em "precisa de atenção".
 *
 * Sem isso, uma página com um único voto negativo lideraria a lista de piores,
 * o que manda o time reescrever conteúdo com base em uma pessoa.
 */
export const MIN_VOTES_FOR_ATTENTION = 3;

export function aggregateFeedback(entries: readonly FeedbackEntry[], since?: Date): FeedbackSummary {
	const cutoff = since ? since.getTime() : null;
	const relevant = cutoff
		? entries.filter((entry) => new Date(entry.createdAt).getTime() >= cutoff)
		: [...entries];

	const pages = new Map<string, { up: number; down: number }>();
	const days = new Map<string, { up: number; down: number }>();
	let up = 0;
	let down = 0;

	for (const entry of relevant) {
		const page = pages.get(entry.path) ?? { up: 0, down: 0 };
		const day = entry.createdAt.slice(0, 10);
		const dayEntry = days.get(day) ?? { up: 0, down: 0 };

		if (entry.rating === 'up') {
			up++;
			page.up++;
			dayEntry.up++;
		} else {
			down++;
			page.down++;
			dayEntry.down++;
		}

		pages.set(entry.path, page);
		days.set(day, dayEntry);
	}

	const asPageFeedback = [...pages.entries()].map(([path, counts]) => {
		const total = counts.up + counts.down;
		return { path, up: counts.up, down: counts.down, total, score: total > 0 ? counts.up / total : 0 };
	});

	const needsAttention = asPageFeedback
		.filter((page) => page.total >= MIN_VOTES_FOR_ATTENTION && page.score < 0.5)
		.sort((a, b) => a.score - b.score || b.total - a.total)
		.slice(0, 10);

	const topPages = [...asPageFeedback]
		.sort((a, b) => b.total - a.total || a.path.localeCompare(b.path, 'pt-BR'))
		.slice(0, 20);

	const comments = relevant
		.filter((entry): entry is FeedbackEntry & { comment: string } => Boolean(entry.comment))
		.map((entry) => ({
			id: entry.id,
			path: entry.path,
			rating: entry.rating,
			comment: entry.comment,
			createdAt: entry.createdAt,
		}))
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
		.slice(0, 50);

	const timeline = [...days.entries()]
		.map(([date, counts]) => ({ date, up: counts.up, down: counts.down }))
		.sort((a, b) => a.date.localeCompare(b.date));

	const total = up + down;

	return {
		total,
		up,
		down,
		score: total > 0 ? up / total : 0,
		needsAttention,
		topPages,
		comments,
		timeline,
	};
}
