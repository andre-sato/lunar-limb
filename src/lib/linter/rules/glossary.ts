/**
 * Regras de consistência alimentadas pelo glossário (§30–§32).
 *
 * O glossário é a fonte; o linter é consumidor. Por isso estas regras vivem no
 * linter e pertencem à categoria `consistency` — a spec é explícita em não criar
 * uma categoria "glossário" separada no score (§30.1, §34): terminologia
 * inconsistente é um problema de consistência, não uma dimensão à parte.
 *
 * **Numeração.** A spec numera as regras de 001 a 005, mas `CONSISTENCY-001` já
 * existia no portal — grafia inconsistente dentro da página, que é o conceito da
 * `CONSISTENCY-003` da spec. Renumerar quebraria configurações e histórico, e a
 * §39 autoriza adaptar os nomes ao linter existente. O mapa:
 *
 * | Spec | Portal | O quê |
 * | --- | --- | --- |
 * | 003 | CONSISTENCY-001 | grafia inconsistente (já existia) |
 * | 001 | CONSISTENCY-002 | forma não preferencial de um termo |
 * | 002 | CONSISTENCY-003 | terminologia desaconselhada |
 * | 004 | CONSISTENCY-004 | termo técnico sem definição |
 * | 005 | CONSISTENCY-005 | sigla e forma extensa misturadas |
 */

import type { LintRule } from '../types';
import { scanProse } from './helpers';
import type { GlossaryIndex } from '../../glossary/types';

/**
 * Índice injetado antes da execução.
 *
 * As regras do linter são síncronas e o glossário vem do disco. Carregá-lo aqui
 * uma vez, e não por regra e por página, é o que mantém o custo constante — o
 * mesmo raciocínio da §28.
 */
let injected: GlossaryIndex | null = null;

export function setGlossaryIndex(index: GlossaryIndex | null): void {
	injected = index;
}

function glossary(): GlossaryIndex | null {
	return injected && injected.byId.size > 0 ? injected : null;
}

/** Escapa um termo para uso dentro de expressão regular. */
function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wordPattern(surface: string): RegExp {
	return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(surface)}(?![\\p{L}\\p{N}])`, 'giu');
}

// ---------------------------------------------------------------------------
// CONSISTENCY-002 — forma não preferencial (spec CONSISTENCY-001)
// ---------------------------------------------------------------------------

const nonPreferredTerm: LintRule = {
	id: 'CONSISTENCY-002',
	category: 'consistency',
	severity: 'warning',
	weight: 1,
	description: 'Termo escrito numa forma que o glossário não usa como canônica.',
	run: ({ document, report }) => {
		const index = glossary();
		if (!index) return;

		for (const definition of index.byId.values()) {
			if (!definition.enabled) continue;

			for (const alias of definition.aliases) {
				// Um alias não é erro: ele existe para ser reconhecido. O que a regra
				// aponta é o alias **de sigla** usado onde a forma canônica é a curta
				// — e isso só quando as duas convivem na mesma página, que é o caso
				// que confunde o leitor.
				const aliasOccurrences = [...scanProse(document, wordPattern(alias))];
				if (aliasOccurrences.length === 0) continue;

				const canonicalOccurrences = [...scanProse(document, wordPattern(definition.term))];
				if (canonicalOccurrences.length === 0) continue;

				for (const occurrence of aliasOccurrences) {
					report({
						ruleId: 'CONSISTENCY-002',
						message: `"${occurrence.text}" e "${definition.term}" na mesma página; o glossário define "${definition.term}" como forma canônica.`,
						location: occurrence.location,
						suggestion: definition.term,
						explanation: `Glossário: ${definition.id}`,
					});
				}
			}
		}
	},
};

// ---------------------------------------------------------------------------
// CONSISTENCY-003 — terminologia desaconselhada (spec CONSISTENCY-002)
// ---------------------------------------------------------------------------

const deprecatedTerm: LintRule = {
	id: 'CONSISTENCY-003',
	category: 'consistency',
	severity: 'warning',
	weight: 1.5,
	description: 'Termo marcado como desaconselhado no glossário.',
	run: ({ document, report }) => {
		const index = glossary();
		if (!index) return;

		for (const definition of index.byId.values()) {
			for (const outdated of definition.deprecated) {
				for (const occurrence of scanProse(document, wordPattern(outdated))) {
					report({
						ruleId: 'CONSISTENCY-003',
						message: `"${occurrence.text}" está marcado como desaconselhado; prefira "${definition.term}".`,
						location: occurrence.location,
						suggestion: definition.term,
						explanation: `Glossário: ${definition.id}`,
					});
				}
			}
		}
	},
};

// ---------------------------------------------------------------------------
// CONSISTENCY-005 — sigla e forma extensa misturadas (spec CONSISTENCY-005)
// ---------------------------------------------------------------------------

const inconsistentAcronym: LintRule = {
	id: 'CONSISTENCY-005',
	category: 'consistency',
	severity: 'info',
	weight: 0.5,
	description: 'Sigla e forma extensa alternando na mesma página.',
	run: ({ document, report }) => {
		const index = glossary();
		if (!index) return;

		for (const definition of index.byId.values()) {
			if (!definition.enabled) continue;
			// Só interessa quando o termo canônico é uma sigla: `API` contra
			// `Application Programming Interface`. Dois sinônimos comuns alternando
			// não são um problema de sigla.
			if (!/^[\p{Lu}\p{N}]{2,}$/u.test(definition.term)) continue;

			const expansions = definition.aliases.filter((alias) => alias.includes(' '));
			if (expansions.length === 0) continue;

			const acronymCount = [...scanProse(document, wordPattern(definition.term))].length;
			if (acronymCount === 0) continue;

			for (const expansion of expansions) {
				const occurrences = [...scanProse(document, wordPattern(expansion))];
				// A primeira aparição da forma extensa é a apresentação da sigla, e é
				// desejável. A partir da segunda, é alternância.
				for (const occurrence of occurrences.slice(1)) {
					report({
						ruleId: 'CONSISTENCY-005',
						message: `"${expansion}" aparece mais de uma vez junto com a sigla "${definition.term}".`,
						location: occurrence.location,
						suggestion: definition.term,
						explanation: `Glossário: ${definition.id}. Apresente a forma extensa uma vez e use a sigla depois.`,
					});
				}
			}
		}
	},
};

// ---------------------------------------------------------------------------
// CONSISTENCY-004 — termo técnico sem definição (spec CONSISTENCY-004)
// ---------------------------------------------------------------------------

/**
 * Siglas que não precisam de GlossDef: são universais em documentação técnica.
 * A regra existe para achar vocabulário **do produto** sem definição, não para
 * exigir que alguém defina HTTP.
 */
const UNIVERSAL = new Set([
	'HTTP', 'HTTPS', 'JSON', 'YAML', 'XML', 'HTML', 'CSS', 'URL', 'URI', 'UUID',
	'ID', 'TLS', 'SSL', 'DNS', 'CLI', 'IDE', 'OS', 'UTC', 'ISO', 'PDF', 'PNG',
	'SVG', 'CSV', 'SQL', 'REST', 'CRUD', 'MIT', 'RFC', 'TODO', 'FAQ', 'MDX',
]);

/** Quantas vezes uma sigla precisa aparecer para valer um aviso. */
const MIN_OCCURRENCES = 3;

const undefinedTerm: LintRule = {
	id: 'CONSISTENCY-004',
	category: 'consistency',
	severity: 'info',
	weight: 0.5,
	description: 'Sigla usada com frequência e ausente do glossário.',
	run: ({ document, report }) => {
		const index = glossary();
		if (!index) return;

		// Toda forma conhecida pelo glossário, em minúsculas, para a comparação
		// não depender de caixa.
		const known = new Set<string>();
		for (const definition of index.byId.values()) {
			known.add(definition.term.toLowerCase());
			for (const alias of definition.aliases) known.add(alias.toLowerCase());
			for (const outdated of definition.deprecated) known.add(outdated.toLowerCase());
		}

		const counts = new Map<string, { count: number; location: ReturnType<typeof firstLocation> }>();

		function firstLocation(location: { startLine: number; startColumn: number }) {
			return location;
		}

		for (const match of scanProse(document, /(?<![\p{L}\p{N}])[\p{Lu}][\p{Lu}\p{N}]{2,}(?![\p{L}\p{N}])/gu)) {
			const surface = match.text;
			if (UNIVERSAL.has(surface) || known.has(surface.toLowerCase())) continue;

			const existing = counts.get(surface);
			if (existing) existing.count++;
			else counts.set(surface, { count: 1, location: match.location });
		}

		for (const [surface, info] of counts) {
			if (info.count < MIN_OCCURRENCES) continue;
			report({
				ruleId: 'CONSISTENCY-004',
				message: `"${surface}" aparece ${info.count} vezes e não está no glossário.`,
				location: info.location,
				explanation: 'Se for vocabulário do produto, vale um termo em src/content/glossary/.',
			});
		}
	},
};

export const glossaryRules: LintRule[] = [
	nonPreferredTerm,
	deprecatedTerm,
	inconsistentAcronym,
	undefinedTerm,
];
