/**
 * Resumo do que a busca encontrou.
 *
 * Sem modelo de linguagem, não existe parafrasear: qualquer frase que não esteja
 * na documentação seria invenção. Então o resumo é **extrativo** — a primeira
 * frase útil do trecho mais relevante, citada como citação, com a origem
 * declarada. O leitor sabe que aquilo é texto da página, não uma conclusão que
 * alguém tirou por ele.
 *
 * O critério do que serve como frase de resumo é o que exclui:
 *
 * - linha de código, tabela, lista e título não resumem nada fora de contexto;
 * - frase curta demais ("Veja também.") não informa;
 * - frase que é só um link ou uma diretiva de MDX é maquinário da página.
 *
 * Não havendo nenhuma frase que sirva, o resumo vira o enquadramento simples
 * ("Encontrei 3 trechos…"). Dizer menos é melhor que dizer errado.
 */

import type { Excerpt } from './types';

/** Comprimento alvo do resumo. Acima disto ele deixa de ser resumo. */
const MAX_SUMMARY_CHARS = 240;
const MIN_SENTENCE_CHARS = 40;

/** Linhas que não servem como frase de resumo. */
function isProseLine(line: string): boolean {
	const trimmed = line.trim();
	if (trimmed === '') return false;
	if (/^(?:#{1,6}\s|>\s|[-*+]\s|\d+[.)]\s)/.test(trimmed)) return false; // título, citação, lista
	if (/^\|/.test(trimmed) || /^:{3}/.test(trimmed)) return false; // tabela, aside
	if (/^(?:import\s|export\s|<)/.test(trimmed)) return false; // MDX, HTML
	if (/^\[[^\]]+\]\([^)]+\)$/.test(trimmed)) return false; // linha que é só um link
	return true;
}

/**
 * Junta as linhas de cada parágrafo.
 *
 * O Markdown do repositório é quebrado em ~80 colunas, então uma frase quase
 * nunca cabe numa linha. Extrair a frase linha a linha produzia resumos
 * truncados no meio — "mude o status para" —, o que apareceu ao rodar sobre a
 * documentação real, não nos testes.
 *
 * O bloco de código precisa de estado, e não de teste linha a linha: pular só a
 * linha da cerca e avaliar as de dentro faz um `curl` virar resumo.
 */
function paragraphsOf(text: string): string[] {
	const paragraphs: string[] = [];
	let current: string[] = [];
	let insideFence = false;

	const flush = () => {
		if (current.length > 0) {
			paragraphs.push(current.join(' ').replace(/\s+/g, ' ').trim());
			current = [];
		}
	};

	for (const line of text.split('\n')) {
		if (/^\s*(?:```|~~~)/.test(line)) {
			flush();
			insideFence = !insideFence;
			continue;
		}
		if (insideFence) continue;

		// Linha que não é prosa encerra o parágrafo em vez de entrar nele.
		if (!isProseLine(line)) {
			flush();
			continue;
		}
		current.push(line.trim());
	}

	flush();
	return paragraphs;
}

/**
 * Tira a marcação inline da frase citada.
 *
 * O resumo é mostrado como texto puro, então `**Inativo**` apareceria com os
 * asteriscos. Só os marcadores caem — as palavras são as mesmas do documento, o
 * que mantém a citação uma citação.
 */
function stripInlineMarkup(text: string): string {
	return text
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // imagem: fica o texto alternativo
		.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // link: fica o rótulo
		.replace(/`([^`]+)`/g, '$1') // código inline
		.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => a ?? b) // negrito
		.replace(/(?<![\w*])\*([^*\n]+)\*(?![\w*])/g, '$1') // itálico
		.replace(/\s+/g, ' ')
		.trim();
}

/** Primeira frase aproveitável do texto, respeitando abreviação. */
export function firstSentence(text: string): string | null {
	for (const clean of paragraphsOf(text)) {
		// O ponto final só termina a frase se vier seguido de espaço e maiúscula,
		// ou do fim da linha: "req/min." e "ex." não terminam frase.
		const match = clean.match(/^(.+?[.!?])(?:\s+[A-ZÀ-Þ0-9]|$)/);
		const sentence = stripInlineMarkup(match ? match[1] : clean);

		if (sentence.length < MIN_SENTENCE_CHARS) continue;
		return sentence.length > MAX_SUMMARY_CHARS
			? `${sentence.slice(0, MAX_SUMMARY_CHARS).replace(/\s+\S*$/, '')}…`
			: sentence;
	}

	return null;
}

/** Onde o trecho foi encontrado, para o leitor conferir. */
function originOf(excerpt: Excerpt): string {
	return excerpt.section ? `${excerpt.title} — ${excerpt.section}` : excerpt.title;
}

function countPhrase(excerpts: readonly Excerpt[]): string {
	const pages = new Set(excerpts.map((excerpt) => excerpt.path)).size;
	const trechos = excerpts.length === 1 ? '1 trecho' : `${excerpts.length} trechos`;
	const paginas = pages === 1 ? '1 página' : `${pages} páginas`;
	return `${trechos} de ${paginas}`;
}

/**
 * Monta o primeiro parágrafo da resposta.
 *
 * A busca ordena por relevância, então o primeiro trecho é o candidato natural.
 * Se ele não tiver prosa aproveitável — é uma tabela de erros, um exemplo de
 * código —, o resumo procura no seguinte, em vez de desistir.
 */
export function summarize(excerpts: readonly Excerpt[]): string {
	if (excerpts.length === 0) return '';

	for (const excerpt of excerpts) {
		const sentence = firstSentence(excerpt.text);
		if (!sentence) continue;

		return `Em ${originOf(excerpt)}: "${sentence}" Abaixo, ${countPhrase(excerpts)}.`;
	}

	return `Encontrei ${countPhrase(excerpts)}.`;
}
