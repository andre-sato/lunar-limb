/**
 * Persistência das execuções e log de auditoria (§30, §33, §43).
 *
 * A §33 é explícita: **nada de memória autônoma persistente** nesta versão. O
 * estado pertence à execução — tarefa, evidências, saídas dos agentes, resultados
 * de validação — e morre com ela. Um agente que acumula memória entre execuções
 * passa a decidir com base em coisas que ninguém consegue auditar.
 *
 * O que fica guardado é o registro do que aconteceu, que é outra coisa: quais
 * fontes foram consultadas, quais ferramentas foram usadas, o que mudou, o que os
 * testes disseram e quem aprovou.
 */

import { readJson, withFileLock, writeJson } from '../auth/store';
import { recordAudit } from '../auth/audit';
import { AgentWorkspace } from './workspace';
import type { AgentRun, RunStatus } from './types';

const FILE = 'agent-runs.json';
const MAX_RUNS = 200;

interface RunFile {
	runs: AgentRun[];
}

export async function saveRun(run: AgentRun): Promise<void> {
	await withFileLock(FILE, async () => {
		const file = await readJson<RunFile>(FILE, { runs: [] });
		const runs = Array.isArray(file.runs) ? file.runs : [];

		const index = runs.findIndex((candidate) => candidate.id === run.id);
		if (index >= 0) runs[index] = run;
		else runs.push(run);

		await writeJson(FILE, { runs: runs.slice(-MAX_RUNS) });
	});
}

export async function listRuns(): Promise<AgentRun[]> {
	const file = await readJson<RunFile>(FILE, { runs: [] });
	const runs = Array.isArray(file.runs) ? file.runs : [];
	return [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getRun(id: string): Promise<AgentRun | undefined> {
	return (await listRuns()).find((run) => run.id === id);
}

async function transition(id: string, status: RunStatus, actorId: string, reason?: string): Promise<AgentRun | undefined> {
	const run = await getRun(id);
	if (!run) return undefined;

	run.status = status;
	run.updatedAt = new Date().toISOString();
	if (reason) run.blockedReason = reason;

	await saveRun(run);
	await recordAudit({
		actorId,
		action: 'AGENT_RUN_REVIEWED',
		metadata: { runId: id, status, files: run.changes.length },
	});

	return run;
}

/**
 * Aprovar é a única porta para o repositório.
 *
 * Ela não escreve nada: marca a execução como aprovada, e o que leva o conteúdo
 * do workspace ao repositório é o passo de aplicação, que é uma ação separada e
 * explícita. Juntar as duas coisas faria "aprovar" e "publicar" virarem o mesmo
 * clique — e o §22 existe para que não sejam.
 */
export async function approveRun(id: string, actorId: string): Promise<AgentRun | undefined> {
	return transition(id, 'approved', actorId);
}

export async function rejectRun(id: string, actorId: string, reason?: string): Promise<AgentRun | undefined> {
	const run = await transition(id, 'rejected', actorId, reason);
	// Rejeitado, o workspace não serve mais para nada e sai do disco.
	if (run) await new AgentWorkspace(id).discard().catch(() => {});
	return run;
}

export async function cancelRun(id: string, actorId: string): Promise<AgentRun | undefined> {
	const run = await transition(id, 'cancelled', actorId);
	if (run) await new AgentWorkspace(id).discard().catch(() => {});
	return run;
}
