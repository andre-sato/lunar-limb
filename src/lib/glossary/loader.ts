/**
 * Leitura dos GlossDefs do disco (§4).
 *
 * A fonte de verdade são arquivos Markdown versionados pelo Git — não um banco.
 * É o que dá revisão em pull request, histórico, rollback e edição à mão.
 *
 * Este carregador lê o disco diretamente, em vez de usar `astro:content`, por
 * um motivo prático: os mesmos GlossDefs são consumidos pelo linter, que roda
 * como script de linha de comando, fora do runtime do Astro. Uma única leitura
 * serve aos dois, e o schema da collection continua validando o conteúdo no
 * build (ver `src/content.config.ts`).
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import type { GlossDef } from './types';
import { buildGlossaryIndex } from './index-build';
import type { GlossaryIndex } from './types';

export const GLOSSARY_ROOT = path.resolve(process.cwd(), 'src/content/glossary');

/** Erro de conteúdo: o arquivo existe, mas não descreve um termo utilizável. */
export class GlossaryError extends Error {}

function asStringArray(value: unknown): string[] {
	if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
	if (typeof value === 'string' && value.trim() !== '') return [value.trim()];
	return [];
}

/** Interpreta um arquivo de glossário. Exportada para o teste não precisar de disco. */
export function parseGlossDef(fileName: string, raw: string): GlossDef {
	const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!match) throw new GlossaryError(`${fileName}: sem frontmatter.`);

	let front: Record<string, unknown>;
	try {
		const loaded = yaml.load(match[1]);
		front = loaded && typeof loaded === 'object' ? (loaded as Record<string, unknown>) : {};
	} catch (error) {
		throw new GlossaryError(`${fileName}: frontmatter inválido — ${error instanceof Error ? error.message : error}`);
	}

	// O `id` cai para o nome do arquivo: é estável, único por construção e o
	// caminho já é o identificador natural de um arquivo versionado.
	const id = String(front.id ?? fileName.replace(/\.mdx?$/, '')).trim();
	const term = String(front.term ?? '').trim();
	const definition = match[2].trim();

	if (id === '') throw new GlossaryError(`${fileName}: "id" vazio.`);
	if (term === '') throw new GlossaryError(`${fileName}: "term" é obrigatório.`);
	if (definition === '') throw new GlossaryError(`${fileName}: definição vazia.`);

	return {
		id,
		term,
		aliases: asStringArray(front.aliases),
		definition,
		enabled: front.enabled !== false,
		caseSensitive: front.caseSensitive === true,
		matchWholeWord: front.matchWholeWord !== false,
		deprecated: asStringArray(front.deprecated),
		createdAt: typeof front.createdAt === 'string' ? front.createdAt : undefined,
		updatedAt: typeof front.updatedAt === 'string' ? front.updatedAt : undefined,
	};
}

export async function loadGlossary(root = GLOSSARY_ROOT): Promise<GlossDef[]> {
	let files: string[];
	try {
		files = (await readdir(root)).filter((file) => /\.mdx?$/.test(file)).sort();
	} catch {
		// Sem diretório de glossário, o portal funciona sem glossário.
		return [];
	}

	const definitions: GlossDef[] = [];
	for (const file of files) {
		const raw = await readFile(path.join(root, file), 'utf-8');
		definitions.push(parseGlossDef(file, raw));
	}
	return definitions;
}

let cached: { index: GlossaryIndex; builtAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

/** Índice pronto para uso, com cache curto — o build lê isto por página. */
export async function getGlossaryIndex(options: { fresh?: boolean } = {}): Promise<GlossaryIndex> {
	if (!options.fresh && cached && Date.now() - cached.builtAt < CACHE_TTL_MS) return cached.index;

	const index = buildGlossaryIndex(await loadGlossary());
	cached = { index, builtAt: Date.now() };
	return index;
}

export function invalidateGlossaryCache(): void {
	cached = null;
}
