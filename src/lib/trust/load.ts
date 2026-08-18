/**
 * A parte da camada de confiança que toca disco (§7, §8, §12).
 *
 * Junta o material — páginas, especificações, código, ids de teste, configuração
 * — e chama a verificação pura de `verify.ts`. É também onde mora o cache: a
 * verificação abre especificações e olha arquivos de código, e refazer isso a cada
 * requisição de página deixaria o portal lento sem melhorar resposta nenhuma.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { parsePageOwner, parseProvenance } from './parse';
import { resolveJsonPointer, verifyClaims } from './verify';
import { pageTrust, summarizeTrust, type TrustSummary } from './score';
import { DEFAULT_TRUST_CONFIG, type PageTrust, type TrustConfig } from './types';

const ROOT = process.cwd();
const DOCS_ROOT = path.resolve(ROOT, 'src/content/docs');
const SCHEMAS_ROOT = path.resolve(ROOT, 'src/schemas');
const CONFIG_FILE = path.resolve(ROOT, 'trust.yml');

// ---------------------------------------------------------------------------
// Configuração (§8)
// ---------------------------------------------------------------------------

export async function loadTrustConfig(): Promise<TrustConfig> {
	try {
		const raw = await readFile(CONFIG_FILE, 'utf-8');
		const parsed = yaml.load(raw) as
			| { freshness?: { default?: string | number }; owners?: Record<string, string> }
			| null
			| undefined;

		const declared = parsed?.freshness?.default;
		// Aceita `180d` e `180`: a spec escreve com sufixo, e exigir só o número
		// faria a configuração do exemplo dela não funcionar.
		const days =
			typeof declared === 'string'
				? Number.parseInt(declared.replace(/d$/i, ''), 10)
				: typeof declared === 'number'
					? declared
					: undefined;

		return {
			freshnessDays: Number.isFinite(days) && (days as number) > 0 ? (days as number) : DEFAULT_TRUST_CONFIG.freshnessDays,
			owners: Object.entries(parsed?.owners ?? {}).map(([prefix, owner]) => ({ prefix, owner: String(owner) })),
		};
	} catch {
		return DEFAULT_TRUST_CONFIG;
	}
}

// ---------------------------------------------------------------------------
// Resolvedores
// ---------------------------------------------------------------------------

interface SpecDocuments {
	openapi: Map<string, unknown>;
	asyncapi: Map<string, unknown>;
}

async function loadSpecs(): Promise<SpecDocuments> {
	const openapi = new Map<string, unknown>();
	const asyncapi = new Map<string, unknown>();

	let files: string[];
	try {
		files = (await readdir(SCHEMAS_ROOT)).filter((file) => /\.(ya?ml|json)$/i.test(file));
	} catch {
		return { openapi, asyncapi };
	}

	for (const file of files) {
		const raw = await readFile(path.join(SCHEMAS_ROOT, file), 'utf-8');
		let document: unknown;
		try {
			document = /\.json$/i.test(file) ? JSON.parse(raw) : yaml.load(raw);
		} catch {
			continue;
		}

		// Quem decide o tipo é a declaração dentro do arquivo, não a extensão.
		if (/^\s*["']?(openapi|swagger)["']?\s*:/m.test(raw)) openapi.set(file, document);
		else if (/^\s*["']?asyncapi["']?\s*:/m.test(raw)) asyncapi.set(file, document);
	}

	return { openapi, asyncapi };
}

function pointerResolver(documents: Map<string, unknown>) {
	return (source: string): boolean | undefined => {
		const [file, fragment] = source.split('#');
		const name = file.trim().replace(/^.*[\\/]/, '');

		// Sem nome de arquivo, o ponteiro vale contra a única especificação que
		// existe; com mais de uma, não há como adivinhar qual, e responder
		// `undefined` é mais honesto do que escolher.
		const document = name === '' ? (documents.size === 1 ? [...documents.values()][0] : undefined) : documents.get(name);
		if (document === undefined) return undefined;
		if (!fragment) return true;

		return resolveJsonPointer(document, fragment) !== undefined;
	};
}

/**
 * O arquivo de código existe? Tem a linha citada?
 *
 * O caminho é resolvido **dentro** do repositório e recusado se escapar dele. A
 * referência vem de um arquivo de conteúdo, que qualquer pessoa com acesso ao
 * editor pode escrever; sem essa checagem, `../../../etc/passwd` viraria uma
 * sonda de existência de arquivo através da página de documentação.
 */
async function codeLocation(file: string, line?: number): Promise<{ exists: boolean; hasLine: boolean } | undefined> {
	const resolved = path.resolve(ROOT, file);
	if (!resolved.startsWith(ROOT + path.sep)) return { exists: false, hasLine: false };

	try {
		const info = await stat(resolved);
		if (!info.isFile()) return { exists: false, hasLine: false };
		if (line === undefined) return { exists: true, hasLine: true };

		const content = await readFile(resolved, 'utf-8');
		return { exists: true, hasLine: content.split('\n').length >= line };
	} catch {
		return { exists: false, hasLine: false };
	}
}

/**
 * Ids de teste conhecidos.
 *
 * Duas origens: as regras da Documentation Test Suite (`DOC-LINK-001` e
 * companhia) e os ids que a própria documentação declara em `trust.yml`. Um id
 * inventado precisa aparecer como inválido — evidência que aponta para um teste
 * inexistente é pior que nenhuma evidência, porque parece rigor.
 */
async function loadTestIds(): Promise<Set<string>> {
	const ids = new Set<string>();

	try {
		const checks = await readFile(path.resolve(ROOT, 'src/lib/doctest/checks.ts'), 'utf-8');
		for (const match of checks.matchAll(/'(DOC-[A-Z]+-\d+)'/g)) ids.add(match[1]);
	} catch {
		// Sem a suíte, resta o que a configuração declarar.
	}

	try {
		const raw = await readFile(CONFIG_FILE, 'utf-8');
		const parsed = yaml.load(raw) as { tests?: string[] } | null | undefined;
		for (const id of parsed?.tests ?? []) ids.add(String(id));
	} catch {
		// Sem configuração.
	}

	return ids;
}

// ---------------------------------------------------------------------------
// Páginas
// ---------------------------------------------------------------------------

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

function ownerFor(config: TrustConfig, relativePath: string): string | undefined {
	// O prefixo mais específico ganha: `api-reference/auth` vence `api-reference`.
	return [...config.owners]
		.filter((entry) => relativePath.startsWith(entry.prefix))
		.sort((a, b) => b.prefix.length - a.prefix.length)[0]?.owner;
}

export interface TrustIndex {
	byPath: Map<string, PageTrust>;
	summary: TrustSummary;
	config: TrustConfig;
	generatedAt: number;
}

async function build(): Promise<TrustIndex> {
	const [config, specs, testIds] = await Promise.all([loadTrustConfig(), loadSpecs(), loadTestIds()]);

	const openapiPointer = pointerResolver(specs.openapi);
	const asyncapiPointer = pointerResolver(specs.asyncapi);

	const files = await walk(DOCS_ROOT);
	const pages: PageTrust[] = [];

	for (const relative of files) {
		const raw = await readFile(path.join(DOCS_ROOT, relative), 'utf-8');
		const claims = parseProvenance(relative, raw);

		// As referências de código são resolvidas antes, porque a verificação é
		// síncrona de propósito: ela é pura, e I/O dentro dela obrigaria todo teste
		// de regra a virar assíncrono.
		const codeCache = new Map<string, { exists: boolean; hasLine: boolean } | undefined>();
		for (const claim of claims) {
			for (const provenance of claim.provenance) {
				if (provenance.sourceType !== 'code') continue;
				const key = provenance.source;
				if (!codeCache.has(key)) {
					const [file, line] = key.split(':');
					codeCache.set(key, await codeLocation(file, line ? Number.parseInt(line, 10) : undefined));
				}
			}
		}

		const verified = verifyClaims(claims, {
			freshnessDays: config.freshnessDays,
			openapiPointer,
			asyncapiPointer,
			testId: (id) => (testIds.size === 0 ? undefined : testIds.has(id)),
			codeLocation: (file, line) => codeCache.get(line === undefined ? file : `${file}:${line}`),
		});

		pages.push(pageTrust(relative, verified, config.freshnessDays, parsePageOwner(raw) ?? ownerFor(config, relative)));
	}

	return { byPath: new Map(pages.map((page) => [page.path, page])), summary: summarizeTrust(pages), config, generatedAt: Date.now() };
}

let cache: TrustIndex | null = null;
let building: Promise<TrustIndex> | null = null;

export async function getTrustIndex(options: { fresh?: boolean } = {}): Promise<TrustIndex> {
	if (options.fresh) {
		cache = null;
		building = null;
	}
	if (cache) return cache;
	// Uma construção por vez: dez páginas renderizando juntas não devem disparar
	// dez varreduras do repositório.
	if (!building) building = build().then((index) => ((cache = index), (building = null), index));
	return building;
}

export function invalidateTrustCache(): void {
	cache = null;
	building = null;
}

/** Confiança de uma página, pelo caminho relativo a `src/content/docs`. */
export async function trustForPage(relativePath: string): Promise<PageTrust | undefined> {
	return (await getTrustIndex()).byPath.get(relativePath);
}
