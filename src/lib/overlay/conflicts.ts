/**
 * Conflito entre overlays encadeados (spec § 26).
 *
 * Um conflito é dois overlays diferentes mexendo no **mesmo nó**. Ele não é um
 * erro do motor: a aplicação em ordem sempre produz um resultado definido. O
 * problema é outro — o resultado passa a depender da ordem, e ordem raramente é
 * uma decisão que alguém tomou de propósito ao escrever o segundo overlay.
 *
 * Duas ações do **mesmo** overlay tocando o mesmo nó não contam. Ali a ordem é
 * local, visível no arquivo, e frequentemente intencional (§ 13).
 */

import { labelFor } from './preview';
import type { ActionOutcome, Conflict, IssueSeverity } from './types';

/** `/paths/~1users/get` → `['paths', '/users', 'get']`. */
function segmentsOf(pointer: string): string[] {
	if (pointer === '') return [];
	return pointer
		.slice(1)
		.split('/')
		.map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
}

/** `/paths/~1users` contém `/paths/~1users/get`. */
function contains(ancestor: string, descendant: string): boolean {
	return descendant === ancestor || descendant.startsWith(`${ancestor}/`);
}

function describe(first: ActionOutcome, second: ActionOutcome, overlapping: boolean): {
	severity: IssueSeverity;
	explanation: string;
} {
	if (first.kind === 'remove' && second.kind === 'update') {
		return {
			severity: 'error',
			explanation: `\`${first.overlay}\` remove este nó antes de \`${second.overlay}\` tentar atualizá-lo. A atualização não tem onde ser aplicada, e quem escreveu o segundo overlay não tem como perceber isso lendo o próprio arquivo.`,
		};
	}

	if (first.kind === 'remove' && second.kind === 'remove') {
		return {
			severity: 'warning',
			explanation: `Os dois overlays removem o mesmo nó. O resultado é o esperado; a duplicação sugere que um dos dois virou redundante.`,
		};
	}

	if (overlapping) {
		return {
			severity: 'warning',
			explanation: `\`${second.overlay}\` atualiza um nó dentro do que \`${first.overlay}\` já havia alterado. O resultado depende da ordem das views.`,
		};
	}

	return {
		severity: 'warning',
		explanation: `Os dois overlays atualizam o mesmo nó. O último a rodar vence campo a campo, então trocar a ordem das views muda o documento efetivo.`,
	};
}

/**
 * Os conflitos entre as ações já aplicadas.
 *
 * Recebe os resultados de `applyOverlays`, e não os overlays crus, porque só
 * depois de aplicar se sabe **quais nós** cada alvo atingiu — `$.paths.*.get`
 * pode não colidir com `$.paths['/users'].get` no texto e colidir no documento.
 */
export function detectConflicts(outcomes: readonly ActionOutcome[]): Conflict[] {
	const applied = outcomes.filter((outcome) => outcome.matched > 0 && !outcome.error);
	const conflicts: Conflict[] = [];
	const seen = new Set<string>();

	for (let a = 0; a < applied.length; a += 1) {
		for (let b = a + 1; b < applied.length; b += 1) {
			const first = applied[a];
			const second = applied[b];

			if (first.overlay === second.overlay) continue;

			for (const firstPointer of first.pointers) {
				for (const secondPointer of second.pointers) {
					const nested =
						contains(firstPointer, secondPointer) || contains(secondPointer, firstPointer);
					if (!nested) continue;

					// O nó relatado é o mais específico dos dois: é onde a disputa
					// acontece de verdade.
					const pointer =
						firstPointer.length >= secondPointer.length ? firstPointer : secondPointer;

					const key = `${first.overlay}#${first.index}|${second.overlay}#${second.index}|${pointer}`;
					if (seen.has(key)) continue;
					seen.add(key);

					const { severity, explanation } = describe(
						first,
						second,
						firstPointer !== secondPointer
					);

					conflicts.push({
						pointer,
						label: labelFor(segmentsOf(pointer)),
						first: { overlay: first.overlay, action: first.index, kind: first.kind },
						second: { overlay: second.overlay, action: second.index, kind: second.kind },
						severity,
						explanation,
					});
				}
			}
		}
	}

	// Erro antes de aviso: quem lê o relatório precisa ver primeiro o que não tem
	// resultado defensável.
	return conflicts.sort((x, y) => (x.severity === y.severity ? 0 : x.severity === 'error' ? -1 : 1));
}
