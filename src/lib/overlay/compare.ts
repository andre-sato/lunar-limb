/**
 * Duas especificações → um overlay (spec § 30).
 *
 * `lunar overlay compare --before v1.yaml --after v2.yaml` devolve o overlay que
 * transforma a primeira na segunda. O uso típico não é migração de versão: é
 * alguém que já editou uma cópia à mão e quer transformar aquela edição num
 * artefato versionado e revisável.
 *
 * ## O limite, dito de saída
 *
 * O overlay gerado reproduz o **resultado**, não a intenção. Ele não sabe que
 * cinco descrições mudaram porque a equipe adotou um novo tom; ele emite cinco
 * ações. Um overlay escrito à mão diz por quê, e por isso o gerado é um ponto de
 * partida para revisão, nunca um arquivo para versionar sem ler.
 *
 * É o mesmo motivo pelo qual cada ação sai com `description` preenchida de forma
 * honesta — "gerado por comparação" — em vez de uma frase inventada que pareça
 * uma justificativa.
 */

import { pointerOf } from './jsonpath';
import { labelFor } from './preview';
import type { Overlay, OverlayAction } from './types';

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `['paths', '/users', 'get']` → `$.paths['/users'].get`. */
export function targetFor(path: (string | number)[]): string {
	let expression = '$';

	for (const segment of path) {
		if (typeof segment === 'number') {
			expression += `[${segment}]`;
			continue;
		}
		// Nome simples vai com ponto; qualquer outra coisa precisa de colchete —
		// caminho de endpoint tem barra, e `$.paths./users` não é analisável.
		expression += /^[A-Za-z_][A-Za-z0-9_-]*$/.test(segment)
			? `.${segment}`
			: `['${segment.replaceAll("'", "\\'")}']`;
	}

	return expression;
}

interface Draft {
	path: (string | number)[];
	kind: 'remove' | 'update';
	value?: unknown;
}

/**
 * Percorre as duas árvores acumulando o que mudou.
 *
 * Quando um mapa inteiro é acrescentado ou substituído, a ação é emitida no nó
 * pai em vez de uma por folha: `update` já mescla, então uma ação com o objeto
 * inteiro é equivalente e muito mais legível para quem revisa.
 */
function collect(before: unknown, after: unknown, path: (string | number)[], drafts: Draft[]): void {
	if (JSON.stringify(before) === JSON.stringify(after)) return;

	if (!isPlainObject(before) || !isPlainObject(after)) {
		drafts.push({ path, kind: 'update', value: after });
		return;
	}

	const removed: string[] = [];
	const changed: Record<string, unknown> = {};

	for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
		const inBefore = key in before;
		const inAfter = key in after;

		if (inBefore && !inAfter) {
			removed.push(key);
			continue;
		}

		if (!inBefore && inAfter) {
			changed[key] = after[key];
			continue;
		}

		if (isPlainObject(before[key]) && isPlainObject(after[key])) {
			collect(before[key], after[key], [...path, key], drafts);
			continue;
		}

		if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changed[key] = after[key];
	}

	// Remoções saem uma a uma: `remove` opera sobre o alvo, não sobre uma lista.
	for (const key of removed) drafts.push({ path: [...path, key], kind: 'remove' });

	if (Object.keys(changed).length > 0) drafts.push({ path, kind: 'update', value: changed });
}

export interface CompareOptions {
	before: unknown;
	after: unknown;
	title?: string;
	version?: string;
	owner?: string;
	purpose?: string;
}

export function overlayFromComparison(options: CompareOptions): Overlay {
	const drafts: Draft[] = [];
	collect(options.before, options.after, [], drafts);

	// Remoções primeiro. Se uma remoção e uma atualização caem no mesmo ramo,
	// remover depois desfaria o trabalho da atualização — e o overlay resultante
	// teria uma ação que provavelmente ninguém notaria ser inútil.
	drafts.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'remove' ? -1 : 1));

	const actions: OverlayAction[] = drafts.map((draft) => {
		const label = labelFor(draft.path);
		const where = draft.path.length === 0 ? 'o documento' : `\`${label}\``;

		return draft.kind === 'remove'
			? {
					target: targetFor(draft.path),
					description: `Remove ${where}. Gerado por comparação — confirme a intenção antes de versionar.`,
					remove: true,
				}
			: {
					target: targetFor(draft.path),
					description: `Atualiza ${where}. Gerado por comparação — confirme a intenção antes de versionar.`,
					update: draft.value,
				};
	});

	return {
		overlay: '1.0.0',
		info: {
			title: options.title ?? 'Overlay gerado por comparação',
			version: options.version ?? '1.0.0',
		},
		actions,
		extensions: {},
		governance: { owner: options.owner, purpose: options.purpose },
		source: '(gerado)',
	};
}

/** O overlay como YAML, pronto para gravar. */
export function overlayToYaml(overlay: Overlay): string {
	// Serializado à mão em vez de `yaml.dump` para controlar a ordem das chaves e
	// os comentários: um overlay gerado é um arquivo que alguém vai ler e editar,
	// e a ordem alfabética que o dumper produz atrapalha essa leitura.
	const lines: string[] = [
		'# Overlay gerado por `npm run overlay -- compare`.',
		'#',
		'# Ele reproduz o resultado da comparação, não a intenção por trás dela.',
		'# Revise cada ação e troque a descrição pelo motivo real antes de versionar.',
		'',
		`overlay: ${overlay.overlay}`,
		'',
		'info:',
		`  title: ${JSON.stringify(overlay.info.title)}`,
		`  version: ${JSON.stringify(overlay.info.version)}`,
	];

	if (overlay.governance.owner || overlay.governance.purpose) {
		lines.push('', 'x-lunar:');
		if (overlay.governance.owner) lines.push(`  owner: ${JSON.stringify(overlay.governance.owner)}`);
		if (overlay.governance.purpose) {
			lines.push(`  purpose: ${JSON.stringify(overlay.governance.purpose)}`);
		}
	}

	lines.push('', 'actions:');

	if (overlay.actions.length === 0) {
		lines.push('  # As duas especificações são equivalentes: nada a transformar.');
		return `${lines.join('\n')}\n`;
	}

	for (const action of overlay.actions) {
		lines.push(`  - target: ${JSON.stringify(action.target)}`);
		if (action.description) lines.push(`    description: ${JSON.stringify(action.description)}`);
		if (action.remove) {
			lines.push('    remove: true');
			continue;
		}
		lines.push('    update:');
		for (const line of JSON.stringify(action.update, null, 2).split('\n')) {
			lines.push(`      ${line}`);
		}
	}

	return `${lines.join('\n')}\n`;
}
