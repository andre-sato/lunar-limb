/**
 * Configuração da observabilidade (P3.2 — § Privacy).
 *
 * Ela vive no `health.yml`, junto do resto da telemetria, e não num arquivo
 * novo: espalhar decisões de privacidade por vários arquivos é como uma delas
 * fica desatualizada sem ninguém notar.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { DEFAULT_OBSERVABILITY, type ObservabilityConfig } from './types';

const CONFIG_FILE = path.resolve(process.cwd(), 'health.yml');

interface RawAnalytics {
	storeUnansweredQuestions?: boolean;
	observability?: {
		enabled?: boolean;
		retentionDays?: number;
		minimumSessions?: number;
		windowDays?: number;
	};
}

/**
 * O `health.yml` deste portal aninha tudo sob `documentation:`.
 *
 * A primeira versão deste arquivo só procurava em `analytics:` na raiz, e o
 * resultado foi silencioso da pior forma: nenhum erro, nenhum aviso, e
 * `storeQueryText` sempre `false` — inclusive depois de alguém ligar a chave. As
 * três formas são aceitas porque as três aparecem, e a que este portal usa vem
 * primeiro.
 */
interface RawConfig {
	documentation?: { analytics?: RawAnalytics };
	analytics?: RawAnalytics;
	health?: { analytics?: RawAnalytics };
}

export async function loadObservabilityConfig(): Promise<ObservabilityConfig> {
	let parsed: RawConfig | null | undefined;

	try {
		parsed = yaml.load(await readFile(CONFIG_FILE, 'utf-8')) as RawConfig;
	} catch {
		return DEFAULT_OBSERVABILITY;
	}

	const analytics = parsed?.documentation?.analytics ?? parsed?.analytics ?? parsed?.health?.analytics;
	const block = analytics?.observability;

	const positive = (value: unknown, fallback: number) =>
		typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;

	return {
		enabled: block?.enabled !== false,
		retentionDays: positive(block?.retentionDays, DEFAULT_OBSERVABILITY.retentionDays),
		// O limiar nunca desce abaixo de 2: com 1, uma linha do relatório pode ser
		// uma pessoa, e a agregação deixa de agregar.
		minimumSessions: Math.max(2, positive(block?.minimumSessions, DEFAULT_OBSERVABILITY.minimumSessions)),
		// O texto da busca segue a mesma chave que o resto do portal já respeita.
		storeQueryText: analytics?.storeUnansweredQuestions === true,
		windowDays: positive(block?.windowDays, DEFAULT_OBSERVABILITY.windowDays),
	};
}
