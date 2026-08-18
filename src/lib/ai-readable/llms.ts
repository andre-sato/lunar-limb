/**
 * Documentação legível por máquina (§3, §4).
 *
 * Duas saídas, com propósitos diferentes:
 *
 * - **`llms.txt`** é o índice: quem é o portal, como está organizado e onde
 *   está cada coisa. Cabe no contexto de qualquer modelo e serve para decidir
 *   o que buscar em seguida.
 * - **`llms-full.txt`** é o conteúdo inteiro, para quem prefere carregar tudo a
 *   fazer várias buscas.
 *
 * Nenhum dos dois é escrito à mão: os dois são derivados do conteúdo e do
 * Content Graph (§3). Um arquivo mantido à mão descreveria o portal de ontem.
 */

import type { ContentGraph } from '../editor/graph-model';

export interface PageEntry {
	/** Caminho relativo a `src/content/docs`, com `/`. */
	path: string;
	title: string;
	description?: string;
	url: string;
	/** Seção de primeiro nível — a pasta. */
	section: string | null;
	tags: string[];
	body: string;
	/** `false` quando a página está publicada mas fora da navegação. */
	visible: boolean;
	locale: string;
}

export interface GlossaryEntry {
	id: string;
	term: string;
	aliases: string[];
	definition: string;
}

export interface ApiEntry {
	title: string;
	/** Caminho da página gerada no portal, quando existe. */
	url?: string;
	operations: Array<{ method: string; path: string; summary?: string }>;
}

export interface LlmsInput {
	siteName: string;
	description: string;
	siteUrl: string;
	pages: readonly PageEntry[];
	glossary: readonly GlossaryEntry[];
	api?: readonly ApiEntry[];
	graph?: ContentGraph;
	/** Rótulos das seções, para o índice não mostrar nomes de pasta. */
	sectionLabels?: Record<string, string>;
}

/** Ordem das seções no índice; o resto vem depois, em ordem alfabética. */
const SECTION_ORDER = ['guides', 'api-reference', 'changelog', 'reference'];

function absolute(siteUrl: string, path: string): string {
	return `${siteUrl.replace(/\/$/, '')}${path}`;
}

function sortSections(sections: string[]): string[] {
	return sections.sort((left, right) => {
		const leftIndex = SECTION_ORDER.indexOf(left);
		const rightIndex = SECTION_ORDER.indexOf(right);
		if (leftIndex !== -1 && rightIndex !== -1) return leftIndex - rightIndex;
		if (leftIndex !== -1) return -1;
		if (rightIndex !== -1) return 1;
		return left.localeCompare(right);
	});
}

/** Só o idioma raiz entra: as traduções repetiriam o mesmo conteúdo. */
function rootPages(pages: readonly PageEntry[]): PageEntry[] {
	return pages.filter((page) => page.locale === 'pt-BR' && page.visible);
}

function group(pages: readonly PageEntry[]): Map<string, PageEntry[]> {
	const sections = new Map<string, PageEntry[]>();
	for (const page of pages) {
		const key = page.section ?? '';
		const list = sections.get(key) ?? [];
		list.push(page);
		sections.set(key, list);
	}
	for (const list of sections.values()) {
		list.sort((left, right) => left.title.localeCompare(right.title, 'pt-BR'));
	}
	return sections;
}

/**
 * O índice (`/llms.txt`).
 *
 * Segue a convenção do formato: um `#` com o nome, uma linha de resumo em
 * itálico, e listas de links com uma frase cada. O que é específico deste
 * portal — glossário e API — entra como seção própria, porque um agente que
 * saiba que existe glossário faz uma pergunta melhor.
 */
export function buildLlmsTxt(input: LlmsInput): string {
	const pages = rootPages(input.pages);
	const sections = group(pages);
	const lines: string[] = [`# ${input.siteName}`, ''];

	if (input.description) lines.push(`> ${input.description}`, '');

	lines.push(
		'Documentação para desenvolvedores. Cada página desta lista também está',
		'disponível em Markdown limpo: troque o início do caminho por `/md/` e',
		'acrescente `.md` — `/guides/getting-started/` vira',
		`\`${absolute(input.siteUrl, '/md/guides/getting-started.md')}\`.`,
		''
	);

	for (const section of sortSections([...sections.keys()].filter(Boolean))) {
		const label = input.sectionLabels?.[section] ?? section;
		lines.push(`## ${label}`, '');

		for (const page of sections.get(section) ?? []) {
			const summary = page.description ? `: ${page.description}` : '';
			lines.push(`- [${page.title}](${absolute(input.siteUrl, page.url)})${summary}`);
		}
		lines.push('');
	}

	// Páginas sem seção (a capa e o que estiver na raiz).
	const loose = sections.get('') ?? [];
	if (loose.length > 0) {
		lines.push('## Outras páginas', '');
		for (const page of loose) {
			lines.push(`- [${page.title}](${absolute(input.siteUrl, page.url)})`);
		}
		lines.push('');
	}

	if (input.glossary.length > 0) {
		lines.push('## Glossário', '');
		lines.push(
			`Terminologia canônica do portal, com ${input.glossary.length} termos:`,
			`${absolute(input.siteUrl, '/glossary/')}`,
			''
		);
		for (const term of [...input.glossary].sort((left, right) => left.term.localeCompare(right.term))) {
			const aliases = term.aliases.length > 0 ? ` (também: ${term.aliases.join(', ')})` : '';
			lines.push(`- **${term.term}**${aliases} — ${firstSentence(term.definition)}`);
		}
		lines.push('');
	}

	if (input.api && input.api.length > 0) {
		lines.push('## API', '');
		for (const api of input.api) {
			lines.push(`### ${api.title}`, '');
			for (const operation of api.operations) {
				const summary = operation.summary ? ` — ${operation.summary}` : '';
				lines.push(`- \`${operation.method.toUpperCase()} ${operation.path}\`${summary}`);
			}
			lines.push('');
		}
	}

	// O grafo responde "o que mais muda se isto mudar" — informação que um
	// agente não teria como derivar lendo as páginas uma a uma.
	const reusable = input.graph?.nodes.filter((node) => node.type === 'block') ?? [];
	if (reusable.length > 0) {
		lines.push('## Conteúdo reutilizável', '');
		lines.push('Blocos incluídos por várias páginas; alterá-los muda todas elas.', '');
		for (const block of reusable) {
			const consumers =
				input.graph?.edges.filter((edge) => edge.refType === 'block' && edge.target === block.id) ?? [];
			lines.push(`- \`${block.id}\` — usado por ${consumers.length} página(s)`);
		}
		lines.push('');
	}

	return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

/** O conteúdo inteiro (`/llms-full.txt`). */
export function buildLlmsFullTxt(input: LlmsInput): string {
	const pages = rootPages(input.pages);
	const lines: string[] = [`# ${input.siteName}`, ''];

	if (input.description) lines.push(`> ${input.description}`, '');
	lines.push(
		`Conteúdo completo de ${pages.length} páginas. Cada uma começa com o caminho`,
		'e a URL de origem, para a citação apontar o lugar certo.',
		'',
		'---',
		''
	);

	const sections = group(pages);
	for (const section of sortSections([...sections.keys()])) {
		for (const page of sections.get(section) ?? []) {
			lines.push(
				`# ${page.title}`,
				'',
				`URL: ${absolute(input.siteUrl, page.url)}`,
				`Arquivo: ${page.path}`
			);
			if (page.tags.length > 0) lines.push(`Tags: ${page.tags.join(', ')}`);
			lines.push('', page.body.trim(), '', '---', '');
		}
	}

	if (input.glossary.length > 0) {
		lines.push('# Glossário', '');
		for (const term of [...input.glossary].sort((left, right) => left.term.localeCompare(right.term))) {
			lines.push(`## ${term.term}`, '');
			if (term.aliases.length > 0) lines.push(`Também: ${term.aliases.join(', ')}`, '');
			lines.push(term.definition.trim(), '');
		}
	}

	return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

function firstSentence(text: string): string {
	const flat = text.replace(/\s+/g, ' ').trim();
	const match = flat.match(/^(.+?[.!?])(?:\s|$)/);
	const sentence = match ? match[1] : flat;
	return sentence.length > 160 ? `${sentence.slice(0, 157).trimEnd()}…` : sentence;
}

/**
 * Markdown limpo de uma página (§4).
 *
 * Tira o que é só visual: imports de MDX, componentes de layout e diretivas de
 * aside viram texto normal. O objetivo é o conteúdo que a pessoa leria, sem a
 * marcação que só existe para a página ficar bonita.
 *
 * O que **não** é removido: o texto dentro de um aside ou de um componente. Ele
 * é conteúdo, e descartá-lo entregaria uma versão incompleta da página.
 */
export function toCleanMarkdown(page: PageEntry, siteUrl: string): string {
	const body = page.body
		// `import`/`export` de MDX são maquinário do arquivo.
		.replace(/^\s*(?:import|export)\s.+$/gm, '')
		// `:::note[Título]` … `:::` vira um parágrafo com o título em negrito.
		.replace(/^:::(\w+)(?:\[([^\]]*)\])?\s*$/gm, (_, kind: string, title: string | undefined) =>
			title ? `**${title}**` : `**${kind}**`
		)
		.replace(/^:::\s*$/gm, '')
		// Componente sem filhos (`<Diagrama />`) não tem texto a preservar.
		.replace(/^\s*<([A-Z][\w.]*)[^>]*\/>\s*$/gm, '')
		// Tag de abertura e fechamento de componente saem; o conteúdo fica.
		.replace(/^\s*<\/?[A-Z][\w.]*[^>]*>\s*$/gm, '')
		.replace(/\n{3,}/g, '\n\n')
		.trim();

	const header = [`# ${page.title}`, ''];
	if (page.description) header.push(`> ${page.description}`, '');
	header.push(`Origem: ${absolute(siteUrl, page.url)}`, '');
	if (page.tags.length > 0) header.push(`Tags: ${page.tags.join(', ')}`, '');
	header.push('---', '');

	return `${header.join('\n')}${body}\n`;
}
