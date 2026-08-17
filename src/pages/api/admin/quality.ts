import type { APIRoute } from 'astro';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { lintDocument, summarizeWorkspace } from '../../../lib/linter/lint';
import { loadConfig } from '../../../lib/linter/config';
import { CONTENT_ROOTS } from '../../../lib/editor/content-fs';
import { jsonResponse, requireAuthUser } from '../../../lib/auth/api';
import type { LintResult } from '../../../lib/linter/types';

export const prerender = false;

async function walk(dir: string, base = ''): Promise<string[]> {
	const found: string[] = [];
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return found;
	}
	for (const entry of entries) {
		const relative = base ? `${base}/${entry.name}` : entry.name;
		if (entry.isDirectory()) found.push(...(await walk(path.join(dir, entry.name), relative)));
		else if (/\.mdx?$/.test(entry.name)) found.push(relative);
	}
	return found;
}

/**
 * Relatório de qualidade do workspace (§68–§70).
 *
 * Analisa sob demanda, sem índice persistido: o conteúdo é a fonte de verdade
 * e pode ter sido alterado por Git desde a última visita. Num portal com
 * milhares de páginas isto passaria a exigir cache.
 */
export const GET: APIRoute = async ({ locals }) => {
	const actor = requireAuthUser(locals);
	if (!actor) return jsonResponse({ error: 'unauthorized' }, 401);

	try {
		const config = await loadConfig('default');
		const files = await walk(CONTENT_ROOTS.docs);

		const results: LintResult[] = [];
		for (const relative of files) {
			const raw = await readFile(path.resolve(CONTENT_ROOTS.docs, relative), 'utf8');
			results.push(await lintDocument(raw, { path: relative, config }));
		}

		const summary = summarizeWorkspace(results);

		return jsonResponse(
			{
				summary,
				minimumScore: config.qualityGate.minimumScore,
				pages: results
					.map((result) => ({
						path: result.path,
						score: result.score,
						band: result.band,
						gate: result.gate,
						counts: result.counts,
						categories: result.categories,
					}))
					.sort((a, b) => a.score - b.score),
			},
			200
		);
	} catch (error) {
		return jsonResponse(
			{ error: error instanceof Error ? error.message : 'Falha ao analisar o workspace.' },
			500
		);
	}
};
