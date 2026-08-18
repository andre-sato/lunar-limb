/**
 * Coleta o que as saídas legíveis por máquina precisam.
 *
 * Uma função só, usada pelas três rotas (`llms.txt`, `llms-full.txt` e o
 * Markdown por página): elas precisam exatamente do mesmo material, e duplicar
 * a coleta faria uma delas divergir na primeira mudança de schema.
 */

import { getCollection } from 'astro:content';
import { getContentGraph } from '../editor/content-graph';
import { loadGlossary } from '../glossary/loader';
import { parseOpenApi } from '../api-explorer/model';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { portal } from '../../config/portal';
import type { ApiEntry, GlossaryEntry, LlmsInput, PageEntry } from './llms';

const DOCS_ROOT = 'src/content/docs';
const SCHEMAS_ROOT = path.resolve(process.cwd(), 'src/schemas');
const LOCALES = ['en', 'es'];

const SECTION_LABELS: Record<string, string> = {
	guides: 'Guias',
	'api-reference': 'Referência da API',
	changelog: 'Changelog',
	reference: 'Referência',
};

function toPosix(value: string): string {
	return value.split(String.fromCharCode(92)).join('/');
}

function localeOf(relative: string): string {
	const first = relative.split('/')[0] ?? '';
	return LOCALES.includes(first) ? first : 'pt-BR';
}

function sectionOf(relative: string): string | null {
	const parts = relative.split('/');
	if (LOCALES.includes(parts[0] ?? '')) parts.shift();
	return parts.length > 1 ? (parts[0] ?? null) : null;
}

export async function collectPages(): Promise<PageEntry[]> {
	const entries = await getCollection('docs');

	return entries
		.filter((entry) => entry.filePath)
		.map((entry) => {
			const relative = toPosix(entry.filePath!).replace(`${DOCS_ROOT}/`, '');
			const data = entry.data as {
				title: string;
				description?: string;
				tags?: string[];
				visible?: boolean;
			};

			return {
				path: relative,
				title: data.title,
				description: data.description,
				url: `/${entry.id}/`.replace(/\/+/g, '/').replace(/\/index\/$/, '/'),
				section: sectionOf(relative),
				tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
				body: entry.body ?? '',
				// `visible: false` mantém a página publicada e fora da navegação; ela
				// também sai do índice para máquina, pelo mesmo motivo.
				visible: data.visible !== false,
				locale: localeOf(relative),
			};
		});
}

async function collectApi(): Promise<ApiEntry[]> {
	let files: string[];
	try {
		files = (await readdir(SCHEMAS_ROOT)).filter((file) => /\.(ya?ml|json)$/i.test(file));
	} catch {
		return [];
	}

	const apis: ApiEntry[] = [];
	for (const file of files) {
		try {
			const raw = await readFile(path.join(SCHEMAS_ROOT, file), 'utf-8');
			if (!/^\s*["']?(openapi|swagger)["']?\s*:/m.test(raw)) continue;

			const model = parseOpenApi(raw);
			apis.push({
				title: model.title,
				url: `/api/${file.replace(/\.(ya?ml|json)$/i, '')}/`,
				operations: model.operations.map((operation) => ({
					method: operation.method,
					path: operation.path,
					summary: operation.summary,
				})),
			});
		} catch {
			// Especificação inválida não derruba a geração das outras saídas.
		}
	}

	return apis;
}

export async function collectLlmsInput(siteUrl: string): Promise<LlmsInput> {
	const [pages, glossary, api, graph] = await Promise.all([
		collectPages(),
		loadGlossary(),
		collectApi(),
		getContentGraph({ fresh: false }).catch(() => undefined),
	]);

	const terms: GlossaryEntry[] = glossary.map((definition) => ({
		id: definition.id,
		term: definition.term,
		aliases: definition.aliases,
		definition: definition.definition,
	}));

	return {
		siteName: `${portal.companyName} ${portal.portalName}`,
		description: portal.description,
		siteUrl,
		pages,
		glossary: terms,
		api,
		graph,
		sectionLabels: SECTION_LABELS,
	};
}
