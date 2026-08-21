/**
 * Aplicação das ações sobre o documento (spec § 7, § 11, § 12, § 13).
 *
 * Três regras decidem o comportamento inteiro:
 *
 * 1. **O original nunca é tocado.** O documento é clonado antes da primeira
 *    ação. Mutar a especificação em disco para produzir uma view seria trocar a
 *    fonte de verdade pelo derivado.
 *
 * 2. **As ações rodam na ordem escrita**, e uma ação vê o resultado das
 *    anteriores. Isso é o que permite remover um caminho e depois ajustar o que
 *    sobrou — e também é o que torna a ordem uma decisão, não um detalhe.
 *
 * 3. **Alvo que não casa não é erro aqui.** Ele é registrado e segue adiante; a
 *    política de bloquear ou não é de quem chama, porque um overlay que mira um
 *    endpoint opcional é legítimo e um que mira um endpoint que sumiu é um
 *    defeito — e o motor não tem como distinguir os dois.
 */

import { parentOf, pointerOf, query, JsonPathError } from './jsonpath';
import type { ActionOutcome, ApplyResult, Overlay, ProvenanceEntry } from './types';

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Mescla `patch` em `target`.
 *
 * Mapa funde recursivamente; qualquer outra coisa substitui. Array **substitui**
 * em vez de concatenar, e essa é a escolha que evita o defeito mais provável:
 * concatenar faria `update: { tags: ['public'] }` acrescentar a tag a cada
 * aplicação, e um overlay aplicado duas vezes produziria um documento diferente
 * de um aplicado uma vez.
 */
export function mergeInto(target: unknown, patch: unknown): unknown {
	if (!isPlainObject(patch)) return patch;
	if (!isPlainObject(target)) return structuredClone(patch);

	const result: Record<string, unknown> = { ...target };
	for (const [key, value] of Object.entries(patch)) {
		result[key] = key in result ? mergeInto(result[key], value) : structuredClone(value);
	}
	return result;
}

function removeAt(document: unknown, path: (string | number)[]): boolean {
	const located = parentOf(document, path);
	if (!located) return false;

	const { parent, key } = located;

	if (Array.isArray(parent)) {
		if (typeof key !== 'number' || key >= parent.length) return false;
		parent.splice(key, 1);
		return true;
	}

	if (!(String(key) in parent)) return false;
	delete (parent as Record<string, unknown>)[String(key)];
	return true;
}

function writeAt(document: unknown, path: (string | number)[], value: unknown): boolean {
	if (path.length === 0) return false;

	const located = parentOf(document, path);
	if (!located) return false;

	const { parent, key } = located;
	(parent as Record<string | number, unknown>)[key] = value;
	return true;
}

export interface ApplyOptions {
	/** Documento base. Não é modificado. */
	document: unknown;
	overlays: readonly Overlay[];
}

export function applyOverlays({ document, overlays }: ApplyOptions): ApplyResult {
	// Clonar uma vez, no começo: o resto do arquivo pode mutar à vontade sabendo
	// que está mexendo numa cópia.
	const effective = structuredClone(document);

	const outcomes: ActionOutcome[] = [];
	const provenance: ProvenanceEntry[] = [];

	for (const overlay of overlays) {
		overlay.actions.forEach((action, index) => {
			const base = {
				index,
				overlay: overlay.source,
				target: action.target,
				// `remove` prevalece sobre `update` (spec § 12).
				kind: action.remove ? ('remove' as const) : ('update' as const),
				description: action.description,
			};

			let matches;
			try {
				matches = query(effective, action.target);
			} catch (error) {
				outcomes.push({
					...base,
					matched: 0,
					pointers: [],
					error: error instanceof JsonPathError ? error.message : String(error),
				});
				return;
			}

			if (matches.length === 0) {
				outcomes.push({ ...base, matched: 0, pointers: [] });
				return;
			}

			const pointers: string[] = [];

			// Remoção percorre de trás para frente: retirar o índice 0 de um array
			// desloca todos os seguintes, e o caminho já calculado do índice 1
			// passaria a apontar para outro elemento.
			const ordered = base.kind === 'remove' ? [...matches].reverse() : matches;

			for (const match of ordered) {
				const pointer = pointerOf(match.path);

				const done =
					base.kind === 'remove'
						? removeAt(effective, match.path)
						: match.path.length === 0
							? false
							: writeAt(effective, match.path, mergeInto(match.value, action.update));

				if (!done) continue;

				pointers.push(pointer);
				provenance.push({
					pointer,
					overlay: overlay.source,
					action: index,
					kind: base.kind,
					description: action.description,
				});
			}

			outcomes.push({ ...base, matched: pointers.length, pointers: pointers.reverse() });
		});
	}

	return {
		document: effective,
		outcomes,
		provenance,
		unmatched: outcomes.filter((outcome) => outcome.matched === 0 && !outcome.error),
		failed: outcomes.filter((outcome) => Boolean(outcome.error)),
	};
}
