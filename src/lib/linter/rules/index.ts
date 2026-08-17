/**
 * Registro de regras.
 *
 * Toda regra tem um id estável (§38), o que permite desabilitá-la, mudar sua
 * severidade, ignorá-la por linha e acompanhar a evolução da qualidade sem
 * depender do texto da mensagem.
 */

import type { LintRule } from '../types';
import { textRules } from './text';
import { structureRules } from './structure';
import { assetRules } from './assets';
import { qualityRules } from './quality';

export const ALL_RULES: readonly LintRule[] = [...textRules, ...structureRules, ...assetRules, ...qualityRules];

export function ruleById(id: string): LintRule | undefined {
	return ALL_RULES.find((rule) => rule.id === id);
}

/** Verificação de integridade: dois ids iguais tornariam a configuração ambígua. */
export function duplicateRuleIds(): string[] {
	const seen = new Set<string>();
	const duplicates: string[] = [];
	for (const rule of ALL_RULES) {
		if (seen.has(rule.id)) duplicates.push(rule.id);
		seen.add(rule.id);
	}
	return duplicates;
}

export { computeReadability } from './quality';
