/**
 * Persistência das corridas de avaliação (P3.3).
 *
 * Em `data/`, que é gitignored. Guardar corridas no repositório encheria o
 * histórico com resultado de execução — e a corrida de ontem não é um acordo da
 * equipe, ao contrário do conjunto de perguntas, que fica em `evals/` e é
 * versionado de propósito.
 */

import { readJson, withFileLock, writeJson } from '../auth/store';
import type { EvaluationRun } from './types';

const FILE = 'ai-evaluations.json';
const MAX_RUNS = 40;

interface RunsFile {
	runs: EvaluationRun[];
}

export async function saveRun(run: EvaluationRun): Promise<void> {
	await withFileLock(FILE, async () => {
		const file = await readJson<RunsFile>(FILE, { runs: [] });
		const runs = [...file.runs, run].slice(-MAX_RUNS);
		await writeJson(FILE, { runs } satisfies RunsFile);
	});
}

export async function listRuns(): Promise<EvaluationRun[]> {
	return (await readJson<RunsFile>(FILE, { runs: [] })).runs;
}

/**
 * A corrida mais recente com um rótulo.
 *
 * Rótulo é como a comparação encontra as duas pontas: `baseline` e `candidate`
 * são apenas nomes, e quem decide o que cada um significa é quem roda.
 */
export async function latestRun(label?: string): Promise<EvaluationRun | undefined> {
	const runs = await listRuns();
	const matching = label ? runs.filter((run) => run.label === label) : runs;
	return matching.at(-1);
}
