/**
 * Camada de parsing do linter (§82).
 *
 * Entende Markdown/MDX e **não** julga nada — só produz um modelo com
 * posições exatas. As regras consomem este modelo; nenhuma delas volta a
 * mexer no texto cru.
 *
 * O ponto delicado é o mapeamento de posição. Um finding precisa apontar para
 * linha e coluna reais no editor, mas as regras de frase trabalham sobre texto
 * concatenado (um parágrafo pode ser várias linhas, com ênfase e código no
 * meio). Por isso cada trecho de texto carrega um índice
 * `offset no buffer → (linha, coluna)`, e qualquer posição encontrada por
 * regex volta para o lugar certo no arquivo.
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMdx from 'remark-mdx';
import { visit } from 'unist-util-visit';
import yaml from 'js-yaml';
import type { LintLanguage, PageType, SourceRange } from './types';

// mdast/mdx node shapes variam entre versões; este módulo lê poucos campos.
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface PositionedText {
	/** Texto concatenado, sem marcação. */
	text: string;
	/** Para cada índice do texto, a posição no arquivo. */
	map: Array<{ line: number; column: number }>;
}

export interface Sentence {
	text: string;
	words: number;
	location: SourceRange;
}

export interface Paragraph {
	text: string;
	words: number;
	sentences: Sentence[];
	location: SourceRange;
}

export interface Heading {
	depth: number;
	text: string;
	line: number;
	location: SourceRange;
}

export interface CodeBlock {
	lang: string | null;
	value: string;
	line: number;
	location: SourceRange;
	/** Texto do parágrafo imediatamente anterior, se houver. */
	precededByText: string | null;
}

export interface LinkRef {
	text: string;
	url: string;
	location: SourceRange;
}

export interface ImageRef {
	alt: string;
	url: string;
	location: SourceRange;
}

export interface TableRef {
	headers: string[];
	rows: string[][];
	location: SourceRange;
}

export interface ListRef {
	ordered: boolean;
	items: Array<{ text: string; location: SourceRange }>;
	location: SourceRange;
}

export interface ParsedDocument {
	raw: string;
	/** Corpo sem frontmatter. */
	body: string;
	lines: string[];
	frontmatter: Record<string, unknown>;
	/** Quantas linhas o frontmatter ocupa — todo offset do corpo soma isto. */
	frontmatterLines: number;
	language: LintLanguage;
	pageType: PageType | null;
	title: string | null;

	paragraphs: Paragraph[];
	headings: Heading[];
	codeBlocks: CodeBlock[];
	links: LinkRef[];
	images: ImageRef[];
	tables: TableRef[];
	lists: ListRef[];

	/** Texto corrido, fora de código — base das regras de palavra. */
	prose: PositionedText[];
	/** Linhas que estão dentro de bloco de código (1-based, absolutas). */
	codeLines: Set<number>;
	words: number;
	parseError: string | null;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function splitFrontmatter(raw: string): {
	frontmatter: Record<string, unknown>;
	body: string;
	frontmatterLines: number;
} {
	const match = raw.match(FRONTMATTER_RE);
	if (!match) return { frontmatter: {}, body: raw, frontmatterLines: 0 };

	let frontmatter: Record<string, unknown> = {};
	try {
		const loaded = yaml.load(match[1]);
		if (loaded && typeof loaded === 'object' && !Array.isArray(loaded)) {
			frontmatter = loaded as Record<string, unknown>;
		}
	} catch {
		// YAML inválido é problema de outra camada; aqui só não se usa nada dele.
	}

	const consumed = match[0];
	const frontmatterLines = consumed.split('\n').length - 1;
	return { frontmatter, body: raw.slice(consumed.length), frontmatterLines };
}

/**
 * Divisão em frases.
 *
 * Evita quebrar em abreviações comuns, números decimais e reticências —
 * quebrar errado geraria "frase curta demais" em série, que é ruído puro.
 */
const ABBREVIATIONS = new Set([
	'ex',
	'p.ex',
	'etc',
	'sr',
	'sra',
	'dr',
	'dra',
	'ed',
	'vs',
	'fig',
	'no',
	'nº',
	'e.g',
	'i.e',
	'mr',
	'mrs',
	'inc',
	'ltd',
	'approx',
	'ver',
	'cf',
]);

export function splitSentences(text: string): Array<{ text: string; offset: number }> {
	const result: Array<{ text: string; offset: number }> = [];
	let start = 0;

	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (char !== '.' && char !== '!' && char !== '?') continue;

		// Pontuação repetida: não quebra no meio dela.
		if (text[i + 1] === '.' || text[i + 1] === '!' || text[i + 1] === '?') continue;

		// Fim de reticências não encerra frase: "Aguarde... o processo segue"
		// é uma frase só, e quebrá-la produziria um fragmento começando em
		// minúscula — que ainda geraria um falso "frase começa em minúscula".
		if (char === '.' && text[i - 1] === '.') continue;

		// Decimal: 3.5
		if (char === '.' && /\d/.test(text[i - 1] ?? '') && /\d/.test(text[i + 1] ?? '')) continue;

		// Abreviação conhecida antes do ponto.
		const before = text.slice(Math.max(0, i - 12), i);
		const lastWord = before.split(/[\s(]/).pop()?.toLowerCase() ?? '';
		if (char === '.' && ABBREVIATIONS.has(lastWord)) continue;

		const next = text[i + 1];
		// Fim de frase precisa ser seguido de espaço/fim, senão é URL ou versão.
		if (next !== undefined && !/\s/.test(next)) continue;

		const chunk = text.slice(start, i + 1).trim();
		if (chunk) result.push({ text: chunk, offset: text.indexOf(chunk, start) });
		start = i + 1;
	}

	const tail = text.slice(start).trim();
	if (tail) result.push({ text: tail, offset: text.indexOf(tail, start) });

	return result;
}

export function countWords(text: string): number {
	const cleaned = text.replace(/[`*_~[\]()#>|]/g, ' ');
	const matches = cleaned.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu);
	return matches ? matches.length : 0;
}

function positionAt(map: PositionedText['map'], offset: number): { line: number; column: number } {
	if (map.length === 0) return { line: 1, column: 1 };
	const clamped = Math.max(0, Math.min(offset, map.length - 1));
	return map[clamped];
}

function nodeRange(node: any, lineOffset: number): SourceRange {
	const start = node?.position?.start;
	const end = node?.position?.end;
	return {
		startLine: (start?.line ?? 1) + lineOffset,
		startColumn: start?.column ?? 1,
		endLine: end?.line !== undefined ? end.line + lineOffset : undefined,
		endColumn: end?.column,
	};
}

/**
 * Concatena os nós de texto de um bloco, guardando a posição de cada caractere.
 *
 * O separador entre nós inline só entra quando existe de fato um vão no
 * arquivo. Inserir um espaço incondicionalmente entre nós — como seria natural
 * ao concatenar — inventa espaços que o autor não escreveu: `**negrito**.`
 * viraria `negrito .`, e as regras de espaço duplicado e de espaço antes de
 * pontuação passariam a acusar centenas de problemas inexistentes.
 */
function collectText(node: any, lineOffset: number): PositionedText {
	let text = '';
	const map: PositionedText['map'] = [];
	let previousEndOffset: number | null = null;

	visit(node, (child: any) => {
		if (child.type !== 'text' && child.type !== 'inlineCode') return;
		// `inlineCode` entra como texto porque conta para o tamanho da frase.
		const value: string = child.value ?? '';
		const start = child.position?.start;
		const end = child.position?.end;
		if (!start) return;

		// Vão real no arquivo (marcação entre os dois nós, como `**` ou `[`)
		// vira um único espaço, para as palavras não se colarem. O separador é
		// dispensado quando qualquer um dos lados já traz espaço — senão o
		// buffer ganha um espaço duplo que não existe no arquivo.
		if (previousEndOffset !== null && typeof start.offset === 'number' && start.offset > previousEndOffset) {
			const last = map[map.length - 1];
			if (last && !/\s$/.test(text) && !/^\s/.test(value)) {
				text += ' ';
				map.push(last);
			}
		}

		for (let i = 0; i < value.length; i++) {
			// Código inline entra como espaço: ele ocupa lugar na frase (conta
			// para o comprimento) mas não é prosa. Sem isso, `api-essentials`
			// seria acusado de grafar "API" errado, e um identificador viraria
			// erro de terminologia.
			text += child.type === 'inlineCode' ? ' ' : value[i];
			// Código inline aponta para a crase de abertura, não para o conteúdo.
			// Como o conteúdo virou espaço, nenhuma regra casa dentro dele; e a
			// posição da crase é o que permite às regras perceberem que a frase
			// começa com código, em vez de com uma palavra minúscula.
			const column = child.type === 'inlineCode' ? start.column : start.column + i;
			map.push({ line: start.line + lineOffset, column });
		}

		previousEndOffset = typeof end?.offset === 'number' ? end.offset : previousEndOffset;
	});

	return { text: text.replace(/\s+$/, ''), map };
}

function textOf(node: any): string {
	let out = '';
	visit(node, (child: any) => {
		if (child.type === 'text' || child.type === 'inlineCode') out += child.value ?? '';
	});
	return out.trim();
}

export interface ParseOptions {
	language?: LintLanguage;
	/** Caminho relativo, usado para inferir idioma quando não houver frontmatter. */
	path?: string;
}

/** Infere o idioma pelo caminho: `en/…` e `es/…`; a raiz é pt-BR. */
export function inferLanguage(path: string | undefined, frontmatter: Record<string, unknown>): LintLanguage {
	const declared = frontmatter.lang ?? frontmatter.language;
	if (declared === 'en' || declared === 'es' || declared === 'pt-BR') return declared;

	const normalized = (path ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
	if (/^en\//.test(normalized)) return 'en';
	if (/^es\//.test(normalized)) return 'es';
	return 'pt-BR';
}

function readPageType(frontmatter: Record<string, unknown>): PageType | null {
	const value = frontmatter.type;
	const allowed: readonly string[] = [
		'tutorial',
		'how-to',
		'concept',
		'reference',
		'troubleshooting',
		'api-reference',
		'overview',
	];
	return typeof value === 'string' && allowed.includes(value) ? (value as PageType) : null;
}

export function parseDocument(raw: string, options: ParseOptions = {}): ParsedDocument {
	const { frontmatter, body, frontmatterLines } = splitFrontmatter(raw);
	const language = options.language ?? inferLanguage(options.path, frontmatter);
	const pageType = readPageType(frontmatter);

	const document: ParsedDocument = {
		raw,
		body,
		lines: raw.split(/\r?\n/),
		frontmatter,
		frontmatterLines,
		language,
		pageType,
		title: typeof frontmatter.title === 'string' ? frontmatter.title : null,
		paragraphs: [],
		headings: [],
		codeBlocks: [],
		links: [],
		images: [],
		tables: [],
		lists: [],
		prose: [],
		codeLines: new Set(),
		words: 0,
		parseError: null,
	};

	// MDX só para arquivos .mdx: aplicar o parser de MDX a um .md faria um `<`
	// solto no texto virar erro de sintaxe. Com ele, `import`/`export` viram
	// nós próprios e deixam de ser lidos como parágrafos — sem isso, a linha
	// `import ... from '@astrojs/starlight/components'` seria acusada de
	// começar em minúscula e de grafar "Starlight" errado.
	const isMdx = (options.path ?? '').endsWith('.mdx');

	let tree: any;
	try {
		const processor = unified().use(remarkParse).use(remarkGfm);
		tree = (isMdx ? processor.use(remarkMdx) : processor).parse(body);
	} catch (error) {
		// MDX malformado não pode derrubar o linter: devolve-se o documento
		// vazio com o erro registrado, e as regras que dependem da AST não rodam.
		document.parseError = error instanceof Error ? error.message : 'Falha ao analisar o documento.';
		return document;
	}

	const offset = frontmatterLines;
	let previousParagraphText: string | null = null;

	visit(tree, (node: any, _index, parent: any) => {
		switch (node.type) {
			case 'heading': {
				document.headings.push({
					depth: node.depth,
					text: textOf(node),
					line: (node.position?.start?.line ?? 1) + offset,
					location: nodeRange(node, offset),
				});
				break;
			}

			case 'paragraph': {
				// Parágrafos dentro de item de lista são tratados pela regra de
				// lista; contá-los à parte inflaria "parágrafo longo".
				if (parent?.type === 'listItem') break;

				const positioned = collectText(node, offset);
				const text = positioned.text.trim();
				if (!text) break;

				const sentences: Sentence[] = splitSentences(positioned.text).map((sentence) => {
					const start = positionAt(positioned.map, sentence.offset);
					const end = positionAt(positioned.map, sentence.offset + sentence.text.length - 1);
					return {
						text: sentence.text,
						words: countWords(sentence.text),
						location: {
							startLine: start.line,
							startColumn: start.column,
							endLine: end.line,
							endColumn: end.column + 1,
						},
					};
				});

				document.paragraphs.push({
					text,
					words: countWords(text),
					sentences,
					location: nodeRange(node, offset),
				});
				document.prose.push(positioned);
				previousParagraphText = text;
				break;
			}

			case 'code': {
				const start = (node.position?.start?.line ?? 1) + offset;
				const end = (node.position?.end?.line ?? start) + offset;
				for (let line = start; line <= end; line++) document.codeLines.add(line);

				document.codeBlocks.push({
					lang: node.lang ?? null,
					value: node.value ?? '',
					line: start,
					location: nodeRange(node, offset),
					precededByText: previousParagraphText,
				});
				break;
			}

			case 'link': {
				document.links.push({
					text: textOf(node),
					url: node.url ?? '',
					location: nodeRange(node, offset),
				});
				break;
			}

			case 'image': {
				document.images.push({
					alt: node.alt ?? '',
					url: node.url ?? '',
					location: nodeRange(node, offset),
				});
				break;
			}

			case 'table': {
				const rows: string[][] = (node.children ?? []).map((row: any) =>
					(row.children ?? []).map((cell: any) => textOf(cell))
				);
				document.tables.push({
					headers: rows[0] ?? [],
					rows: rows.slice(1),
					location: nodeRange(node, offset),
				});
				break;
			}

			case 'list': {
				document.lists.push({
					ordered: Boolean(node.ordered),
					items: (node.children ?? []).map((item: any) => ({
						text: textOf(item),
						location: nodeRange(item, offset),
					})),
					location: nodeRange(node, offset),
				});
				break;
			}

			default:
				break;
		}
	});

	document.words = document.paragraphs.reduce((sum, paragraph) => sum + paragraph.words, 0);

	return document;
}
