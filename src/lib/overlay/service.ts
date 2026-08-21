/**
 * A Effective OpenAPI, e o ponto onde o resto do portal a consome (spec § 4, § 17).
 *
 * Este arquivo existe para que **um único lugar** saiba que overlays existem. O
 * Explorer, os contratos, o Twin, o SDK e os testes de documentação continuam
 * chamando `parseOpenApi` com uma string — só que agora a string pode ser a da
 * view pedida em vez da do disco.
 *
 *     effectiveSpec(view) → string YAML → parseOpenApi → ApiModel
 *
 * A escolha do formato é essa: **texto entra, texto sai**. Devolver um documento
 * já interpretado obrigaria cada consumidor a saber se recebeu YAML cru ou um
 * objeto, e a resposta variaria conforme a feature estivesse ligada — que é
 * exatamente o tipo de bifurcação que produz defeito só em produção.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { applyOverlays } from './apply';
import { loadOverlayConfig, resolveOverlayPath } from './config';
import { detectConflicts } from './conflicts';
import { parseOverlay } from './parse';
import { diffDocuments } from './preview';
import { validateOverlay } from './validate';
import {
	BASE_VIEW,
	type ApiView,
	type ApplyResult,
	type Conflict,
	type Overlay,
	type OverlayConfig,
	type OverlayDiff,
	type ValidationResult,
} from './types';

const ROOT = process.cwd();

export interface LoadedOverlay {
	overlay: Overlay;
	validation: ValidationResult;
}

export async function loadOverlay(file: string, config?: OverlayConfig): Promise<LoadedOverlay> {
	const absolute = resolveOverlayPath(file);
	const raw = await readFile(absolute, 'utf-8');
	const overlay = parseOverlay(raw, path.relative(ROOT, absolute).replaceAll('\\', '/'));

	return {
		overlay,
		validation: validateOverlay(overlay, { requireGovernance: config?.requireGovernance }),
	};
}

export interface EffectiveSpec {
	view: string;
	/** YAML da especificação efetiva — o que vai para `parseOpenApi`. */
	text: string;
	document: unknown;
	/** O documento base, para diff e relatório. */
	base: unknown;
	overlays: LoadedOverlay[];
	result: ApplyResult | null;
	conflicts: Conflict[];
	config: OverlayConfig;
}

// A especificação é lida muitas vezes por build. O cache é por view e some com o
// processo — nada é persistido, pela mesma razão das outras camadas derivadas: se
// discordar do disco, quem está errado é o cache.
const cache = new Map<string, EffectiveSpec>();

export function clearOverlayCache(): void {
	cache.clear();
}

/**
 * A especificação efetiva de uma view.
 *
 * `base` — ou nenhuma view, ou a feature desligada — devolve o arquivo como está
 * no disco, sem passar pelo motor. Não é uma otimização: é a garantia de que
 * desligar overlays devolve exatamente o comportamento anterior.
 */
export async function effectiveSpecFor(viewName: string = BASE_VIEW): Promise<EffectiveSpec> {
	const cached = cache.get(viewName);
	if (cached) return cached;

	const config = await loadOverlayConfig();
	const specPath = path.resolve(ROOT, config.specification);
	const text = await readFile(specPath, 'utf-8');
	const base = yaml.load(text);

	const view = config.views.find((entry) => entry.name === viewName);

	if (!config.enabled || !view) {
		if (viewName !== BASE_VIEW && config.enabled) {
			throw new Error(
				`View \`${viewName}\` não existe. Declaradas em \`overlays.yml\`: ${config.views.map((entry) => entry.name).join(', ') || 'nenhuma'}.`
			);
		}

		const result: EffectiveSpec = {
			view: BASE_VIEW,
			text,
			document: base,
			base,
			overlays: [],
			result: null,
			conflicts: [],
			config,
		};
		cache.set(viewName, result);
		return result;
	}

	const overlays: LoadedOverlay[] = [];
	for (const file of view.overlays) overlays.push(await loadOverlay(file, config));

	const applied = applyOverlays({ document: base, overlays: overlays.map((entry) => entry.overlay) });
	const conflicts = detectConflicts(applied.outcomes);

	const effective: EffectiveSpec = {
		view: viewName,
		// `noRefs` evita âncoras YAML (`&ref_0` / `*ref_0`) no arquivo gerado: elas
		// são válidas e ilegíveis, e a especificação efetiva é lida por gente.
		text: yaml.dump(applied.document, { noRefs: true, lineWidth: 100 }),
		document: applied.document,
		base,
		overlays,
		result: applied,
		conflicts,
		config,
	};

	cache.set(viewName, effective);
	return effective;
}

/**
 * O YAML da view, para quem só quer alimentar o `parseOpenApi`.
 *
 * É a função que os consumidores existentes chamam no lugar de `readFile`.
 */
export async function effectiveSpecText(view?: string): Promise<string> {
	return (await effectiveSpecFor(view ?? BASE_VIEW)).text;
}

export async function listViews(): Promise<ApiView[]> {
	const config = await loadOverlayConfig();
	if (!config.enabled) return [];
	return config.views;
}

/** Diferença entre a base e a view — o que a spec § 9 chama de preview. */
export async function diffView(viewName: string): Promise<OverlayDiff> {
	const effective = await effectiveSpecFor(viewName);
	return diffDocuments(effective.base, effective.document, effective.result?.unmatched ?? []);
}

// ---------------------------------------------------------------------------
// Política
// ---------------------------------------------------------------------------

export interface ViewProblems {
	view: string;
	invalidOverlays: LoadedOverlay[];
	unmatched: ApplyResult['unmatched'];
	failedTargets: ApplyResult['failed'];
	conflicts: Conflict[];
	/** `true` quando a política configurada manda bloquear. */
	blocking: boolean;
}

/**
 * O que impede esta view de ser publicada.
 *
 * Alvo sem correspondência e conflito bloqueiam **por padrão**, e a razão é a
 * mesma nos dois casos: os dois produzem uma especificação efetiva que parece
 * correta. Um endpoint que deveria ter sumido e continua lá não deixa rastro no
 * arquivo gerado — só a ausência do efeito, que ninguém procura.
 *
 * Alvo com expressão inválida bloqueia sempre, independentemente de política:
 * ali não há resultado a avaliar, a ação simplesmente não rodou.
 */
export async function problemsFor(viewName: string): Promise<ViewProblems> {
	const effective = await effectiveSpecFor(viewName);

	const invalidOverlays = effective.overlays.filter((entry) => !entry.validation.valid);
	const unmatched = effective.result?.unmatched ?? [];
	const failedTargets = effective.result?.failed ?? [];
	const conflicts = effective.conflicts;

	const blocking =
		invalidOverlays.length > 0 ||
		failedTargets.length > 0 ||
		(effective.config.failOnUnmatchedTarget && unmatched.length > 0) ||
		(effective.config.failOnConflict && conflicts.some((entry) => entry.severity === 'error'));

	return { view: viewName, invalidOverlays, unmatched, failedTargets, conflicts, blocking };
}
