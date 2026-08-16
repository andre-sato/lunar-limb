import { getContentFs, type ContentFs, type TreeNode } from './content-fs';
import { frontmatterLength } from './graph-model';

/**
 * Fase 5 — busca global (§37 da especificação).
 *
 * Varre docs + snippets a cada consulta em vez de manter um índice: o volume de
 * conteúdo de um portal cabe folgado nisso, e um índice seria mais uma coisa
 * para ficar obsoleta quando alguém editar por fora do editor.
 */

export interface SearchHit {
	path: string;
	root: 'docs' | 'snippets';
	title?: string;
	/** 1-based, contando o frontmatter — a numeração do Monaco. */
	line: number;
	/** Linha inteira onde o termo apareceu, já recortada. */
	text: string;
	/** Offset da ocorrência dentro de `text`, para destacar na UI. */
	matchStart: number;
	matchLength: number;
	/** true quando a ocorrência está no título/frontmatter em vez do corpo. */
	inFrontmatter: boolean;
}

/** As duas collections varridas. Parametrizado para os testes. */
export type SearchSources = Record<'docs' | 'snippets', Pick<ContentFs, 'getTree' | 'readDocument'>>;

export interface SearchOptions {
	caseSensitive?: boolean;
	/** Máximo de ocorrências devolvidas no total. */
	limit?: number;
	/** Máximo de ocorrências por arquivo, para um arquivo só não afogar o resto. */
	perFileLimit?: number;
	/** Sobrescreve as collections lidas (usado nos testes). */
	sources?: SearchSources;
}

const MAX_LINE_LENGTH = 200;

function flattenFiles(nodes: TreeNode[]): TreeNode[] {
	const files: TreeNode[] = [];
	for (const node of nodes) {
		if (node.type === 'file') files.push(node);
		else if (node.children) files.push(...flattenFiles(node.children));
	}
	return files;
}

function trimLine(line: string, matchStart: number, matchLength: number) {
	if (line.length <= MAX_LINE_LENGTH) {
		return { text: line, matchStart, matchLength };
	}
	// Centraliza a janela na ocorrência, para o termo não cair fora do recorte.
	const start = Math.max(0, matchStart - Math.floor(MAX_LINE_LENGTH / 3));
	const text = line.slice(start, start + MAX_LINE_LENGTH);
	return { text, matchStart: matchStart - start, matchLength };
}

/** Todas as ocorrências de `query` no conteúdo dos dois roots. */
export async function searchContent(query: string, options: SearchOptions = {}): Promise<SearchHit[]> {
	const term = query.trim();
	if (!term) return [];

	const { caseSensitive = false, limit = 200, perFileLimit = 20 } = options;
	const sources: SearchSources = options.sources ?? {
		docs: getContentFs('docs'),
		snippets: getContentFs('snippets'),
	};
	const needle = caseSensitive ? term : term.toLowerCase();

	const hits: SearchHit[] = [];
	const roots: ('docs' | 'snippets')[] = ['docs', 'snippets'];

	for (const root of roots) {
		const fs = sources[root];
		const files = flattenFiles(await fs.getTree());

		for (const file of files) {
			if (hits.length >= limit) return hits;

			let raw: string;
			let title: string | undefined;
			try {
				const doc = await fs.readDocument(file.path);
				raw = doc.content;
				title = typeof doc.frontmatter?.title === 'string' ? doc.frontmatter.title : undefined;
			} catch {
				continue;
			}

			const frontmatterEnd = frontmatterLength(raw);
			const lines = raw.split('\n');

			let offset = 0;
			let perFile = 0;

			for (let i = 0; i < lines.length && perFile < perFileLimit && hits.length < limit; i++) {
				const line = lines[i];
				const haystack = caseSensitive ? line : line.toLowerCase();

				let from = 0;
				while (perFile < perFileLimit && hits.length < limit) {
					const at = haystack.indexOf(needle, from);
					if (at === -1) break;

					const trimmed = trimLine(line, at, term.length);
					hits.push({
						path: file.path,
						root,
						title,
						line: i + 1,
						text: trimmed.text,
						matchStart: trimmed.matchStart,
						matchLength: trimmed.matchLength,
						inFrontmatter: offset < frontmatterEnd,
					});
					perFile++;
					from = at + Math.max(needle.length, 1);
				}

				offset += line.length + 1;
			}
		}
	}

	return hits;
}
