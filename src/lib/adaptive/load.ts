/**
 * Leitura dos metadados de contexto das páginas (§4, §9).
 *
 * A parte que toca disco: lê o frontmatter de cada página, extrai audiências,
 * tags, versão e produto, e mantém em cache. As funções que decidem ordem e
 * recomendação são puras e vivem em `context.ts` e `recommend.ts`.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { parseAudiences } from './context';
import { isExperience, type PageContextMeta } from './types';

const DOCS_ROOT = path.resolve(process.cwd(), 'src/content/docs');

function urlFor(relative: string): string {
	const slug = relative.replace(/\.mdx?$/, '').replace(/(?:^|\/)index$/, '');
	return `/${slug}/`.replace(/\/{2,}/g, '/');
}

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

export function parsePageMeta(relative: string, raw: string): PageContextMeta {
	const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);

	let frontmatter: Record<string, unknown> = {};
	if (match) {
		try {
			frontmatter = (yaml.load(match[1]) as Record<string, unknown>) ?? {};
		} catch {
			// Frontmatter ilegível: a página existe e continua navegável, só não
			// participa da adaptação. Derrubar a leitura inteira por um YAML torto
			// seria trocar um defeito pequeno por um grande.
		}
	}

	const tags = Array.isArray(frontmatter.tags) ? frontmatter.tags.map(String) : [];
	const product = typeof frontmatter.product === 'string' ? frontmatter.product : undefined;

	return {
		path: relative,
		title: typeof frontmatter.title === 'string' ? frontmatter.title : undefined,
		url: urlFor(relative),
		slug: typeof frontmatter.slug === 'string' ? frontmatter.slug : undefined,
		audiences: parseAudiences(frontmatter),
		tags,
		version: typeof frontmatter.version === 'string' ? frontmatter.version : undefined,
		product,
		products: parseProducts(frontmatter, product),
		experience: isExperience(frontmatter.experience) ? frontmatter.experience : undefined,
	};
}

/**
 * Os produtos da página, nas duas formas que o frontmatter aceita.
 *
 *     products: [portal, payments]
 *     product: portal
 *
 * A lista é a forma da issue #18; o escalar já existia e continua valendo, para
 * não invalidar frontmatter escrito antes desta mudança. Lista vazia é o padrão
 * e significa **compartilhada** — a ausência do campo não pode ser confundida
 * com "não pertence a nenhum produto", que esconderia a página de todo mundo.
 */
function parseProducts(
	frontmatter: Record<string, unknown>,
	product: string | undefined
): string[] {
	const declared = Array.isArray(frontmatter.products)
		? frontmatter.products.filter((entry): entry is string => typeof entry === 'string')
		: [];

	const all = product === undefined ? declared : [...declared, product];
	return [...new Set(all.map((entry) => entry.trim()).filter((entry) => entry !== ''))];
}

export interface AdaptiveIndex {
	pages: PageContextMeta[];
	byPath: Map<string, PageContextMeta>;
	generatedAt: number;
}

let cache: AdaptiveIndex | null = null;
let building: Promise<AdaptiveIndex> | null = null;

async function build(): Promise<AdaptiveIndex> {
	const files = await walk(DOCS_ROOT);
	const pages: PageContextMeta[] = [];

	for (const relative of files) {
		const raw = await readFile(path.join(DOCS_ROOT, relative), 'utf-8');
		pages.push(parsePageMeta(relative, raw));
	}

	return { pages, byPath: new Map(pages.map((page) => [page.path, page])), generatedAt: Date.now() };
}

export async function getAdaptiveIndex(options: { fresh?: boolean } = {}): Promise<AdaptiveIndex> {
	if (options.fresh) {
		cache = null;
		building = null;
	}
	if (cache) return cache;
	if (!building) building = build().then((index) => ((cache = index), (building = null), index));
	return building;
}

export function invalidateAdaptiveCache(): void {
	cache = null;
	building = null;
}
