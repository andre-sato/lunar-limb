/**
 * Leitura das fontes de verdade para montar o Twin (§2, §7).
 *
 * A única parte com disco. Ela não interpreta nada — só junta o material e chama
 * `buildTwin`. O Twin é derivado a cada análise, e de propósito: um índice
 * persistido seria uma segunda fonte de verdade, que é exatamente o que a §2
 * proíbe. Ele pode ficar em cache na memória do processo, e é o que acontece
 * aqui; o que não existe é um arquivo dizendo como o produto é.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { getContentGraph } from '../editor/content-graph';
import { parseOpenApi, type ApiModel } from '../api-explorer/model';
import { loadGlossary } from '../glossary/loader';
import { buildTwin, endpointKey } from './build';
import { DEFAULT_TWIN_CONFIG, type TwinConfig, type TwinGraph } from './types';

const ROOT = process.cwd();
const DOCS_ROOT = path.resolve(ROOT, 'src/content/docs');
const SCHEMAS_ROOT = path.resolve(ROOT, 'src/schemas');
const API_ROUTES_ROOT = path.resolve(ROOT, 'src/pages/api');
const DOCTEST_CHECKS = path.resolve(ROOT, 'src/lib/doctest/checks.ts');
const VERSIONS_FILE = path.resolve(ROOT, 'versions.yml');
const CONFIG_FILE = path.resolve(ROOT, 'twin.yml');

/**
 * Configuração do Twin.
 *
 * Ela não descreve o produto — só diz o que entra na conta da cobertura. Arquivo
 * ausente ou ilegível cai no padrão: um erro de indentação no YAML não deve
 * apagar o indicador.
 */
export async function loadTwinConfig(): Promise<TwinConfig> {
	try {
		const raw = await readFile(CONFIG_FILE, 'utf-8');
		const parsed = yaml.load(raw) as { internal?: string[]; coverage?: { minimum?: number } } | null | undefined;

		return {
			internal: Array.isArray(parsed?.internal) ? parsed.internal.map(String) : DEFAULT_TWIN_CONFIG.internal,
			minimumCoverage:
				typeof parsed?.coverage?.minimum === 'number' ? parsed.coverage.minimum : DEFAULT_TWIN_CONFIG.minimumCoverage,
		};
	} catch {
		return DEFAULT_TWIN_CONFIG;
	}
}

async function walk(dir: string, base = '', extensions = /\.mdx?$/): Promise<string[]> {
	const found: string[] = [];
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return found;
	}
	for (const entry of entries) {
		const relative = base ? `${base}/${entry.name}` : entry.name;
		if (entry.isDirectory()) found.push(...(await walk(path.join(dir, entry.name), relative, extensions)));
		else if (extensions.test(entry.name)) found.push(relative);
	}
	return found;
}

// ---------------------------------------------------------------------------
// Código: roteamento por arquivo (§7)
// ---------------------------------------------------------------------------

const HTTP_EXPORT = /export\s+const\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;

/**
 * As rotas HTTP implementadas neste repositório.
 *
 * A Astro mapeia arquivo para rota de forma determinística, então isto **não é
 * heurística**: `src/pages/api/auth/me.ts` que exporta `GET` implementa
 * `GET /api/auth/me`. Os métodos vêm dos `export const` do próprio arquivo.
 *
 * É o analisador de código do §7 nesta base. Acrescentar TypeScript genérico,
 * Java ou Python depois significa produzir esta mesma lista de outra forma — o
 * grafo não muda.
 */
export async function readApiRoutes(): Promise<Array<{ file: string; path: string; methods: string[] }>> {
	const files = await walk(API_ROUTES_ROOT, '', /\.(ts|js)$/);
	const routes: Array<{ file: string; path: string; methods: string[] }> = [];

	for (const relative of files) {
		const raw = await readFile(path.join(API_ROUTES_ROOT, relative), 'utf-8');
		const methods = [...new Set([...raw.matchAll(HTTP_EXPORT)].map((match) => match[1]))];
		if (methods.length === 0) continue;

		// `index.ts` responde pelo diretório; o resto responde pelo próprio nome.
		const routePath = `/api/${relative.replace(/\.(ts|js)$/, '').replace(/\/?index$/, '')}`.replace(/\/$/, '');

		routes.push({ file: `src/pages/api/${relative}`, path: routePath || '/api', methods });
	}

	return routes;
}

// ---------------------------------------------------------------------------
// Especificações
// ---------------------------------------------------------------------------

async function readApis(): Promise<Array<{ path: string; model: ApiModel; kind: 'openapi' | 'asyncapi' }>> {
	let files: string[];
	try {
		files = (await readdir(SCHEMAS_ROOT)).filter((file) => /\.(ya?ml|json)$/i.test(file));
	} catch {
		return [];
	}

	const apis: Array<{ path: string; model: ApiModel; kind: 'openapi' | 'asyncapi' }> = [];

	for (const file of files) {
		const raw = await readFile(path.join(SCHEMAS_ROOT, file), 'utf-8');
		if (!/^\s*["']?(openapi|swagger)["']?\s*:/m.test(raw)) continue;
		try {
			apis.push({ path: `src/schemas/${file}`, model: parseOpenApi(raw), kind: 'openapi' });
		} catch {
			// Especificação inválida: os testes de documentação já reclamam dela.
		}
	}

	return apis;
}

// ---------------------------------------------------------------------------
// Páginas e referências
// ---------------------------------------------------------------------------

/** Menções a endpoint no texto: `GET /users/{id}`, `POST /payments`. */
const ENDPOINT_MENTION = /\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[A-Za-z0-9/_{}.:-]+)/g;

export function extractEndpointMentions(body: string): string[] {
	const found = new Set<string>();
	for (const match of body.matchAll(ENDPOINT_MENTION)) {
		found.add(endpointKey(match[1], match[2].replace(/[.,;:)]+$/, '')));
	}
	return [...found];
}

async function readPages(): Promise<{
	pages: Array<{ path: string; title?: string; body: string; version?: string }>;
	references: Map<string, string[]>;
}> {
	const files = await walk(DOCS_ROOT);
	const pages: Array<{ path: string; title?: string; body: string; version?: string }> = [];
	const references = new Map<string, string[]>();

	for (const relative of files) {
		const raw = await readFile(path.join(DOCS_ROOT, relative), 'utf-8');
		const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);

		let title: string | undefined;
		let version: string | undefined;
		if (frontmatter) {
			title = frontmatter[1].match(/^title:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
			version = frontmatter[1].match(/^version:\s*(.+)$/m)?.[1]?.trim();
		}

		pages.push({ path: relative, title, body: raw, version });
		references.set(relative, extractEndpointMentions(raw));
	}

	return { pages, references };
}

async function readTestIds(): Promise<string[]> {
	try {
		const raw = await readFile(DOCTEST_CHECKS, 'utf-8');
		return [...new Set([...raw.matchAll(/'(DOC-[A-Z]+-\d+)'/g)].map((match) => match[1]))];
	} catch {
		return [];
	}
}

async function readVersions(): Promise<Array<{ id: string; lifecycle: string }>> {
	try {
		const raw = await readFile(VERSIONS_FILE, 'utf-8');
		const parsed = yaml.load(raw) as { versions?: Array<{ id?: string; lifecycle?: string }> } | null | undefined;
		return (parsed?.versions ?? [])
			.filter((entry): entry is { id: string; lifecycle?: string } => typeof entry?.id === 'string')
			.map((entry) => ({ id: entry.id, lifecycle: entry.lifecycle ?? 'current' }));
	} catch {
		return [];
	}
}

// ---------------------------------------------------------------------------
// Índice
// ---------------------------------------------------------------------------

export interface TwinIndex {
	graph: TwinGraph;
	config: TwinConfig;
	/** Endpoints citados por cada página, para detectar documentação órfã. */
	references: Map<string, string[]>;
}

let cache: TwinIndex | null = null;
let building: Promise<TwinIndex> | null = null;

async function build(): Promise<TwinIndex> {
	const [config, graph, apis, { pages, references }, routes, glossary, tests, versions] = await Promise.all([
		loadTwinConfig(),
		getContentGraph({ fresh: true }).catch(() => undefined),
		readApis(),
		readPages(),
		readApiRoutes(),
		loadGlossary().catch(() => []),
		readTestIds(),
		readVersions(),
	]);

	return {
		graph: buildTwin({ graph, apis, pages, routes, glossary, tests, versions, internal: config.internal }),
		references,
		config,
	};
}

export async function getTwin(options: { fresh?: boolean } = {}): Promise<TwinIndex> {
	if (options.fresh) {
		cache = null;
		building = null;
	}
	if (cache) return cache;
	if (!building) building = build().then((index) => ((cache = index), (building = null), index));
	return building;
}

export function invalidateTwinCache(): void {
	cache = null;
	building = null;
}
