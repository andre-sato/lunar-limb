/**
 * Importar um arquivo e convertê-lo em `.mdx` (issue #17).
 *
 * A conversão tem um limite que vale declarar antes de qualquer código: **ela
 * não adivinha o que não está no arquivo.** Um `.txt` não tem título, não tem
 * descrição e não tem estrutura; o que sai é o texto com o frontmatter mínimo
 * que a Starlight exige, e o título vindo do nome do arquivo.
 *
 * Inventar um título a partir do primeiro parágrafo, ou uma descrição a partir
 * do resumo, produziria páginas que parecem prontas e não são — e ninguém revisa
 * o que parece pronto.
 */

export type ImportFormat = 'markdown' | 'text' | 'html';

/** Extensões aceitas, e o que cada uma vira. */
const FORMATS: Record<string, ImportFormat> = {
	md: 'markdown',
	markdown: 'markdown',
	mdx: 'markdown',
	txt: 'text',
	text: 'text',
	html: 'html',
	htm: 'html',
};

export class ImportError extends Error {}

export function formatOf(filename: string): ImportFormat {
	const extension = filename.split('.').pop()?.toLowerCase() ?? '';
	const format = FORMATS[extension];

	if (!format) {
		throw new ImportError(
			`Extensão \`.${extension}\` não é suportada. Aceitas: ${Object.keys(FORMATS).join(', ')}.`
		);
	}

	return format;
}

/**
 * Um nome de arquivo seguro, derivado do original.
 *
 * Acentos viram a letra base e o resto vira hífen. O caminho é sempre relativo e
 * sem `..`: um nome de upload é entrada de fora, e tratá-lo como caminho seria
 * deixar quem envia escolher onde escrever.
 */
export function slugify(filename: string): string {
	const base = filename.replace(/\.[^.]+$/, '');

	const slug = base
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

	if (slug === '') throw new ImportError('O nome do arquivo não produz um caminho válido.');
	return slug;
}

/** Título legível a partir do nome: `guia-de-inicio` → `Guia de inicio`. */
export function titleFrom(filename: string): string {
	const words = slugify(filename).split('-');
	return words
		.map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
		.join(' ');
}

// ---------------------------------------------------------------------------
// Conversão
// ---------------------------------------------------------------------------

/** Tira o frontmatter que o arquivo já trazia, para não duplicar. */
export function stripFrontmatter(content: string): { body: string; existing: Record<string, string> } {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
	if (!match) return { body: content, existing: {} };

	const existing: Record<string, string> = {};
	for (const line of match[1].split(/\r?\n/)) {
		const pair = line.match(/^([a-zA-Z_][\w-]*):\s*(.+)$/);
		if (pair) existing[pair[1]] = pair[2].replace(/^["']|["']$/g, '').trim();
	}

	return { body: content.slice(match[0].length), existing };
}

/**
 * HTML → Markdown, para as marcações que aparecem num documento exportado.
 *
 * Não é um conversor completo, e não tenta ser: o que ele não reconhece vira
 * texto. Um conversor parcial que **remove** o que não entende perderia conteúdo
 * em silêncio, que é o pior desfecho possível para uma importação.
 */
export function htmlToMarkdown(html: string): string {
	let text = html;

	// Fora do fluxo de texto: script e style não são conteúdo.
	text = text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');

	text = text
		.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level: string, inner: string) => `\n${'#'.repeat(Number(level))} ${inner.trim()}\n`)
		.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
		.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, '_$2_')
		.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
		.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, inner: string) => `\n\`\`\`\n${inner.trim()}\n\`\`\`\n`)
		.replace(/<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
		.replace(/<img\b[^>]*alt=["']([^"']*)["'][^>]*src=["']([^"']*)["'][^>]*>/gi, '![$1]($2)')
		.replace(/<img\b[^>]*src=["']([^"']*)["'][^>]*>/gi, '![]($1)')
		.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n')
		.replace(/<\/(p|div|section|article|ul|ol|table|tr)>/gi, '\n\n')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<[^>]+>/g, '');

	// Entidades que sobram de exportação de editor de texto.
	const entities: Record<string, string> = {
		'&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
	};
	text = text.replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (whole) => entities[whole] ?? whole);

	return text.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Chaves e sinais que o MDX interpreta como código.
 *
 * Texto importado não foi escrito para o MDX, e uma chave solta derruba o build
 * da página inteira. Escapar é mais seguro que remover: o leitor vê o caractere
 * que estava no original.
 */
export function escapeForMdx(body: string): string {
	const fences: string[] = [];

	// O conteúdo de bloco de código sai de cena antes do escape e volta depois:
	// dentro dele, chave e `<` são literais e escapá-los estragaria o exemplo.
	const withoutFences = body.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`/g, (block) => {
		fences.push(block);
		return `\u0000${fences.length - 1}\u0000`;
	});

	const escaped = withoutFences.replace(/([{}])/g, '\\$1').replace(/<(?![a-zA-Z/!])/g, '&lt;');

	return escaped.replace(/\u0000(\d+)\u0000/g, (_, index: string) => fences[Number(index)]);
}

export interface ConversionResult {
	/** Caminho relativo sugerido, dentro da collection de destino. */
	path: string;
	content: string;
	format: ImportFormat;
	/** O que a conversão não conseguiu preservar, ou precisa de revisão. */
	notes: string[];
}

export interface ConvertOptions {
	filename: string;
	content: string;
	/** Pasta de destino, relativa à raiz da collection. */
	folder?: string;
}

export function convertToMdx({ filename, content, folder = '' }: ConvertOptions): ConversionResult {
	const format = formatOf(filename);
	const notes: string[] = [];

	const { body: raw, existing } = stripFrontmatter(content);
	if (Object.keys(existing).length > 0) notes.push('O arquivo já tinha frontmatter; título e descrição foram aproveitados.');

	let body = format === 'html' ? htmlToMarkdown(raw) : raw.trim();

	if (format === 'html') notes.push('Conversão de HTML cobre as marcações comuns; confira tabelas e listas aninhadas.');
	if (format === 'text') notes.push('Texto puro não tem estrutura: os títulos precisam ser marcados à mão.');

	body = escapeForMdx(body);

	const title = existing.title || titleFrom(filename);
	const description = existing.description || '';

	if (!existing.description) {
		notes.push('Sem descrição: escreva uma antes de publicar — ela aparece na busca e nos cartões.');
	}

	const frontmatter = [
		'---',
		`title: ${JSON.stringify(title)}`,
		`description: ${JSON.stringify(description)}`,
		'---',
		'',
	].join('\n');

	const slug = slugify(filename);
	const path = folder ? `${folder.replace(/^\/+|\/+$/g, '')}/${slug}.mdx` : `${slug}.mdx`;

	return { path, content: `${frontmatter}\n${body}\n`, format, notes };
}
