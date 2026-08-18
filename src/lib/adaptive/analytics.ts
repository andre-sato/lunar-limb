/**
 * Analytics de contexto (§13).
 *
 * Contadores por audiência, e nada além disso. Nem pergunta, nem página, nem
 * identificador de quem leu — só "quantas consultas vieram de cada perfil" e
 * "quantas delas ficaram sem resposta".
 *
 * A escolha segue a mesma linha do resto do portal: o que sustenta uma decisão de
 * documentação é a distribuição, não o rastro individual. Saber que 82% das
 * consultas vêm de quem desenvolve muda a prioridade do backlog; saber *quem*
 * perguntou *o quê* não muda nada que já não fosse decidido pela distribuição, e
 * cria um arquivo que precisaria ser protegido para sempre.
 *
 * O resultado alimenta o Health Center (§13, última linha da spec).
 */

import { readJson, withFileLock, writeJson } from '../auth/store';
import { AUDIENCES, type Audience } from './types';

const FILE = 'audience-analytics.json';

export interface AudienceCounters {
	/** Consultas por audiência declarada. `unknown` é quem não escolheu perfil. */
	byAudience: Record<string, number>;
	/** Consultas sem resposta, por audiência — onde falta documentação para quem. */
	unansweredByAudience: Record<string, number>;
	total: number;
}

const EMPTY: AudienceCounters = { byAudience: {}, unansweredByAudience: {}, total: 0 };

export async function recordAudienceEvent(audience: Audience | undefined, unanswered: boolean): Promise<void> {
	const key = audience ?? 'unknown';

	await withFileLock(FILE, async () => {
		const file = await readJson<AudienceCounters>(FILE, EMPTY);
		const byAudience = { ...EMPTY.byAudience, ...file.byAudience };
		const unansweredByAudience = { ...EMPTY.unansweredByAudience, ...file.unansweredByAudience };

		byAudience[key] = (byAudience[key] ?? 0) + 1;
		if (unanswered) unansweredByAudience[key] = (unansweredByAudience[key] ?? 0) + 1;

		await writeJson(FILE, { byAudience, unansweredByAudience, total: (file.total ?? 0) + 1 });
	});
}

export interface AudienceSummary {
	total: number;
	/** Distribuição em pontos percentuais, do maior para o menor. */
	distribution: Array<{ audience: string; queries: number; share: number; unanswered: number }>;
}

export async function summarizeAudiences(): Promise<AudienceSummary> {
	const file = await readJson<AudienceCounters>(FILE, EMPTY);
	const byAudience = { ...EMPTY.byAudience, ...file.byAudience };
	const unansweredByAudience = { ...EMPTY.unansweredByAudience, ...file.unansweredByAudience };
	const total = file.total ?? 0;

	const keys = new Set<string>([...Object.keys(byAudience), ...(AUDIENCES as readonly string[])]);

	return {
		total,
		distribution: [...keys]
			.map((audience) => ({
				audience,
				queries: byAudience[audience] ?? 0,
				share: total === 0 ? 0 : Math.round(((byAudience[audience] ?? 0) / total) * 100),
				unanswered: unansweredByAudience[audience] ?? 0,
			}))
			// Audiência sem nenhuma consulta não entra: uma linha em zero para cada
			// perfil possível é ruído que esconde a distribuição real.
			.filter((entry) => entry.queries > 0)
			.sort((a, b) => b.queries - a.queries),
	};
}
