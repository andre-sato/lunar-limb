/**
 * Diferença semântica entre a especificação base e a efetiva (spec § 9, § 29).
 *
 * "Semântica" aqui quer dizer que a comparação é sobre o **documento
 * interpretado**, não sobre o texto: reordenar chaves do YAML são vinte linhas
 * num `git diff` e mudança nenhuma aqui. É a mesma escolha que o Impact Engine
 * já faz para diff de API, e pelo mesmo motivo.
 *
 * A classificação de quebra segue o contexto da especificação **efetiva** (spec
 * § 29): um endpoint removido por overlay é uma quebra para quem consome aquela
 * view, ainda que continue existindo na base. Dizer o contrário faria a view
 * pública prometer estabilidade que ela não tem.
 */

import { pointerOf } from './jsonpath';
import type { ActionOutcome, ChangeKind, OverlayDiff, SemanticChange } from './types';

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Um rótulo que uma pessoa reconheça.
 *
 * `/paths/~1users/get` não diz nada a quem revisa um pull request; `GET /users`
 * diz. Fora dos caminhos de API, o ponteiro legível já é o suficiente.
 */
export function labelFor(path: (string | number)[]): string {
	if (path[0] === 'paths' && typeof path[1] === 'string') {
		const endpoint = path[1];
		if (typeof path[2] === 'string' && METHODS.includes(path[2])) {
			const rest = path.slice(3);
			return `${path[2].toUpperCase()} ${endpoint}${rest.length ? ` · ${rest.join('.')}` : ''}`;
		}
		return endpoint;
	}

	if (path[0] === 'components' && path[1] === 'schemas' && typeof path[2] === 'string') {
		return `schema ${path[2]}`;
	}

	return path.length === 0 ? 'documento' : path.join('.');
}

/**
 * Uma mudança quebra quem consome?
 *
 * Some algo que estava publicado, ou muda o que já era obrigatório: sim. Aparece
 * algo novo, ou muda texto: não. É a mesma régua do Impact Engine — e a
 * consequência prática é que descrição editorial, que é o uso mais comum de
 * overlay, nunca acende alarme.
 */
function isBreaking(kind: ChangeKind, path: (string | number)[]): boolean {
	if (kind === 'added') return false;

	const [root, , method] = path;

	if (root === 'paths') {
		// Sumiu um caminho inteiro ou uma operação.
		if (kind === 'removed' && (path.length === 2 || (path.length === 3 && METHODS.includes(String(method))))) {
			return true;
		}
		// Texto não quebra ninguém.
		const leaf = String(path[path.length - 1]);
		if (['description', 'summary', 'tags', 'externalDocs'].includes(leaf)) return false;
		return kind === 'removed';
	}

	if (root === 'components' && kind === 'removed') return true;
	if (root === 'servers') return true;
	if (root === 'security') return true;

	return false;
}

function walk(
	before: unknown,
	after: unknown,
	path: (string | number)[],
	changes: SemanticChange[]
): void {
	if (before === after) return;

	const bothObjects = isPlainObject(before) && isPlainObject(after);

	if (!bothObjects) {
		if (JSON.stringify(before) === JSON.stringify(after)) return;

		const kind: ChangeKind =
			before === undefined ? 'added' : after === undefined ? 'removed' : 'updated';

		changes.push({
			kind,
			pointer: pointerOf(path),
			label: labelFor(path),
			before,
			after,
			breaking: isBreaking(kind, path),
		});
		return;
	}

	for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
		const next = [...path, key];
		const hasBefore = key in before;
		const hasAfter = key in after;

		if (hasBefore && !hasAfter) {
			changes.push({
				kind: 'removed',
				pointer: pointerOf(next),
				label: labelFor(next),
				before: before[key],
				breaking: isBreaking('removed', next),
			});
			continue;
		}

		if (!hasBefore && hasAfter) {
			changes.push({
				kind: 'added',
				pointer: pointerOf(next),
				label: labelFor(next),
				after: after[key],
				breaking: false,
			});
			continue;
		}

		walk(before[key], after[key], next, changes);
	}
}

export function diffDocuments(
	before: unknown,
	after: unknown,
	unmatched: readonly ActionOutcome[] = []
): OverlayDiff {
	const changes: SemanticChange[] = [];
	walk(before, after, [], changes);

	// Removidos primeiro, depois atualizados, depois adicionados: é a ordem em que
	// alguém revisando quer ver, do mais grave ao mais inócuo.
	const weight = { removed: 0, updated: 1, added: 2 } as const;
	changes.sort((a, b) => weight[a.kind] - weight[b.kind] || a.pointer.localeCompare(b.pointer));

	return {
		changes,
		unmatched: [...unmatched],
		summary: {
			removed: changes.filter((change) => change.kind === 'removed').length,
			added: changes.filter((change) => change.kind === 'added').length,
			updated: changes.filter((change) => change.kind === 'updated').length,
			breaking: changes.filter((change) => change.breaking).length,
		},
	};
}
