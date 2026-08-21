/**
 * Leitura de um arquivo de overlay (spec § 5).
 *
 * O parser aceita YAML e JSON — YAML é um superconjunto de JSON, então o mesmo
 * carregador cobre os dois sem um segundo caminho de código.
 *
 * Ele lê e não julga: um overlay sem `info.title` é carregado com título vazio e
 * reprovado depois pelo validador. Misturar as duas coisas faria uma mensagem de
 * erro de sintaxe aparecer para um problema de conteúdo, e o autor iria procurar
 * o defeito no lugar errado.
 */

import yaml from 'js-yaml';
import type { Overlay, OverlayAction, OverlayGovernance } from './types';

export class OverlayParseError extends Error {}

type Json = Record<string, unknown>;

function readGovernance(raw: unknown): OverlayGovernance {
	if (!raw || typeof raw !== 'object') return {};

	const record = raw as Json;
	const text = (key: string) => (typeof record[key] === 'string' ? (record[key] as string) : undefined);

	return {
		owner: text('owner'),
		purpose: text('purpose'),
		environment: text('environment'),
		status: text('status'),
		scope: text('scope'),
	};
}

/**
 * Lê as ações preservando **a ordem e a posição** de cada uma.
 *
 * Uma entrada malformada não é descartada: ela entra com o que deu para ler, e o
 * validador a reprova citando o índice. Descartar em silêncio faria a ação 3 do
 * relatório ser a ação 4 do arquivo, e ninguém consegue depurar assim.
 */
function readActions(raw: unknown): OverlayAction[] {
	if (!Array.isArray(raw)) return [];

	return raw.map((entry) => {
		const record = (entry ?? {}) as Json;

		return {
			target: typeof record.target === 'string' ? record.target : '',
			description: typeof record.description === 'string' ? record.description : undefined,
			update: 'update' in record ? record.update : undefined,
			remove: record.remove === true,
		};
	});
}

export function parseOverlay(raw: string, source: string): Overlay {
	let document: unknown;

	try {
		document = yaml.load(raw);
	} catch (error) {
		throw new OverlayParseError(
			`Overlay \`${source}\` não é YAML nem JSON válido: ${error instanceof Error ? error.message : error}`
		);
	}

	if (!document || typeof document !== 'object' || Array.isArray(document)) {
		throw new OverlayParseError(`Overlay \`${source}\` está vazio ou não é um mapa.`);
	}

	const record = document as Json;
	const info = (record.info ?? {}) as Json;

	// Extensões `x-*` são preservadas como vieram: elas pertencem a quem escreveu
	// o overlay, e reescrevê-las seria o motor decidir sobre algo que não é dele.
	const extensions = Object.fromEntries(
		Object.entries(record).filter(([key]) => key.startsWith('x-'))
	);

	return {
		overlay: typeof record.overlay === 'string' ? record.overlay : '',
		info: {
			title: typeof info.title === 'string' ? info.title : '',
			version: typeof info.version === 'string' ? info.version : String(info.version ?? ''),
		},
		actions: readActions(record.actions),
		extensions,
		governance: readGovernance(record['x-lunar']),
		source,
	};
}
