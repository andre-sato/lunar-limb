/**
 * Legibilidade, acionabilidade e preparo para consumo por agentes de IA.
 */

import type { LintRule, LintLanguage } from '../types';
import type { ParsedDocument } from '../parse';
import { locationOfLine, countSyllables, words, excerpt } from './helpers';

export interface ReadabilityMetrics {
	sentences: number;
	words: number;
	syllables: number;
	averageSentenceWords: number;
	averageSyllablesPerWord: number;
	/** Índice normalizado 0–100; quanto maior, mais fácil de ler. */
	readingEase: number;
}

/**
 * Índice de facilidade de leitura.
 *
 * Para inglês, Flesch Reading Ease. Para português, a adaptação de Martins et
 * al., que recalibra as constantes para a estrutura silábica da língua —
 * aplicar a fórmula inglesa ao português subestima a legibilidade de forma
 * sistemática. Espanhol usa a adaptação de Fernández Huerta.
 *
 * A §27 é explícita: a legibilidade nunca deve dominar a nota. Documentação
 * técnica tem termos longos por necessidade.
 */
export function computeReadability(document: ParsedDocument, language: LintLanguage): ReadabilityMetrics {
	const sentences = document.paragraphs.flatMap((paragraph) => paragraph.sentences);
	const allWords = sentences.flatMap((sentence) => words(sentence.text));

	const sentenceCount = Math.max(1, sentences.length);
	const wordCount = Math.max(1, allWords.length);
	const syllableCount = allWords.reduce((sum, word) => sum + countSyllables(word, language), 0);

	const averageSentenceWords = wordCount / sentenceCount;
	const averageSyllablesPerWord = syllableCount / wordCount;

	let readingEase: number;
	if (language === 'en') {
		readingEase = 206.835 - 1.015 * averageSentenceWords - 84.6 * averageSyllablesPerWord;
	} else if (language === 'es') {
		readingEase = 206.84 - 1.02 * averageSentenceWords - 60 * averageSyllablesPerWord;
	} else {
		readingEase = 248.835 - 1.015 * averageSentenceWords - 84.6 * averageSyllablesPerWord;
	}

	return {
		sentences: sentences.length,
		words: allWords.length,
		syllables: syllableCount,
		averageSentenceWords,
		averageSyllablesPerWord,
		readingEase: Math.max(0, Math.min(100, readingEase)),
	};
}

const readabilityReport: LintRule = {
	id: 'READABILITY-002',
	category: 'readability',
	severity: 'info',
	weight: 0,
	description: 'Métrica de legibilidade do documento.',
	run: ({ document, language, report }) => {
		if (document.words < 80) return;

		const metrics = computeReadability(document, language);
		report({
			ruleId: 'READABILITY-002',
			message: `Facilidade de leitura: ${Math.round(metrics.readingEase)}/100 · média de ${metrics.averageSentenceWords.toFixed(1)} palavras por frase.`,
			location: locationOfLine(document.frontmatterLines + 1),
		});
	},
};

// ------------------------------------------------------------ acionabilidade

const proceduralPageWithoutExample: LintRule = {
	id: 'ACTION-001',
	category: 'actionability',
	severity: 'warning',
	weight: 1.5,
	description: 'Página procedural sem exemplo executável.',
	pageTypes: ['tutorial', 'how-to', 'api-reference'],
	run: ({ document, pageType, report }) => {
		if (document.codeBlocks.length > 0) return;

		report({
			ruleId: 'ACTION-001',
			message: `Página do tipo "${pageType}" sem nenhum exemplo de código.`,
			location: locationOfLine(document.frontmatterLines + 1),
			suggestion: 'Acrescente o comando, a requisição ou o trecho que o leitor deve executar.',
		});
	},
};

const vagueInstruction: LintRule = {
	id: 'ACTION-003',
	category: 'actionability',
	severity: 'warning',
	weight: 1,
	description: 'Instrução sem explicação de como executá-la.',
	run: ({ document, language, report }) => {
		// Um parágrafo de uma frase curta e imperativa, sem código nem lista em
		// seguida, costuma ser uma instrução que não diz como fazer:
		// "Configure a autenticação." e nada mais.
		const imperativeStart =
			language === 'en'
				? /^(configure|set up|install|enable|create|add|update|run)\b/i
				: language === 'es'
					? /^(configura|instala|habilita|crea|añade|ejecuta)\b/i
					: /^(configure|instale|habilite|crie|adicione|execute|defina)\b/i;

		for (const paragraph of document.paragraphs) {
			if (paragraph.sentences.length !== 1) continue;
			if (paragraph.words > 8) continue;
			if (!imperativeStart.test(paragraph.text.trim())) continue;

			// Se houver código logo abaixo, a instrução está acompanhada.
			const paragraphEnd = paragraph.location.endLine ?? paragraph.location.startLine;
			const followedByExample = document.codeBlocks.some(
				(block) => block.line > paragraphEnd && block.line <= paragraphEnd + 3
			);
			const followedByList = document.lists.some(
				(list) => list.location.startLine > paragraphEnd && list.location.startLine <= paragraphEnd + 3
			);
			if (followedByExample || followedByList) continue;

			report({
				ruleId: 'ACTION-003',
				message: `Instrução sem detalhamento: "${excerpt(paragraph.text, 45)}".`,
				location: paragraph.location,
				suggestion: 'Explique como fazer: credenciais necessárias, comando, exemplo e resultado esperado.',
			});
		}
	},
};

// --------------------------------------------------------------- preparo IA

const missingHeadings: LintRule = {
	id: 'AI-001',
	category: 'aiReadiness',
	severity: 'suggestion',
	weight: 0.8,
	description: 'Documento longo sem títulos intermediários.',
	run: ({ document, report }) => {
		if (document.words < 250) return;
		if (document.headings.length > 0) return;

		report({
			ruleId: 'AI-001',
			message: 'Documento longo sem nenhum título de seção.',
			location: locationOfLine(document.frontmatterLines + 1),
			suggestion: 'Títulos dão âncoras estáveis para leitores humanos e para agentes que citam trechos.',
		});
	},
};

const externalContextDependency: LintRule = {
	id: 'AI-002',
	category: 'aiReadiness',
	severity: 'suggestion',
	weight: 0.6,
	description: 'Referência a contexto fora da página.',
	run: ({ document, language, report }) => {
		const patterns: Record<LintLanguage, RegExp> = {
			'pt-BR': /(?:como (?:visto|dito|mencionado) (?:acima|anteriormente|antes)|na página anterior|conforme (?:acima|antes))/giu,
			en: /(?:as (?:mentioned|described|shown) (?:above|earlier|before)|on the previous page|see above)/giu,
			es: /(?:como se (?:mencionó|describió) (?:antes|anteriormente)|en la página anterior)/giu,
		};

		const pattern = patterns[language];
		const seen = new Set<string>();

		for (const paragraph of document.paragraphs) {
			pattern.lastIndex = 0;
			let match: RegExpExecArray | null;
			while ((match = pattern.exec(paragraph.text)) !== null) {
				if (seen.has(match[0].toLowerCase())) continue;
				seen.add(match[0].toLowerCase());

				report({
					ruleId: 'AI-002',
					message: `Referência a contexto externo: "${match[0]}".`,
					location: paragraph.location,
					suggestion: 'Nomeie o que está sendo referenciado e crie um link — a página pode ser lida isolada.',
				});
			}
		}
	},
};

const missingDescription: LintRule = {
	id: 'AI-003',
	category: 'aiReadiness',
	severity: 'suggestion',
	weight: 0.8,
	description: 'Página sem "description" no frontmatter.',
	run: ({ document, report }) => {
		const description = document.frontmatter.description;
		if (typeof description === 'string' && description.trim().length >= 20) return;

		report({
			ruleId: 'AI-003',
			message: 'A página não tem "description" no frontmatter.',
			location: locationOfLine(1),
			suggestion: 'A descrição alimenta a busca, os resultados e o resumo que agentes leem primeiro.',
		});
	},
};

export const qualityRules: LintRule[] = [
	readabilityReport,
	proceduralPageWithoutExample,
	vagueInstruction,
	missingHeadings,
	externalContextDependency,
	missingDescription,
];
