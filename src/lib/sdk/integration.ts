/**
 * O SDK dentro dos engines que já existem (§17, §18, §26).
 *
 * A spec é explícita sobre o que **não** fazer: nada de um segundo Impact
 * Engine, nem de um segundo Governance Engine. Este arquivo produz o que essas
 * camadas consomem — itens de impacto, uma dimensão de governança, um sinal de
 * self-healing — e as decisões continuam sendo delas.
 */

import type { ImpactItem } from '../impact/types';
import { diffSpecifications } from './check';
import { generateSdk, loadSdkConfig, readApiModel, readApiModelAt, specificationFor } from './service';
import type { SdkChange } from './types';

// ---------------------------------------------------------------------------
// Impact Engine (§17)
// ---------------------------------------------------------------------------

/**
 * O SDK como mais um artefato afetado por uma mudança de API.
 *
 * A severidade sai da natureza da mudança de contrato, não do tamanho do
 * arquivo gerado: `critical` é reservado ao que quebra o build de quem já
 * instalou o pacote — que é o equivalente, para o SDK, de tornar o texto
 * publicado falso.
 */
export function impactItemsFor(changes: readonly SdkChange[], origin: string): ImpactItem[] {
	return changes
		.filter((change) => change.kind !== 'internal')
		.map((change) => ({
			node: {
				id: `sdk:${change.files[0] ?? change.subject}`,
				type: 'sdk' as const,
				path: change.files[0] ?? 'generated/typescript',
				title: change.subject,
			},
			severity: change.kind === 'breaking' ? ('critical' as const) : ('medium' as const),
			reason:
				change.kind === 'breaking'
					? `${change.detail} Quebra o build de quem já instalou o SDK.`
					: `${change.detail} O SDK precisa ser regerado.`,
			origin,
			via: ['contrato → SDK'],
			// A mudança **não** aparece no diff do pull request: o SDK gerado é outro
			// artefato, e é justamente por isso que ela precisa ser anunciada.
			hidden: true,
		}));
}

export interface SdkImpact {
	items: ImpactItem[];
	breaking: number;
	additive: number;
	regenerate: string[];
	/** `true` quando não deu para comparar — sem base, sem impacto calculável. */
	unavailable: boolean;
}

/**
 * O impacto no SDK de uma mudança de especificação.
 *
 * Quando a base não existe (repositório novo, referência inválida), o resultado
 * é `unavailable` e **não** uma lista vazia: "nada mudou" e "não consegui
 * comparar" são respostas diferentes, e confundi-las faria uma ruptura passar
 * por ausência de ruptura.
 */
export async function analyzeSdkImpact(base = 'HEAD'): Promise<SdkImpact> {
	const config = await loadSdkConfig();

	const [current, previous] = await Promise.all([
		readApiModel(config).catch(() => null),
		readApiModelAt(config, base),
	]);

	if (!current || !previous) {
		return { items: [], breaking: 0, additive: 0, regenerate: [], unavailable: true };
	}

	const generator = Object.values(config.generators)[0];
	if (!generator) return { items: [], breaking: 0, additive: 0, regenerate: [], unavailable: true };

	const diff = diffSpecifications(specificationFor(previous, generator), specificationFor(current, generator));

	return {
		items: impactItemsFor(diff.changes, config.spec),
		breaking: diff.breaking,
		additive: diff.additive,
		regenerate: diff.regenerate,
		unavailable: false,
	};
}

// ---------------------------------------------------------------------------
// Governança (§18)
// ---------------------------------------------------------------------------

export interface SdkGovernanceDimension {
	name: string;
	/** `null` quando não há SDK configurado — não é 0%. */
	percentage: number | null;
	detail: string;
	passed: boolean | null;
}

/**
 * A compatibilidade do SDK como dimensão da governança de API.
 *
 * Duas medidas, e elas respondem coisas diferentes: **sincronia** é "o que está
 * em disco corresponde ao contrato de hoje"; **compatibilidade** é "a mudança
 * desta branch quebra quem já instalou". Um SDK pode estar perfeitamente em
 * sincronia e conter uma ruptura.
 */
export async function sdkGovernance(base = 'HEAD'): Promise<SdkGovernanceDimension[]> {
	const config = await loadSdkConfig();

	const results = await generateSdk({ write: false }).catch(() => []);

	if (results.length === 0) {
		return [
			{ name: 'SDK sincronizado', percentage: null, detail: 'Nenhum gerador habilitado.', passed: null },
			{ name: 'SDK compatível', percentage: null, detail: 'Nenhum gerador habilitado.', passed: null },
		];
	}

	const stale = results.reduce((sum, result) => sum + result.changed.length, 0);
	const total = results.reduce((sum, result) => sum + result.files.length, 0);

	const impact = await analyzeSdkImpact(base);

	return [
		{
			name: 'SDK sincronizado',
			percentage: total === 0 ? null : Math.round(((total - stale) / total) * 100),
			detail:
				stale === 0
					? 'O SDK em disco corresponde à especificação.'
					: `${stale} de ${total} arquivo(s) fora de sincronia. Rode \`npm run sdk -- generate\`.`,
			passed: stale === 0 || !config.failOnStale,
		},
		{
			name: 'SDK compatível',
			percentage: impact.unavailable ? null : impact.breaking === 0 ? 100 : 0,
			detail: impact.unavailable
				? 'Sem base de comparação; a compatibilidade não foi medida.'
				: impact.breaking === 0
					? 'Nenhuma mudança incompatível para quem já instalou.'
					: `${impact.breaking} mudança(s) incompatível(is) com quem já instalou o SDK.`,
			// Não medido é `null`, nunca reprovação: um repositório sem histórico
			// comparável não violou política nenhuma.
			passed: impact.unavailable ? null : impact.breaking === 0,
		},
	];
}

// ---------------------------------------------------------------------------
// Self-healing (§26)
// ---------------------------------------------------------------------------

export interface StaleSdkSignal {
	language: string;
	files: string[];
	summary: string;
}

/**
 * O sinal que o self-healing consome: o SDK está desatualizado.
 *
 * Ele **não** propõe correção. Regerar SDK é rodar `npm run sdk -- generate` —
 * determinístico, sem modelo de linguagem, sem redação. Mandar um agente
 * escrever código de cliente à mão quando existe um gerador seria trocar um
 * processo verificável por um palpite caro.
 */
export async function detectStaleSdk(): Promise<StaleSdkSignal[]> {
	const results = await generateSdk({ write: false }).catch(() => []);

	return results
		.filter((result) => result.changed.length > 0 || result.orphaned.length > 0)
		.map((result) => ({
			language: result.language,
			files: [...result.changed, ...result.orphaned].sort(),
			summary: `O SDK ${result.language} tem ${result.changed.length + result.orphaned.length} arquivo(s) fora de sincronia com a especificação.`,
		}));
}
