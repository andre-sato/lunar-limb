/**
 * Métricas reais do conteúdo, para o Overview do dashboard.
 *
 * Lê o filesystem em vez de manter um contador: o conteúdo pode ser alterado
 * por Git ou por outro editor, e um número guardado à parte ficaria errado sem
 * ninguém perceber.
 */

import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { CONTENT_ROOTS } from '../editor/content-fs';

export interface ContentMetrics {
	pages: number;
	snippets: number;
	locales: number;
	lastModified: string | null;
	lastModifiedPath: string | null;
}

interface WalkResult {
	files: number;
	topLevelDirs: Set<string>;
	lastModified: number;
	lastModifiedPath: string | null;
}

async function walk(rootDir: string): Promise<WalkResult> {
	const result: WalkResult = {
		files: 0,
		topLevelDirs: new Set(),
		lastModified: 0,
		lastModifiedPath: null,
	};

	async function visit(absolute: string, relative: string, depth: number): Promise<void> {
		let entries;
		try {
			entries = await readdir(absolute, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			const entryAbsolute = path.join(absolute, entry.name);
			const entryRelative = relative ? `${relative}/${entry.name}` : entry.name;

			if (entry.isDirectory()) {
				if (depth === 0) result.topLevelDirs.add(entry.name);
				await visit(entryAbsolute, entryRelative, depth + 1);
				continue;
			}

			if (!/\.mdx?$/.test(entry.name)) continue;
			result.files++;

			try {
				const stats = await stat(entryAbsolute);
				if (stats.mtimeMs > result.lastModified) {
					result.lastModified = stats.mtimeMs;
					result.lastModifiedPath = entryRelative;
				}
			} catch {
				// Arquivo removido entre o readdir e o stat — ignorar.
			}
		}
	}

	await visit(rootDir, '', 0);
	return result;
}

export async function countContent(): Promise<ContentMetrics> {
	const [docs, snippets] = await Promise.all([walk(CONTENT_ROOTS.docs), walk(CONTENT_ROOTS.snippets)]);

	// `en/` e `es/` são pastas de idioma; a raiz é o idioma nativo.
	const localeDirs = [...docs.topLevelDirs].filter((name) => /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(name));

	const newest = Math.max(docs.lastModified, snippets.lastModified);
	const newestPath =
		docs.lastModified >= snippets.lastModified
			? docs.lastModifiedPath
			: snippets.lastModifiedPath
				? `snippets/${snippets.lastModifiedPath}`
				: null;

	return {
		pages: docs.files,
		snippets: snippets.files,
		locales: localeDirs.length + 1,
		lastModified: newest > 0 ? new Date(newest).toISOString() : null,
		lastModifiedPath: newestPath,
	};
}
