/**
 * Regras de estrutura: hierarquia de títulos, seções esperadas por tipo de
 * página, listas procedurais e tabelas.
 */

import type { LintRule } from '../types';
import { locationOfLine, excerpt, escapeRegex } from './helpers';
import { GENERIC_HEADINGS, EXPECTED_SECTIONS } from './language';

const headingSkip: LintRule = {
	id: 'STRUCTURE-001',
	category: 'structure',
	severity: 'error',
	weight: 2,
	description: 'Hierarquia de títulos pula um nível.',
	run: ({ document, report }) => {
		let previous: number | null = null;

		for (const heading of document.headings) {
			if (previous !== null && heading.depth > previous + 1) {
				report({
					ruleId: 'STRUCTURE-001',
					message: `Título pula de h${previous} para h${heading.depth}.`,
					location: heading.location,
					suggestion: `Use h${previous + 1} em "${excerpt(heading.text, 40)}".`,
				});
			}
			previous = heading.depth;
		}
	},
};

const duplicateHeading: LintRule = {
	id: 'STRUCTURE-002',
	category: 'structure',
	severity: 'warning',
	weight: 1.2,
	description: 'Títulos repetidos no mesmo documento.',
	run: ({ document, report }) => {
		const seen = new Map<string, number>();

		for (const heading of document.headings) {
			const key = heading.text.trim().toLowerCase();
			if (!key) continue;

			const firstLine = seen.get(key);
			if (firstLine !== undefined) {
				report({
					ruleId: 'STRUCTURE-002',
					message: `Título duplicado: "${excerpt(heading.text, 40)}" (já aparece na linha ${firstLine}).`,
					location: heading.location,
					// Âncoras de URL são derivadas do título; duplicá-los cria
					// links que apontam sempre para a primeira ocorrência.
					explanation: 'Títulos iguais geram âncoras ambíguas.',
				});
			} else {
				seen.set(key, heading.line);
			}
		}
	},
};

const longHeading: LintRule = {
	id: 'STRUCTURE-003',
	category: 'structure',
	severity: 'suggestion',
	weight: 0.5,
	description: 'Título longo demais.',
	run: ({ document, config, report }) => {
		const limit = config.thresholds.maxHeadingWords;

		for (const heading of document.headings) {
			const count = heading.text.trim().split(/\s+/).filter(Boolean).length;
			if (count <= limit) continue;

			report({
				ruleId: 'STRUCTURE-003',
				message: `Título com ${count} palavras (limite: ${limit}).`,
				location: heading.location,
				suggestion: 'Títulos curtos funcionam melhor na navegação e na busca.',
			});
		}
	},
};

const genericHeading: LintRule = {
	id: 'STRUCTURE-004',
	category: 'structure',
	severity: 'suggestion',
	weight: 0.6,
	description: 'Título genérico, que não descreve o conteúdo.',
	run: ({ document, language, report }) => {
		const generic = new Set(GENERIC_HEADINGS[language].map((word) => word.toLowerCase()));

		for (const heading of document.headings) {
			const normalized = heading.text.trim().toLowerCase();
			if (!generic.has(normalized)) continue;

			report({
				ruleId: 'STRUCTURE-004',
				message: `Título genérico: "${heading.text}".`,
				location: heading.location,
				suggestion: 'Descreva o assunto da seção, não o papel dela no texto.',
			});
		}
	},
};

const missingTitle: LintRule = {
	id: 'STRUCTURE-005',
	category: 'structure',
	severity: 'error',
	weight: 2.5,
	description: 'Página sem título no frontmatter.',
	run: ({ document, report }) => {
		if (document.title && document.title.trim() !== '') return;

		report({
			ruleId: 'STRUCTURE-005',
			message: 'A página não tem "title" no frontmatter.',
			location: locationOfLine(1),
			// A Starlight exige title; sem ele a página quebra a navegação.
			explanation: 'A Starlight usa este campo na navegação, no título da aba e na busca.',
		});
	},
};

const missingSection: LintRule = {
	id: 'STRUCTURE-006',
	category: 'structure',
	severity: 'warning',
	weight: 1.5,
	description: 'Seção esperada ausente para o tipo de página.',
	run: ({ document, pageType, language, report }) => {
		if (!pageType) return;

		const expected = EXPECTED_SECTIONS[pageType]?.[language] ?? [];
		if (expected.length === 0) return;

		const present = document.headings.map((heading) => heading.text.trim().toLowerCase());

		for (const section of expected) {
			const found = present.some((heading) => heading.includes(section.toLowerCase()));
			if (found) continue;

			report({
				ruleId: 'STRUCTURE-006',
				message: `Página do tipo "${pageType}" costuma ter a seção "${section}".`,
				location: locationOfLine(document.frontmatterLines + 1),
				suggestion: `Acrescente um título "${section}" ou ajuste o "type" no frontmatter.`,
			});
		}
	},
};

const emptySection: LintRule = {
	id: 'COMPLETENESS-002',
	category: 'completeness',
	severity: 'error',
	weight: 2,
	description: 'Seção sem conteúdo.',
	run: ({ document, report }) => {
		const headings = document.headings;

		headings.forEach((heading, index) => {
			const next = headings[index + 1];

			// Uma seção que abre subseções não está vazia: `## Parte 1` seguido
			// de `### Estrutura` é sumário, não lacuna. Só faz sentido cobrar
			// conteúdo de quem não tem filhos.
			if (next && next.depth > heading.depth) return;

			const start = heading.line;
			const end = next ? next.line : document.lines.length + 1;

			// Procura qualquer conteúdo não vazio entre este título e o próximo.
			let hasContent = false;
			for (let line = start + 1; line < end; line++) {
				const text = document.lines[line - 1];
				if (text && text.trim() !== '') {
					hasContent = true;
					break;
				}
			}

			if (hasContent) return;

			report({
				ruleId: 'COMPLETENESS-002',
				message: `A seção "${excerpt(heading.text, 40)}" está vazia.`,
				location: heading.location,
			});
		});
	},
};

const stepConsistency: LintRule = {
	id: 'ACTION-002',
	category: 'actionability',
	severity: 'suggestion',
	weight: 0.8,
	description: 'Passos de procedimento sem forma verbal consistente.',
	run: ({ document, language, report }) => {
		for (const list of document.lists) {
			if (!list.ordered || list.items.length < 2) continue;

			// Compara a terminação da primeira palavra de cada passo. Em
			// português, passo escrito como substantivo ("Instalação do CLI")
			// termina em -ção/-agem/-mento, enquanto o imperativo não.
			const nounLike = list.items.filter((item) => {
				const first = item.text.trim().split(/\s+/)[0] ?? '';
				if (language === 'pt-BR' || language === 'es') {
					return /(?:ção|ções|agem|mento|dade)$/iu.test(first);
				}
				return /ing$/iu.test(first);
			});

			if (nounLike.length === 0) return;

			// Só reclama quando a lista mistura as duas formas ou usa só
			// substantivos: uma lista inteiramente imperativa está correta.
			report({
				ruleId: 'ACTION-002',
				message: `Passos escritos como substantivo (${nounLike.length} de ${list.items.length}).`,
				location: nounLike[0].location,
				suggestion: 'Comece cada passo com um verbo no imperativo: "Instale o CLI".',
			});
		}
	},
};

const tableCouldBeList: LintRule = {
	id: 'STRUCTURE-007',
	category: 'structure',
	severity: 'suggestion',
	weight: 0.3,
	description: 'Tabela de duas colunas sequencial que caberia melhor como lista.',
	run: ({ document, report }) => {
		for (const table of document.tables) {
			if (table.headers.length !== 2 || table.rows.length < 2) continue;

			// Primeira coluna puramente numérica e sequencial: é uma lista
			// ordenada disfarçada de tabela.
			const firstColumn = table.rows.map((row) => (row[0] ?? '').trim());
			const isSequential = firstColumn.every((cell, index) => cell === String(index + 1));
			if (!isSequential) continue;

			report({
				ruleId: 'STRUCTURE-007',
				message: 'Tabela numerada sequencial.',
				location: table.location,
				suggestion: 'Uma lista ordenada é mais legível e acessível para este conteúdo.',
			});
		}
	},
};

const emptyTableHeader: LintRule = {
	id: 'STRUCTURE-008',
	category: 'structure',
	severity: 'warning',
	weight: 1,
	description: 'Tabela com cabeçalho vazio.',
	run: ({ document, report }) => {
		for (const table of document.tables) {
			const empty = table.headers.filter((header) => header.trim() === '').length;
			if (empty === 0) continue;

			report({
				ruleId: 'STRUCTURE-008',
				message: `Tabela com ${empty} cabeçalho(s) vazio(s).`,
				location: table.location,
				explanation: 'Leitores de tela anunciam o cabeçalho ao ler cada célula.',
			});
		}
	},
};

const longParagraph: LintRule = {
	id: 'READABILITY-001',
	category: 'readability',
	severity: 'suggestion',
	weight: 0.6,
	description: 'Parágrafo longo demais.',
	run: ({ document, config, report }) => {
		const limit = config.thresholds.maxParagraphWords;

		for (const paragraph of document.paragraphs) {
			if (paragraph.words <= limit) continue;

			report({
				ruleId: 'READABILITY-001',
				message: `Parágrafo com ${paragraph.words} palavras (limite: ${limit}).`,
				location: paragraph.location,
				suggestion: 'Divida em parágrafos menores ou converta parte em lista.',
			});
		}
	},
};

export const structureRules: LintRule[] = [
	headingSkip,
	duplicateHeading,
	longHeading,
	genericHeading,
	missingTitle,
	missingSection,
	emptySection,
	stepConsistency,
	tableCouldBeList,
	emptyTableHeader,
	longParagraph,
];

export const __unused = { escapeRegex };
