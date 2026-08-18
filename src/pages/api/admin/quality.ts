import type { APIRoute } from 'astro';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { lintDocument, summarizeWorkspace } from '../../../lib/linter/lint';
import { loadConfig } from '../../../lib/linter/config';
import { CONTENT_ROOTS } from '../../../lib/editor/content-fs';
import { jsonResponse, requireAuthUser } from '../../../lib/auth/api';
import type { LintResult } from '../../../lib/linter/types';
import { getTrustIndex } from '../../../lib/trust/load';
import { trustDimension } from '../../../lib/trust/score';

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

		// Trust entra **ao lado** da nota editorial, não dentro dela (§10). Misturar
		// as duas faria uma página impecavelmente escrita e sem evidência nenhuma
		// parecer pior do que é, e o contrário também.
		const trust = await getTrustIndex({ fresh: true });

		return jsonResponse(
			{
				summary,
				minimumScore: config.qualityGate.minimumScore,
				trust: {
					summary: trust.summary,
					freshnessDays: trust.config.freshnessDays,
					// A dimensão na escala de 0 a 10, para ficar lado a lado com as outras.
					dimension: trustDimension({
						value: trust.summary.averageScore,
						sourceValidity: 0,
						testCoverage: 0,
						freshness: 0,
						ownership: 0,
					}),
				},
				pages: results
					.map((result) => {
						const page = trust.byPath.get(result.path);
						return {
							path: result.path,
							score: result.score,
							band: result.band,
							gate: result.gate,
							counts: result.counts,
							categories: result.categories,
							trust: page && page.claims.length > 0 ? { status: page.status, score: page.score.value } : null,
						};
					})
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
