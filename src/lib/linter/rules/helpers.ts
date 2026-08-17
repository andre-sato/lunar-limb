/**
 * Utilitários compartilhados pelas regras.
 *
 * O papel central é `scanProse`: aplica uma expressão regular ao texto corrido
 * e devolve a posição **real no arquivo** de cada ocorrência. Sem isso, cada
 * regra teria de refazer o mapeamento offset→linha/coluna, e é exatamente aí
 * que marcadores no editor saem do lugar.
 *
 * Blocos e trechos de código nunca chegam aqui: o parser só coloca texto
 * corrido em `document.prose`.
 */

import type { ParsedDocument, PositionedText } from '../parse';
import type { SourceRange } from '../types';

export interface ProseMatch {
	match: RegExpExecArray;
	text: string;
	location: SourceRange;
}

export function scanText(segment: PositionedText, pattern: RegExp): ProseMatch[] {
	const results: ProseMatch[] = [];
	const regex = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);

	let match: RegExpExecArray | null;
	while ((match = regex.exec(segment.text)) !== null) {
		// Padrão que casa vazio avançaria para sempre no mesmo ponto.
		if (match[0].length === 0) {
			regex.lastIndex++;
			continue;
		}

		const startIndex = match.index;
		const endIndex = match.index + match[0].length - 1;
		const start = segment.map[Math.min(startIndex, segment.map.length - 1)];
		const end = segment.map[Math.min(endIndex, segment.map.length - 1)];
		if (!start || !end) continue;

		results.push({
			match,
			text: match[0],
			location: {
				startLine: start.line,
				startColumn: start.column,
				endLine: end.line,
				endColumn: end.column + 1,
			},
		});
	}

	return results;
}

export function scanProse(document: ParsedDocument, pattern: RegExp): ProseMatch[] {
	return document.prose.flatMap((segment) => scanText(segment, pattern));
}

/**
 * Varre as linhas cruas do arquivo, pulando frontmatter e blocos de código.
 *
 * Regras sobre **formatação do arquivo** (espaço duplicado, espaço antes de
 * pontuação) precisam ler o texto como ele foi escrito. Rodá-las sobre o
 * buffer reconstruído de `prose` faria a marcação entre nós inline virar
 * espaço e produzir dezenas de acusações falsas — uma frase com `**negrito**`
 * no meio passaria a "ter" espaços que o autor nunca digitou.
 */
export function scanLines(document: ParsedDocument, pattern: RegExp): ProseMatch[] {
	const results: ProseMatch[] = [];
	const regex = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);

	document.lines.forEach((text, index) => {
		const line = index + 1;
		if (line <= document.frontmatterLines) return;
		if (document.codeLines.has(line)) return;
		// Tabelas usam espaçamento para alinhar colunas; cobrar espaço simples
		// ali seria pedir que o autor desalinhe a tabela.
		if (/^\s*\|/.test(text)) return;

		regex.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = regex.exec(text)) !== null) {
			if (match[0].length === 0) {
				regex.lastIndex++;
				continue;
			}
			results.push({
				match,
				text: match[0],
				location: {
					startLine: line,
					startColumn: match.index + 1,
					endLine: line,
					endColumn: match.index + match[0].length + 1,
				},
			});
		}
	});

	return results;
}

/** Escapa um termo para uso literal dentro de regex. */
export function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Monta um padrão de lista de termos com fronteira de palavra que funciona com
 * acentuação.
 *
 * `\b` do JavaScript trata letra acentuada como fronteira, então `\bbasta\b`
 * casaria dentro de "bastante". As asserções por classe de caractere Unicode
 * evitam esse falso positivo.
 */
export function termsPattern(terms: readonly string[], flags = 'giu'): RegExp | null {
	const cleaned = terms.filter((term) => term.trim() !== '').map((term) => escapeRegex(term.trim()));
	if (cleaned.length === 0) return null;
	return new RegExp(`(?<![\\p{L}\\p{N}])(?:${cleaned.join('|')})(?![\\p{L}\\p{N}])`, flags);
}

export function locationOfLine(line: number, column = 1): SourceRange {
	return { startLine: line, startColumn: column, endLine: line, endColumn: column + 1 };
}

/** Contagem aproximada de sílabas, usada nas métricas de legibilidade. */
export function countSyllables(word: string, language: 'pt-BR' | 'en' | 'es'): number {
	const normalized = word.toLowerCase().replace(/[^\p{L}]/gu, '');
	if (normalized.length === 0) return 0;

	if (language === 'en') {
		// Heurística clássica: grupos de vogais, com o `e` final mudo descontado.
		const groups = normalized.replace(/e$/, '').match(/[aeiouy]+/g);
		return Math.max(1, groups ? groups.length : 1);
	}

	// Português e espanhol são quase silábicos: grupos vocálicos aproximam bem.
	const groups = normalized.match(/[aeiouáàâãéêíóôõúü]+/g);
	return Math.max(1, groups ? groups.length : 1);
}

export function words(text: string): string[] {
	return text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
}

/** Trecho curto do texto para exibir na mensagem, sem estourar a interface. */
export function excerpt(text: string, max = 60): string {
	const normalized = text.replace(/\s+/g, ' ').trim();
	return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}
