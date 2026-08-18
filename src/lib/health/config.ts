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
		// Contrato é o mais rígido depois dos absolutos: documentação que diverge do
		// contrato leva quem lê a errar com confiança.
		contractIntegrity: { target: 99, warning: 4 },
		coverage: { target: 90, warning: 10 },
		freshness: { target: 90, warning: 10 },
		reliability: { target: 99, warning: 4 },
		trust: { target: 90, warning: 15 },
		aiReadiness: { target: 90, warning: 10 },
		consistency: { target: 90, warning: 5 },
		testCoverage: { target: 90, warning: 10 },
		accessibility: { target: 95, warning: 5 },
	},
	minimumHealthScore: 90,
	budgets: {
		// Zero nos dois que não têm justificativa: link morto e contrato quebrado.
		brokenLinks: 0,
		contractFailures: 0,
		failedExamples: 2,
		staleContent: 5,
	},
	webhookConfigured: false,
};

export interface HealthConfig extends SloConfig {
	/**
	 * Guardar o texto das perguntas sem resposta (§7). Desligado por padrão — ver
	 * `analytics.ts` para o porquê.
	 */
	storeQuestions: boolean;
}

type RawTarget = { target?: number; warning?: number; minimum?: number; maximum?: number } | number;

interface RawConfig {
	documentation?: {
		slo?: Record<string, RawTarget>;
		analytics?: { storeUnansweredQuestions?: boolean };
	};
	slo?: Record<string, RawTarget>;
	analytics?: { storeUnansweredQuestions?: boolean };
}

function parseTarget(value: RawTarget | undefined, fallback: SloTarget): SloTarget {
	// Três formas aceitas, porque as três aparecem: `quality: 90` é o que alguém
	// digita por reflexo, `{ target: 90 }` é o que a spec de Health escreve, e
	// `{ minimum: 90 }` é o que a spec de Observability escreve. Recusar duas
	// delas faria a configuração do exemplo não funcionar.
	if (typeof value === 'number') return { target: value, warning: fallback.warning };
	if (!value) return fallback;

	const target = typeof value.target === 'number' ? value.target : typeof value.minimum === 'number' ? value.minimum : undefined;
	if (target === undefined) return fallback;

	return { target, warning: typeof value.warning === 'number' ? value.warning : fallback.warning };
}

/** Contagem máxima, para os orçamentos: aceita número puro ou `{ maximum }`. */
function parseBudget(value: RawTarget | undefined, fallback: number): number {
	if (typeof value === 'number') return value;
	if (value && typeof value.maximum === 'number') return value.maximum;
	if (value && typeof value.target === 'number') return value.target;
	return fallback;
}

export function webhookUrl(): string {
	return (process.env.DOCS_HEALTH_WEBHOOK ?? '').trim();
}

export async function loadHealthConfig(): Promise<HealthConfig> {
	const base: HealthConfig = {
		...DEFAULT_SLO,
		budgets: { ...DEFAULT_SLO.budgets },
		storeQuestions: false,
		webhookConfigured: webhookUrl() !== '',
	};

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

	return {
		dimensions,
		minimumHealthScore: parseTarget(slo.healthScore, {
			target: DEFAULT_SLO.minimumHealthScore,
			warning: 0,
		}).target,
		budgets: {
			brokenLinks: parseBudget(slo.brokenLinks, DEFAULT_SLO.budgets.brokenLinks),
			contractFailures: parseBudget(slo.contractFailures, DEFAULT_SLO.budgets.contractFailures),
			failedExamples: parseBudget(slo.failedExamples, DEFAULT_SLO.budgets.failedExamples),
			staleContent: parseBudget(slo.staleContent, DEFAULT_SLO.budgets.staleContent),
		},
		storeQuestions: analytics?.storeUnansweredQuestions === true,
		webhookConfigured: webhookUrl() !== '',
	};
}
