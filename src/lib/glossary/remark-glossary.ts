/**
 * Transformer do glossário sobre o AST de Markdown/MDX (§27).
 *
 * **Por que no AST e não no HTML final.** Uma expressão regular sobre o HTML não
 * sabe distinguir a palavra `OAuth` dentro de um `<code>`, de um `<a>` ou de um
 * `<h2>` — e destacar nesses três lugares é exatamente o que a §14 proíbe. No
 * AST cada nó já diz o que é, e ignorar os errados vira uma condição de três
 * linhas em vez de uma regex impossível de manter.
 *
 * O transformer não injeta HTML: ele troca um nó de texto por uma sequência de
 * nós, sendo os termos nós `glossaryTerm`, que o rehype converte no elemento
 * final. É o que mantém a definição fora do fluxo de HTML cru (§44).
 */

import { visit, SKIP } from 'unist-util-visit';
import type { Root, Text, Parent, RootContent } from 'mdast';
import { findMatches } from './index-build';
import type { GlossaryIndex } from './types';

/**
 * Tipos de nó cujo conteúdo nunca recebe destaque (§14, §15).
 *
 * `heading` está aqui por decisão da §15: um título com termos sublinhados
 * compete com a própria hierarquia da página. `link` está porque o leitor já
 * tem uma ação ali, e duas interações no mesmo texto se atrapalham.
 */
const SKIPPED_PARENTS = new Set([
	'code',
	'inlineCode',
	'link',
	'linkReference',
	'definition',
	'heading',
	'html',
	'mdxjsEsm',
	'mdxFlowExpression',
	'mdxTextExpression',
	'yaml',
	'toml',
	'imageReference',
	'image',
]);

/** Nós JSX cujo conteúdo já é uma referência explícita e não deve ser reprocessado. */
const EXPLICIT_TERM_TAGS = new Set(['GlossaryTerm']);

export interface GlossaryTermNode {
	type: 'glossaryTerm';
	definitionId: string;
	value: string;
	data: {
		hName: string;
		hProperties: Record<string, string>;
		hChildren: Array<{ type: 'text'; value: string }>;
	};
}

/**
 * Texto da tooltip.
 *
 * A definição aceita Markdown limitado (§7.4), mas a tooltip recebe **texto
 * puro**: o conteúdo vai para um atributo e o script o escreve com
 * `textContent`, o que torna impossível uma definição executar script na página
 * (§44). A formatação completa continua na página do termo, onde o pipeline do
 * Astro a renderiza com a sanitização de sempre.
 */
export function toPlainText(definition: string, maxChars = 320): string {
	const flat = definition
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
		.replace(/`([^`]+)`/g, '$1')
		.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => a ?? b)
		.replace(/(?<![\w*])\*([^*\n]+)\*(?![\w*])/g, '$1')
		.replace(/^\s*[-*+]\s+/gm, '')
		.replace(/^#{1,6}\s+/gm, '')
		.replace(/<[^>]*>/g, '')
		.replace(/\s+/g, ' ')
		.trim();

	if (flat.length <= maxChars) return flat;
	return `${flat.slice(0, maxChars).replace(/\s+\S*$/, '')}…`;
}

function termNode(definitionId: string, value: string, term: string, definition: string): GlossaryTermNode {
	return {
		type: 'glossaryTerm',
		definitionId,
		value,
		data: {
			// `data-glossary-*` e não um componente: o elemento precisa existir no
			// HTML estático, e o comportamento é acrescentado por um script único
			// na página, não por um componente por termo.
			hName: 'span',
			hProperties: {
				class: 'glossary-term',
				'data-glossary-id': definitionId,
				'data-glossary-term': term,
				'data-glossary-definition': definition,
				tabindex: '0',
				role: 'button',
				'aria-describedby': `glossary-tooltip-${definitionId}`,
			},
			hChildren: [{ type: 'text', value }],
		},
	};
}

export interface GlossaryTransformOptions {
	index: GlossaryIndex;
	/** `false` no frontmatter da página desliga o glossário nela (§16). */
	enabled?: boolean;
	/** Recebe cada termo encontrado — usado para derivar onde cada um aparece (§21). */
	onMatch?: (definitionId: string) => void;
}

/**
 * Marca as ocorrências de termos do glossário no AST.
 *
 * Devolve os ids encontrados, que é o que permite descobrir em quais páginas um
 * termo aparece sem guardar essa lista no GlossDef (§43).
 */
export function transformGlossary(tree: Root, options: GlossaryTransformOptions): Set<string> {
	const found = new Set<string>();
	if (options.enabled === false || options.index.matchers.length === 0) return found;

	visit(tree, (node, index, parent) => {
		// Um nó ignorado leva os filhos junto: não basta pular o `inlineCode`,
		// é preciso não descer no texto dele.
		if (SKIPPED_PARENTS.has(node.type)) return SKIP;

		if (node.type === 'mdxJsxTextElement' || node.type === 'mdxJsxFlowElement') {
			const name = (node as { name?: string }).name;
			if (name && EXPLICIT_TERM_TAGS.has(name)) return SKIP;
		}

		if (node.type !== 'text' || !parent || index === undefined) return;

		const text = node as Text;
		const matches = findMatches(text.value, options.index);
		if (matches.length === 0) return;

		const replacement: RootContent[] = [];
		let cursor = 0;

		for (const match of matches) {
			if (match.start > cursor) {
				replacement.push({ type: 'text', value: text.value.slice(cursor, match.start) } as Text);
			}
			const definition = options.index.byId.get(match.definitionId);
			replacement.push(
				termNode(
					match.definitionId,
					match.text,
					definition?.term ?? match.text,
					toPlainText(definition?.definition ?? '')
				) as unknown as RootContent
			);
			found.add(match.definitionId);
			cursor = match.end;
		}

		if (cursor < text.value.length) {
			replacement.push({ type: 'text', value: text.value.slice(cursor) } as Text);
		}

		(parent as Parent).children.splice(index, 1, ...replacement);
		// Continua depois do que acabou de ser inserido: reprocessar os nós novos
		// entraria em laço, já que o texto do termo casa com ele mesmo.
		return index + replacement.length;
	});

	return found;
}

/**
 * Plugin remark para o pipeline do Astro.
 *
 * O `glossary: false` do frontmatter (§16) é lido aqui, do arquivo em
 * processamento — é o único ponto do pipeline que conhece a página e o AST ao
 * mesmo tempo.
 */
export function remarkGlossary(options: { index: GlossaryIndex }) {
	return (tree: Root, file: { data?: { astro?: { frontmatter?: Record<string, unknown> } } }) => {
		const frontmatter = file.data?.astro?.frontmatter ?? {};
		transformGlossary(tree, {
			index: options.index,
			enabled: frontmatter.glossary !== false,
		});
	};
}
