/**
 * Regras sobre código, links, imagens e conteúdo incompleto.
 */

import type { LintRule } from '../types';
import { locationOfLine, excerpt, termsPattern } from './helpers';
import { VAGUE_LINK_TEXT, GENERIC_ALT_TEXT, INCOMPLETE_MARKERS, SUSPICIOUS_PLACEHOLDERS } from './language';

// --------------------------------------------------------------------- código

const codeWithoutLanguage: LintRule = {
	id: 'CODE-001',
	category: 'technicalWriting',
	severity: 'warning',
	weight: 1.2,
	description: 'Bloco de código sem linguagem declarada.',
	run: ({ document, report }) => {
		for (const block of document.codeBlocks) {
			if (block.lang && block.lang.trim() !== '') continue;

			report({
				ruleId: 'CODE-001',
				message: 'Bloco de código sem linguagem.',
				location: block.location,
				suggestion: 'Declare a linguagem para habilitar o realce de sintaxe, ex.: ```bash.',
			});
		}
	},
};

const emptyCodeBlock: LintRule = {
	id: 'CODE-002',
	category: 'completeness',
	severity: 'error',
	weight: 2,
	description: 'Bloco de código vazio.',
	run: ({ document, report }) => {
		for (const block of document.codeBlocks) {
			if (block.value.trim() !== '') continue;

			report({
				ruleId: 'CODE-002',
				message: 'Bloco de código vazio.',
				location: block.location,
			});
		}
	},
};

const codeWithoutExplanation: LintRule = {
	id: 'CODE-003',
	category: 'actionability',
	severity: 'suggestion',
	weight: 0.6,
	description: 'Bloco de código sem texto que o explique.',
	run: ({ document, report }) => {
		for (const block of document.codeBlocks) {
			// Exemplo curto e autoexplicativo não precisa de introdução — a §19
			// pede explicitamente para não exigir isso.
			const lines = block.value.trim().split('\n').length;
			if (lines <= 2) continue;
			if (block.precededByText && block.precededByText.length >= 30) continue;

			report({
				ruleId: 'CODE-003',
				message: 'Bloco de código sem explicação antes dele.',
				location: block.location,
				suggestion: 'Diga o que o comando faz e o que o leitor deve esperar como resultado.',
			});
		}
	},
};

// ---------------------------------------------------------------------- links

const vagueLinkText: LintRule = {
	id: 'LINK-001',
	category: 'clarity',
	severity: 'warning',
	weight: 1.2,
	description: 'Texto de link sem valor descritivo.',
	run: ({ document, language, report }) => {
		const vague = new Set(VAGUE_LINK_TEXT[language].map((text) => text.toLowerCase()));

		for (const link of document.links) {
			const text = link.text.trim().toLowerCase().replace(/[.!?]+$/, '');
			if (!vague.has(text)) continue;

			report({
				ruleId: 'LINK-001',
				message: `Texto de link pouco descritivo: "${link.text}".`,
				location: link.location,
				suggestion: 'Use o título do destino, ex.: [Guia de autenticação](…).',
				// Leitores de tela costumam listar os links fora do contexto da frase.
				explanation: 'Fora do texto ao redor, este link não diz para onde leva.',
			});
		}
	},
};

const bareUrl: LintRule = {
	id: 'LINK-002',
	category: 'clarity',
	severity: 'suggestion',
	weight: 0.4,
	description: 'URL exposta como texto do link.',
	run: ({ document, report }) => {
		for (const link of document.links) {
			const text = link.text.trim();
			if (!/^https?:\/\//i.test(text)) continue;

			report({
				ruleId: 'LINK-002',
				message: 'A URL aparece como texto do link.',
				location: link.location,
				suggestion: 'Descreva o destino em palavras.',
			});
		}
	},
};

const duplicateLink: LintRule = {
	id: 'LINK-003',
	category: 'consistency',
	severity: 'info',
	weight: 0,
	description: 'Mesmo destino com textos diferentes.',
	run: ({ document, report }) => {
		const byUrl = new Map<string, Set<string>>();

		for (const link of document.links) {
			if (!link.url) continue;
			const set = byUrl.get(link.url) ?? new Set<string>();
			set.add(link.text.trim());
			byUrl.set(link.url, set);
		}

		for (const link of document.links) {
			const texts = byUrl.get(link.url);
			if (!texts || texts.size < 2) continue;
			// Reporta uma vez por URL, na primeira ocorrência.
			if (document.links.find((candidate) => candidate.url === link.url) !== link) continue;

			report({
				ruleId: 'LINK-003',
				message: `O mesmo destino é referido de ${texts.size} formas diferentes.`,
				location: link.location,
				explanation: [...texts].map((text) => `"${text}"`).join(', '),
			});
		}
	},
};

// -------------------------------------------------------------------- imagens

const missingAltText: LintRule = {
	id: 'IMAGE-001',
	category: 'structure',
	severity: 'error',
	weight: 2,
	description: 'Imagem sem texto alternativo.',
	run: ({ document, report }) => {
		for (const image of document.images) {
			if (image.alt.trim() !== '') continue;

			report({
				ruleId: 'IMAGE-001',
				message: 'Imagem sem texto alternativo.',
				location: image.location,
				suggestion: 'Descreva o que a imagem mostra: ![Fluxo de autenticação](…).',
			});
		}
	},
};

const genericAltText: LintRule = {
	id: 'IMAGE-002',
	category: 'structure',
	severity: 'warning',
	weight: 1,
	description: 'Texto alternativo genérico ou igual ao nome do arquivo.',
	run: ({ document, language, report }) => {
		const generic = new Set(GENERIC_ALT_TEXT[language].map((text) => text.toLowerCase()));

		for (const image of document.images) {
			const alt = image.alt.trim();
			if (alt === '') continue;

			const normalized = alt.toLowerCase();
			const looksLikeFilename = /\.(png|jpe?g|gif|svg|webp)$/i.test(alt);
			if (!generic.has(normalized) && !looksLikeFilename) continue;

			report({
				ruleId: 'IMAGE-002',
				message: looksLikeFilename
					? `O texto alternativo é o nome do arquivo: "${alt}".`
					: `Texto alternativo genérico: "${alt}".`,
				location: image.location,
				suggestion: 'Descreva o conteúdo da imagem, não o formato dela.',
			});
		}
	},
};

// ---------------------------------------------------------------- completude

const incompleteMarker: LintRule = {
	id: 'COMPLETENESS-001',
	category: 'completeness',
	severity: 'error',
	weight: 2.5,
	description: 'Marca de conteúdo inacabado (TODO, TBD, WIP…).',
	run: ({ document, report }) => {
		const pattern = termsPattern(INCOMPLETE_MARKERS, 'gu');
		if (!pattern) return;

		// Varre as linhas cruas, inclusive dentro de código: um TODO esquecido
		// num exemplo é tão inacabado quanto no texto.
		document.lines.forEach((text, index) => {
			const line = index + 1;
			if (line <= document.frontmatterLines) return;

			pattern.lastIndex = 0;
			let match: RegExpExecArray | null;
			while ((match = pattern.exec(text)) !== null) {
				report({
					ruleId: 'COMPLETENESS-001',
					message: `Marca de conteúdo inacabado: "${match[0]}".`,
					location: {
						startLine: line,
						startColumn: match.index + 1,
						endLine: line,
						endColumn: match.index + match[0].length + 1,
					},
					explanation: excerpt(text),
				});
			}
		});
	},
};

const suspiciousPlaceholder: LintRule = {
	id: 'COMPLETENESS-003',
	category: 'completeness',
	severity: 'warning',
	weight: 1,
	description: 'Placeholder que pode ter ficado esquecido.',
	run: ({ document, report }) => {
		const pattern = termsPattern(SUSPICIOUS_PLACEHOLDERS, 'giu');
		if (!pattern) return;

		for (const block of document.codeBlocks) {
			pattern.lastIndex = 0;
			const found = new Set<string>();
			let match: RegExpExecArray | null;
			while ((match = pattern.exec(block.value)) !== null) found.add(match[0].toLowerCase());
			if (found.size === 0) continue;

			report({
				ruleId: 'COMPLETENESS-003',
				message: `Placeholder genérico no exemplo: ${[...found].map((f) => `"${f}"`).join(', ')}.`,
				location: block.location,
				// A §31 pede distinguir placeholder legítimo de esquecido:
				// `<YOUR_API_KEY>` é intencional, `foo` raramente é.
				suggestion: 'Use um valor realista ou um placeholder explícito, como <SUA_CHAVE_DE_API>.',
			});
		}
	},
};

const emptyLinkTarget: LintRule = {
	id: 'LINK-004',
	category: 'completeness',
	severity: 'error',
	weight: 2,
	description: 'Link sem destino.',
	run: ({ document, report }) => {
		for (const link of document.links) {
			const url = link.url.trim();
			if (url !== '' && url !== '#') continue;

			report({
				ruleId: 'LINK-004',
				message: `O link "${excerpt(link.text, 30)}" não tem destino.`,
				location: link.location,
			});
		}
	},
};

export const assetRules: LintRule[] = [
	codeWithoutLanguage,
	emptyCodeBlock,
	codeWithoutExplanation,
	vagueLinkText,
	bareUrl,
	duplicateLink,
	missingAltText,
	genericAltText,
	incompleteMarker,
	suspiciousPlaceholder,
	emptyLinkTarget,
];

export const __unused = { locationOfLine };
