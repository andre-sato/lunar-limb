/**
 * Leitura do conteúdo do portal para o gerador de OKF (issue #16).
 *
 * Lê do sistema de arquivos, e não de `astro:content`, porque o gerador roda
 * pelo CLI (`npm run okf`) — fora do Astro, onde `getCollection` não existe. É
 * a mesma escolha que o linter e o glossário já fizeram, pelo mesmo motivo.
 *
 * O que sai daqui é material bruto: caminho, frontmatter e corpo. Traduzir isso
 * para o vocabulário do OKF é trabalho de `derive.ts` — separado para que o
 * mapeamento possa ser testado sem tocar no disco.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';

export const DOCS_ROOT = 'src/content/docs';
export const GLOSSARY_ROOT = 'src/content/glossary';
export const SNIPPETS_ROOT = 'src/content/snippets';

/** Idiomas espelhados. O primeiro nível do caminho identifica a tradução. */
export const LOCALES = ['en', 'es'] as const;
export const DEFAULT_LOCALE = 'pt-BR';

export interface SourceDocument {
	/** Relativo à raiz da coleção, POSIX, com extensão. */
	relativePath: string;
	/** Relativo à raiz do repositório, POSIX — vai para `sources[].resource`. */
	repoPath: string;
	frontmatter: Record<string, unknown>;
	body: string;
	/** Última modificação no disco, ISO 8601. */
	modifiedAt: string;
	/** `pt-BR` para o original; `en`/`es` para os espelhos. */
	locale: string;
	/** Coleção de origem. */
	collection: 'docs' | 'glossary' | 'snippets';
}

function toPosix(value: string): string {
	return value.split(path.sep).join('/');
}

/**
 * Fim de linha em LF, na entrada.
 *
 * O bundle é comitado e comparado byte a byte pelo `okf:check`, e um checkout
 * Windows entrega os fontes em CRLF. Normalizar aqui — e não só na hora de
 * escrever — garante que todo o resto do gerador veja um alfabeto só.
 *
 * `\r\n?` e não `\r\n`: uma passada só de `\r\n` deixa `\r\r\n` virar `\r\n`,
 * porque a primeira barra não casa e a segunda consome o par. Foi assim que um
 * CRLF sobreviveu à normalização e entrou no bundle.
 */
function toLf(value: string): string {
	return value.replace(/\r\n?/g, '\n');
}

function localeOf(relativePath: string): string {
	const first = relativePath.split('/')[0] ?? '';
	return (LOCALES as readonly string[]).includes(first) ? first : DEFAULT_LOCALE;
}

async function walk(root: string): Promise<string[]> {
	const found: string[] = [];

	async function visit(dir: string): Promise<void> {
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			// Coleção ausente não é erro: um portal pode não ter glossário.
			return;
		}

		for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
			if (entry.name.startsWith('.')) continue;
			const absolute = path.join(dir, entry.name);
			if (entry.isDirectory()) await visit(absolute);
			else if (/\.mdx?$/i.test(entry.name)) found.push(absolute);
		}
	}

	await visit(root);
	return found;
}

/**
 * Lê uma coleção inteira.
 *
 * Frontmatter ilegível não derruba a coleta: o arquivo entra sem metadados, o
 * validador reclama depois e o operador vê **qual** arquivo está quebrado. Uma
 * exceção aqui esconderia isso atrás de um stack trace.
 */
export async function collectCollection(
	collection: SourceDocument['collection'],
	root: string,
	cwd = process.cwd()
): Promise<SourceDocument[]> {
	const absoluteRoot = path.resolve(cwd, root);
	const files = await walk(absoluteRoot);
	const documents: SourceDocument[] = [];

	for (const file of files) {
		const relativePath = toPosix(path.relative(absoluteRoot, file));
		let raw: string;
		try {
			raw = await readFile(file, 'utf-8');
		} catch {
			continue;
		}

		let frontmatter: Record<string, unknown> = {};
		let body = toLf(raw);
		try {
			const parsed = matter(toLf(raw));
			frontmatter = (parsed.data ?? {}) as Record<string, unknown>;
			body = parsed.content ?? '';
		} catch {
			// Segue com frontmatter vazio — ver acima.
		}

		let modifiedAt: string;
		try {
			modifiedAt = new Date((await stat(file)).mtimeMs).toISOString();
		} catch {
			modifiedAt = new Date(0).toISOString();
		}

		documents.push({
			relativePath,
			repoPath: `${root}/${relativePath}`,
			frontmatter,
			body,
			modifiedAt,
			locale: collection === 'docs' ? localeOf(relativePath) : DEFAULT_LOCALE,
			collection,
		});
	}

	return documents;
}

export interface SourceContent {
	docs: SourceDocument[];
	glossary: SourceDocument[];
	snippets: SourceDocument[];
}

export async function collectContent(cwd = process.cwd()): Promise<SourceContent> {
	const [docs, glossary, snippets] = await Promise.all([
		collectCollection('docs', DOCS_ROOT, cwd),
		collectCollection('glossary', GLOSSARY_ROOT, cwd),
		collectCollection('snippets', SNIPPETS_ROOT, cwd),
	]);

	return { docs, glossary, snippets };
}
