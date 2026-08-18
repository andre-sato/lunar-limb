/**
 * Configuração de SLO (§4).
 *
 * Os alvos ficam em `health.yml`, versionado no Git: um alvo de qualidade é um
 * acordo da equipe, e acordo que só existe na tela de configuração de alguém não
 * sobrevive à troca de time.
 *
 * O destino do webhook de alerta **não** fica aqui. Ele vem do ambiente
 * (`DOCS_HEALTH_WEBHOOK`), porque uma URL de webhook costuma carregar segredo no
 * próprio caminho — e o que carrega segredo não entra no repositório.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import type { HealthDimension, SloConfig, SloTarget } from './types';

const CONFIG_FILE = path.resolve(process.cwd(), 'health.yml');

/**
 * Alvos padrão, usados quando o arquivo não existe.
 *
 * `apiCoverage` em 100 e `brokenLinks` em 0 são os dois absolutos: endpoint sem
 * página e link morto não têm justificativa que valha a pena discutir. Os outros
 * começam em 90 — alto o bastante para exigir trabalho, baixo o bastante para não
 * nascer violado, que é como um SLO perde credibilidade no primeiro dia.
 */
export const DEFAULT_SLO: SloConfig = {
	dimensions: {
		quality: { target: 90, warning: 5 },
		freshness: { target: 95, warning: 10 },
		consistency: { target: 90, warning: 5 },
		testCoverage: { target: 90, warning: 10 },
		apiCoverage: { target: 100, warning: 10 },
		trust: { target: 90, warning: 15 },
		accessibility: { target: 95, warning: 5 },
	},
	brokenLinks: 0,
	webhookConfigured: false,
};

export interface HealthConfig extends SloConfig {
	/**
	 * Guardar o texto das perguntas sem resposta (§7). Desligado por padrão — ver
	 * `analytics.ts` para o porquê.
	 */
	storeQuestions: boolean;
}

interface RawConfig {
	documentation?: {
		slo?: Record<string, { target?: number; warning?: number } | number>;
		analytics?: { storeUnansweredQuestions?: boolean };
	};
	slo?: Record<string, { target?: number; warning?: number } | number>;
	analytics?: { storeUnansweredQuestions?: boolean };
}

function parseTarget(value: { target?: number; warning?: number } | number | undefined, fallback: SloTarget): SloTarget {
	// A spec escreve `quality: { target: 90 }`, mas `quality: 90` é o que alguém
	// digita por reflexo. As duas formas funcionam.
	if (typeof value === 'number') return { target: value, warning: fallback.warning };
	if (!value || typeof value.target !== 'number') return fallback;
	return { target: value.target, warning: typeof value.warning === 'number' ? value.warning : fallback.warning };
}

export function webhookUrl(): string {
	return (process.env.DOCS_HEALTH_WEBHOOK ?? '').trim();
}

export async function loadHealthConfig(): Promise<HealthConfig> {
	const base: HealthConfig = { ...DEFAULT_SLO, storeQuestions: false, webhookConfigured: webhookUrl() !== '' };

	let raw: string;
	try {
		raw = await readFile(CONFIG_FILE, 'utf-8');
	} catch {
		return base;
	}

	let parsed: RawConfig | null | undefined;
	try {
		parsed = yaml.load(raw) as RawConfig;
	} catch {
		// Configuração ilegível cai no padrão em vez de derrubar o painel: um erro
		// de indentação no YAML não deve apagar o indicador de saúde.
		return base;
	}

	const slo = parsed?.documentation?.slo ?? parsed?.slo ?? {};
	const analytics = parsed?.documentation?.analytics ?? parsed?.analytics;

	const dimensions: Partial<Record<HealthDimension, SloTarget>> = {};
	for (const [key, fallback] of Object.entries(DEFAULT_SLO.dimensions) as Array<[HealthDimension, SloTarget]>) {
		dimensions[key] = parseTarget(slo[key], fallback);
	}

	const brokenLinks = slo.brokenLinks;

	return {
		dimensions,
		brokenLinks:
			typeof brokenLinks === 'number'
				? brokenLinks
				: typeof brokenLinks === 'object' && typeof brokenLinks?.target === 'number'
					? brokenLinks.target
					: DEFAULT_SLO.brokenLinks,
		storeQuestions: analytics?.storeUnansweredQuestions === true,
		webhookConfigured: webhookUrl() !== '',
	};
}
