/**
 * De onde veio cada alteração da especificação efetiva (spec § 27).
 *
 * A pergunta que isto responde é a que aparece meses depois: *este campo está
 * assim por quê?* Sem proveniência, a resposta exige abrir cinco overlays e
 * simular a ordem de aplicação de cabeça.
 *
 * A camada segue a mesma regra da proveniência de conteúdo do portal
 * (ADR sobre confiança e proveniência): ela registra **de onde veio**, não
 * afirma que está certo. Saber que `GET /users` foi alterado pela ação 2 de
 * `public.yaml` não diz que a alteração era desejável.
 */

import { labelFor } from './preview';
import type { ProvenanceEntry } from './types';

/** `/paths/~1users/get` → `['paths', '/users', 'get']`. */
function segmentsOf(pointer: string): string[] {
	if (pointer === '') return [];
	return pointer
		.slice(1)
		.split('/')
		.map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
}

export interface NodeHistory {
	pointer: string;
	label: string;
	/** Na ordem em que as alterações aconteceram. */
	entries: ProvenanceEntry[];
	/** `true` quando o nó deixou de existir na especificação efetiva. */
	removed: boolean;
}

/** A história de cada nó tocado, do mais mexido para o menos. */
export function historyByNode(provenance: readonly ProvenanceEntry[]): NodeHistory[] {
	const byPointer = new Map<string, ProvenanceEntry[]>();

	for (const entry of provenance) {
		const list = byPointer.get(entry.pointer) ?? [];
		list.push(entry);
		byPointer.set(entry.pointer, list);
	}

	return [...byPointer.entries()]
		.map(([pointer, entries]) => ({
			pointer,
			label: labelFor(segmentsOf(pointer)),
			entries,
			removed: entries.some((entry) => entry.kind === 'remove'),
		}))
		.sort((a, b) => b.entries.length - a.entries.length || a.pointer.localeCompare(b.pointer));
}

/**
 * A história de um nó específico, incluindo a dos seus ancestrais.
 *
 * Um endpoint pode não ter sido tocado diretamente e ainda assim ter mudado
 * porque `$.paths.*` foi atualizado. Olhar só o ponteiro exato responderia
 * "ninguém mexeu nisto" sobre um nó que mudou.
 */
export function historyFor(
	provenance: readonly ProvenanceEntry[],
	pointer: string
): ProvenanceEntry[] {
	return provenance.filter(
		(entry) =>
			entry.pointer === pointer ||
			pointer.startsWith(`${entry.pointer}/`) ||
			entry.pointer.startsWith(`${pointer}/`)
	);
}

/** Um resumo legível, no formato que a spec § 27 desenha. */
export function describeHistory(history: NodeHistory): string {
	const lines = [history.label, ''];

	for (const entry of history.entries) {
		lines.push(`${entry.kind === 'remove' ? 'Removido' : 'Alterado'} por:`);
		lines.push(`  ${entry.overlay}, ação #${entry.action + 1}`);
		if (entry.description) lines.push(`  ${entry.description}`);
		lines.push('');
	}

	return lines.join('\n').trimEnd();
}
