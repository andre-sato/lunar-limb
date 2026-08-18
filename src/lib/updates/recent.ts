/**
 * Páginas alteradas recentemente.
 *
 * A data vem do **Git**, não do sistema de arquivos: `mtime` muda a cada clone,
 * checkout ou `npm ci`, e num servidor de CI todos os arquivos teriam a mesma
 * data — a de agora. O commit é o que registra quando o texto mudou de verdade.
 *
 * Um clone raso (`fetch-depth: 1`, o padrão do actions/checkout) não tem
 * histórico, e aí o `git log` volta vazio. Nesse caso a lista cai para o
 * `mtime` e **diz que caiu**: uma lista de datas erradas sem aviso é pior que
 * uma lista com ressalva.
 */

import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Janela padrão da página, em dias. */
export const DEFAULT_WINDOW_DAYS = 30;

export type DateSource = 'git' | 'filesystem';

export interface RecentEntry {
	/** Caminho relativo a `src/content/docs`, com `/`. */
	path: string;
	title: string;
	url: string;
	/** Seção de primeiro nível: a pasta. `null` para página na raiz. */
	section: string | null;
	updatedAt: Date;
}

/**
 * Interpreta a saída de `git log --name-only --format=%cI`.
 *
 * A saída alterna uma linha de data e blocos de caminhos. Como o `git log` vem
 * do mais recente para o mais antigo, a **primeira** aparição de um caminho é a
 * alteração mais recente dele — as seguintes são ignoradas.
 */
export function parseGitLog(output: string): Map<string, Date> {
	const dates = new Map<string, Date>();
	let current: Date | null = null;

	for (const raw of output.split('\n')) {
		const line = raw.trim();
		if (line === '') continue;

		// Uma data ISO sozinha na linha inicia um commit.
		const asDate = new Date(line);
		if (!Number.isNaN(asDate.getTime()) && /^\d{4}-\d{2}-\d{2}T/.test(line)) {
			current = asDate;
			continue;
		}

		if (!current) continue;
		// Renomeação vem como "antigo => novo"; o que interessa é o destino.
		const file = line.includes(' => ') ? line.split(' => ').pop()!.replace(/[{}]/g, '') : line;
		if (!dates.has(file)) dates.set(file, current);
	}

	return dates;
}

/** Datas de alteração vindas do Git, indexadas pelo caminho do repositório. */
export async function gitDates(sinceDays: number, cwd = process.cwd()): Promise<Map<string, Date>> {
	try {
		const { stdout } = await run(
			'git',
			[
				'log',
				`--since=${sinceDays} days ago`,
				'--name-only',
				'--format=%cI',
				'--',
				'src/content/docs',
			],
			{ cwd, maxBuffer: 10 * 1024 * 1024 }
		);
		return parseGitLog(stdout);
	} catch {
		// Sem Git, sem repositório, ou clone raso: quem chama decide o que fazer.
		return new Map();
	}
}

export interface PageInput {
	/** Caminho relativo a `src/content/docs`. */
	path: string;
	title: string;
	url: string;
}

/** Seção de primeiro nível, ignorando o prefixo de idioma. */
export function sectionOf(relativePath: string, locales: readonly string[] = ['en', 'es']): string | null {
	const parts = relativePath.split('/');
	if (parts.length > 1 && locales.includes(parts[0]!)) parts.shift();
	return parts.length > 1 ? parts[0]! : null;
}

export function withinWindow(date: Date, days: number, now = new Date()): boolean {
	const limit = now.getTime() - days * 24 * 60 * 60 * 1000;
	return date.getTime() >= limit;
}

/**
 * Monta a lista final: mais recente primeiro, dentro da janela.
 *
 * O empate é desfeito pelo caminho, e não deixado à ordem de entrada: duas
 * páginas do mesmo commit têm a mesma data, e uma lista que muda de ordem a
 * cada build produz diff onde não houve mudança.
 */
export function buildRecentList(
	pages: readonly PageInput[],
	dates: ReadonlyMap<string, Date>,
	options: { days?: number; now?: Date } = {}
): RecentEntry[] {
	const days = options.days ?? DEFAULT_WINDOW_DAYS;
	const now = options.now ?? new Date();

	const entries: RecentEntry[] = [];
	for (const page of pages) {
		const updatedAt = dates.get(page.path);
		if (!updatedAt || !withinWindow(updatedAt, days, now)) continue;

		entries.push({
			path: page.path,
			title: page.title,
			url: page.url,
			section: sectionOf(page.path),
			updatedAt,
		});
	}

	entries.sort(
		(left, right) =>
			right.updatedAt.getTime() - left.updatedAt.getTime() || left.path.localeCompare(right.path)
	);
	return entries;
}

/** Datas do sistema de arquivos, usadas só quando o Git não respondeu. */
export async function filesystemDates(
	pages: readonly PageInput[],
	docsRoot: string
): Promise<Map<string, Date>> {
	const dates = new Map<string, Date>();

	for (const page of pages) {
		try {
			const info = await stat(path.join(docsRoot, page.path));
			dates.set(page.path, info.mtime);
		} catch {
			// Arquivo ilegível não entra na lista, em vez de derrubá-la.
		}
	}

	return dates;
}
