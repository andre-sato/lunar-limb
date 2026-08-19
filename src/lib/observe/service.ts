/**
 * `ObservabilityService` (P3.2 — § CLI, § Dashboard).
 *
 * A camada que junta configuração, eventos gravados e análise. Ela não decide
 * nada sobre privacidade — isso está em `config.ts` e no formato do evento, que
 * simplesmente não tem onde guardar quem é a pessoa.
 */

import { analyzeObservability, userSuccessScore } from './analyze';
import { loadObservabilityConfig } from './config';
import { readEvents } from './store';
import type { BehavioralGap, ObservabilityReport } from './types';

export interface ObservabilityService {
	overview(windowDays?: number): Promise<ObservabilityReport>;
	gaps(): Promise<BehavioralGap[]>;
	userSuccess(): Promise<number | null>;
}

export async function collectObservability(windowDays?: number): Promise<ObservabilityReport> {
	const config = await loadObservabilityConfig();
	const effective = windowDays === undefined ? config : { ...config, windowDays };
	const snapshot = await readEvents(effective.windowDays);

	return analyzeObservability({ events: snapshot.events, config: effective, truncated: snapshot.truncated });
}

export const observability: ObservabilityService = {
	overview: collectObservability,

	async gaps() {
		return (await collectObservability()).gaps;
	},

	async userSuccess() {
		return userSuccessScore(await collectObservability());
	},
};
