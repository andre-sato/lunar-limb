/**
 * Retrieval da documentação (§7–§9, §40).
 *
 * A busca é **léxica**, não vetorial. Duas razões:
 *
 *  1. Não exige chave de embedding: o RAG funciona antes de o portal ter
 *     qualquer credencial de LLM configurada, e o modo só-retrieval continua
 *     útil sozinho.
 *  2. O vocabulário de um portal de documentação é fechado e técnico — quem
 *     pergunta "como autenticar" usa as mesmas palavras que a página. É onde
 *     BM25 rende quase o mesmo que embedding, por uma fração da complexidade.
 *
 * A troca por busca vetorial cabe atrás desta mesma função, sem tocar o resto
 * do pipeline.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { CONTENT_ROOTS } from '../editor/content-fs';
import { getContentGraph } from '../editor/content-graph';
import type { DocumentChunk, RetrievedChunk, SourceReference } from './types';

const STOPWORDS = new Set([
	// pt-BR
	'a','o','as','os','um','uma','de','do','da','dos','das','em','no','na','nos','nas','por','para','com','sem','que',
	'e','ou','se','ao','à','às','aos','como','qual','quais','quando','onde','porque','pra','pro','é','são','ser','está',
	'estão','seu','sua','seus','suas','este','esta','isso','meu','minha','eu','você','voce','me','fazer','faço','posso',
	// en
	'the','a','an','of','in','on','at','to','for','with','without','and','or','if','how','what','which','when','where',
	'why','is','are','be','was','were','do','does','did','can','could','should','would','my','your','i','you','it','this',
	'that','from','by','as','about','into','get','use','using',
]);

/**
 * Divide o texto em tokens, dobrando os acentos.
 *
 * Sem dobrar, `autenticação` no texto e `autenticacao` na tag são tokens
 * diferentes, e a tag nunca casa com a página que ela descreve. Dobrar também
 * resolve o leitor que digita sem acento, que é a maioria.
 */
/**
 * Sufixos que separam formas da mesma palavra.
 *
 * Sem isto, `autenticar` (como o leitor pergunta), `autenticação` (como a
 * página escreve) e `autenticacao` (como a tag é escrita) são três tokens sem
 * relação, e a tag não serve para nada. Reduzidos, viram `autentic`.
 *
 * A lista é curta e conservadora, e só se aplica a palavras longas: cortar
 * sufixo de palavra curta junta coisas que não têm parentesco. Não é um
 * stemmer completo — é o mínimo que faz as tags casarem com o texto.
 */
// Do mais longo para o mais curto: `autenticacao` precisa perder `acao`
// inteiro para chegar em `autentic`, que é onde `autenticar` também chega.
// Cortando só `cao`, sobraria `autentica` e as duas formas não se encontrariam.
const SUFFIXES = [
	'acoes', 'acao', 'coes', 'cao',
	'mentos', 'mento', 'ndo', 'veis', 'vel',
	'ares', 'ar', 'er', 'ir',
	'adas', 'ada', 'ados', 'ado', 'idas', 'ida', 'idos', 'ido',
	'es', 's',
];

/** Menor tamanho que sobra depois de cortar: abaixo disso o corte não vale. */
const MIN_STEM = 4;

export function stem(token: string): string {
	if (token.length < 6) return token;

	for (const suffix of SUFFIXES) {
		if (token.endsWith(suffix) && token.length - suffix.length >= MIN_STEM) {
			return token.slice(0, -suffix.length);
		}
	}

	return token;
}

export function tokenize(text: string): string[] {
	const folded = text
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '');

	return (folded.match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) ?? [])
		.filter((token) => token.length > 1 && !STOPWORDS.has(token))
		.map(stem);
}

/** Remove frontmatter e ruído de marcação, preservando o texto legível. */
function stripMarkup(raw: string): string {
	return raw
		.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
		.replace(/^import\s.+$/gm, '')
		.replace(/^export\s.+$/gm, '')
		.replace(/\r/g, '');
}

/**
 * Tags do frontmatter.
 *
 * Aceita as duas formas que o YAML permite — `tags: [a, b]` e a lista com
 * hífens —, porque as duas aparecem em documentação escrita à mão.
 */
export function readFrontmatterTags(raw: string): string[] {
	const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return [];

	const front = match[1];

	const inline = front.match(/^tags:\s*\[(.*?)\]/m);
	if (inline) {
		return inline[1]
			.split(',')
			.map((tag) => tag.trim().replace(/^["']|["']$/g, ''))
			.filter(Boolean);
	}

	const block = front.match(/^tags:\s*\n((?:[ \t]*-[ \t]*.+\n?)+)/m);
	if (block) {
		return block[1]
			.split('\n')
			.map((line) => line.replace(/^[ \t]*-[ \t]*/, '').trim().replace(/^["']|["']$/g, ''))
			.filter(Boolean);
	}

	return [];
}

function readFrontmatterTitle(raw: string): string | null {
	const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return null;
	const title = match[1].match(/^title:\s*(.+)$/m);
	if (!title) return null;
	return title[1].trim().replace(/^["']|["']$/g, '');
}

/** URL pública da página a partir do caminho relativo em `content/docs`. */
export function urlForPath(relativePath: string): string {
	const withoutExtension = relativePath.replace(/\.mdx?$/, '').replace(/\\/g, '/');
	// `(?:^|\/)` e não `\/index$`: `index.mdx` na raiz não tem barra à esquerda,
	// e sem isso a home saía como `/index/`.
	const slug = withoutExtension.replace(/(?:^|\/)index$/, '');
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

/**
 * Divide um documento em fragmentos por título.
 *
 * O título da seção viaja com o fragmento porque é o melhor sinal de
 * relevância que existe num texto técnico — e é o que a citação precisa para
 * apontar o lugar certo, em vez de só a página.
 */
export function chunkDocument(
	relativePath: string,
	raw: string,
	kind: 'page' | 'snippet'
): DocumentChunk[] {
	const title = readFrontmatterTitle(raw) ?? relativePath.replace(/\.mdx?$/, '');
	const tags = readFrontmatterTags(raw);
	const body = stripMarkup(raw);
	const url = urlForPath(relativePath);

	const chunks: DocumentChunk[] = [];
	const lines = body.split('\n');

	let currentHeading: string | undefined;
	let buffer: string[] = [];
	let index = 0;
	let insideCodeFence = false;

	function flush() {
		const content = buffer.join('\n').trim();
		buffer = [];
		// Descarta apenas seção vazia ou de resto de formatação. O limiar não
		// pode ser alto: "As chaves expiram em 90 dias." é curto e é exatamente
		// o tipo de fato que se pergunta ao assistente.
		if (content.length < 12) return;
		chunks.push({
			id: `${relativePath}#${index++}`,
			documentId: relativePath,
			path: relativePath,
			title,
			heading: currentHeading,
			content,
			url: currentHeading ? `${url}#${slugify(currentHeading)}` : url,
			kind,
			tags,
		});
	}

	for (const line of lines) {
		// Um `#` dentro de bloco de código é comentário, não título.
		if (/^\s*(?:```|~~~)/.test(line)) insideCodeFence = !insideCodeFence;

		const heading = !insideCodeFence ? line.match(/^(#{1,6})\s+(.+)$/) : null;
		if (heading) {
			flush();
			currentHeading = heading[2].trim();
			continue;
		}
		buffer.push(line);

		// Fragmento grande demais dilui a relevância: quebra-se em pedaços
		// legíveis mesmo sem título novo.
		if (buffer.join('\n').length > 1800) flush();
	}
	flush();

	return chunks;
}

function slugify(text: string): string {
	return text
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

// ---------------------------------------------------------------------------
// Índice
// ---------------------------------------------------------------------------

interface Index {
	chunks: DocumentChunk[];
	/** token → nº de fragmentos que o contêm, para o IDF. */
	documentFrequency: Map<string, number>;
	chunkTokens: Map<string, string[]>;
	averageLength: number;
	builtAt: number;
}

let cached: Index | null = null;
const CACHE_TTL_MS = 60_000;

export function invalidateChatIndex(): void {
	cached = null;
}

export async function buildIndex(): Promise<Index> {
	if (cached && Date.now() - cached.builtAt < CACHE_TTL_MS) return cached;

	const chunks: DocumentChunk[] = [];

	for (const [kind, root] of [
		['page', CONTENT_ROOTS.docs],
		['snippet', CONTENT_ROOTS.snippets],
	] as const) {
		for (const relative of await walk(root)) {
			try {
				const raw = await readFile(path.resolve(root, relative), 'utf8');
				chunks.push(...chunkDocument(relative, raw, kind));
			} catch {
				// Arquivo removido entre a listagem e a leitura.
			}
		}
	}

	const documentFrequency = new Map<string, number>();
	const chunkTokens = new Map<string, string[]>();
	let totalLength = 0;

	for (const chunk of chunks) {
		// As tags entram no índice: uma pergunta com o nome do assunto passa a
		// casar com a página mesmo que a palavra não apareça no texto dela.
		const tokens = tokenize(`${chunk.title} ${chunk.heading ?? ''} ${(chunk.tags ?? []).join(' ')} ${chunk.content}`);
		chunkTokens.set(chunk.id, tokens);
		totalLength += tokens.length;
		for (const token of new Set(tokens)) {
			documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
		}
	}

	cached = {
		chunks,
		documentFrequency,
		chunkTokens,
		averageLength: chunks.length > 0 ? totalLength / chunks.length : 1,
		builtAt: Date.now(),
	};
	return cached;
}

// ---------------------------------------------------------------------------
// Busca
// ---------------------------------------------------------------------------

export interface RetrieveOptions {
	/** Relevância mínima, 0–1 (§40). */
	threshold?: number;
	/** Teto de fragmentos enviados ao modelo (§39). */
	maxChunks?: number;
	/**
	 * Idioma do leitor. Sem ele, as traduções da mesma página competem entre si
	 * e ocupam metade dos fragmentos com o mesmo conteúdo em três línguas —
	 * gasta orçamento de contexto e enche a lista de fontes de repetição.
	 */
	locale?: string;
}

/** Idiomas com pasta própria em `content/docs`. O resto é o idioma padrão. */
const TRANSLATED_LOCALES = ['en', 'es'] as const;

/** Idioma de um fragmento, a partir do prefixo do caminho. */
export function localeOfPath(relativePath: string): string {
	const first = relativePath.split('/')[0];
	return (TRANSLATED_LOCALES as readonly string[]).includes(first) ? first : 'default';
}

export function normalizeLocale(locale: string | undefined): string {
	if (!locale) return 'default';
	const lower = locale.toLowerCase();
	const match = TRANSLATED_LOCALES.find((candidate) => lower === candidate || lower.startsWith(`${candidate}-`));
	return match ?? 'default';
}

const K1 = 1.5;
const B = 0.75;

/**
 * BM25 com reforço de título e de heading.
 *
 * O score é normalizado para 0–1 dividindo pelo melhor resultado da própria
 * consulta. Isso é proposital: o valor absoluto de BM25 não tem escala
 * comparável entre consultas, e o threshold da §40 precisa significar "quão
 * bom em relação ao melhor que existe", não um número arbitrário.
 */
export async function retrieveDocumentation(
	query: string,
	options: RetrieveOptions = {}
): Promise<RetrievedChunk[]> {
	const threshold = options.threshold ?? 0.35;
	const maxChunks = options.maxChunks ?? 6;

	const index = await buildIndex();
	const queryTokens = tokenize(query);
	if (queryTokens.length === 0 || index.chunks.length === 0) return [];

	const locale = normalizeLocale(options.locale);
	const total = index.chunks.length;
	const scored: Array<{ chunk: DocumentChunk; score: number }> = [];

	for (const chunk of index.chunks) {
		// Fragmento de outro idioma sai antes de pontuar. Blocos reutilizáveis
		// não têm pasta de idioma e servem a todos, então ficam sempre.
		if (chunk.kind === 'page' && localeOfPath(chunk.path) !== locale) continue;

		const tokens = index.chunkTokens.get(chunk.id) ?? [];
		if (tokens.length === 0) continue;

		const counts = new Map<string, number>();
		for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);

		const titleTokens = new Set(tokenize(`${chunk.title} ${chunk.heading ?? ''} ${(chunk.tags ?? []).join(' ')}`));

		let score = 0;
		for (const token of queryTokens) {
			const frequency = counts.get(token);
			if (!frequency) continue;

			const df = index.documentFrequency.get(token) ?? 1;
			const idf = Math.log(1 + (total - df + 0.5) / (df + 0.5));
			const normalization = frequency + K1 * (1 - B + (B * tokens.length) / index.averageLength);
			let contribution = idf * ((frequency * (K1 + 1)) / normalization);

			// Casar no título ou no heading vale mais: é onde o assunto da
			// seção está declarado.
			if (titleTokens.has(token)) contribution *= 2.2;

			score += contribution;
		}

		if (score > 0) scored.push({ chunk, score });
	}

	if (scored.length === 0) return [];

	scored.sort((a, b) => b.score - a.score);
	const best = scored[0].score;

	const normalized = scored
		.map(({ chunk, score }) => ({ ...chunk, score: best > 0 ? score / best : 0 }))
		.filter((chunk) => chunk.score >= threshold)
		.slice(0, maxChunks);

	return attachConsumers(normalized);
}

/**
 * Liga blocos reutilizáveis às páginas que os consomem (§9).
 *
 * Sem isto, um trecho vindo de `snippets/rate-limit.md` seria citado como uma
 * "página" que o leitor não encontra na navegação — o bloco não tem URL
 * própria. A citação passa a apontar para as páginas onde o texto aparece.
 */
async function attachConsumers(chunks: RetrievedChunk[]): Promise<RetrievedChunk[]> {
	const snippets = chunks.filter((chunk) => chunk.kind === 'snippet');
	if (snippets.length === 0) return chunks;

	try {
		const graph = await getContentGraph();

		return chunks.map((chunk) => {
			if (chunk.kind !== 'snippet') return chunk;

			const id = chunk.documentId.replace(/\.mdx?$/, '');
			const consumers = graph.edges
				.filter((edge) => edge.target === id)
				.map((edge) => graph.nodes.find((node) => node.key === edge.source))
				.filter((node): node is NonNullable<typeof node> => Boolean(node) && node!.root === 'docs')
				.map((node) => node.path);

			return { ...chunk, usedBy: [...new Set(consumers)] };
		});
	} catch {
		return chunks;
	}
}

/** Converte fragmentos em citações, uma por página, sem repetir destino. */
export function toSourceReferences(chunks: readonly RetrievedChunk[]): SourceReference[] {
	const byUrl = new Map<string, SourceReference>();

	for (const chunk of chunks) {
		// Bloco reutilizável cita as páginas consumidoras, não a si mesmo.
		if (chunk.kind === 'snippet' && chunk.usedBy && chunk.usedBy.length > 0) {
			for (const consumer of chunk.usedBy) {
				const url = urlForPath(consumer);
				if (byUrl.has(url)) continue;
				byUrl.set(url, {
					documentId: consumer,
					url,
					title: consumer.replace(/\.mdx?$/, ''),
					relevance: chunk.score,
				});
			}
			continue;
		}

		if (chunk.kind === 'snippet') continue;

		const existing = byUrl.get(chunk.url);
		if (existing) {
			existing.relevance = Math.max(existing.relevance, chunk.score);
			continue;
		}

		byUrl.set(chunk.url, {
			documentId: chunk.documentId,
			url: chunk.url,
			title: chunk.heading ? `${chunk.title} — ${chunk.heading}` : chunk.title,
			relevance: chunk.score,
		});
	}

	return [...byUrl.values()].sort((a, b) => b.relevance - a.relevance);
}
