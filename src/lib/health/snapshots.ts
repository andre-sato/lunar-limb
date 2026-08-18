/**
 * Histórico, regressões e correlação com mudanças (§12, §13, §14).
 *
 * Esta é a **única** coisa que a camada de observabilidade persiste, e o motivo é
 * simples: histórico não se deriva. Tudo o mais — cobertura, contratos, frescor —
 * é recalculado a cada análise a partir das fontes de verdade, e continuar assim é
 * o que impede o painel de virar mais uma verdade paralela. Mas "a qualidade
 * melhorou ou piorou nos últimos 30 dias?" só se responde se alguém tiver anotado
 * como era antes.
 *
 * O snapshot guarda números, não conteúdo: as dimensões, os contadores de
 * confiabilidade e o commit em que aquilo foi medido. Nenhum texto de página,
 * nenhuma pergunta, nenhum identificador de pessoa.
 */

import { readJson, withFileLock, writeJson } from '../auth/store';

const FILE = 'health-snapshots.json';
const MAX_SNAPSHOTS = 400;

export interface HealthSnapshot {
	/** ISO 8601. */
	at: string;
	score: number;
	dimensions: Record<string, number>;
	reliability: {
		brokenLinks: number;
		failedTests: number;
		brokenContracts: number;
		invalidPages: number;
	};
	/** Commit em que a medição foi feita, quando o Git respondeu. */
	commit?: string;
	/** Branch, para não comparar medições de contextos diferentes sem saber. */
	branch?: string;
}

interface SnapshotFile {
	snapshots: HealthSnapshot[];
}

export async function saveSnapshot(snapshot: HealthSnapshot): Promise<void> {
	await withFileLock(FILE, async () => {
		const file = await readJson<SnapshotFile>(FILE, { snapshots: [] });
		const snapshots = Array.isArray(file.snapshots) ? file.snapshots : [];

		snapshots.push(snapshot);

		// Teto por antiguidade, ao contrário da telemetria de perguntas: aqui o que
		// interessa é a série recente, e o ponto de dois anos atrás não muda
		// nenhuma decisão de hoje.
		const trimmed = snapshots.slice(-MAX_SNAPSHOTS);

		await writeJson(FILE, { snapshots: trimmed });
	});
}

export async function listSnapshots(): Promise<HealthSnapshot[]> {
	const file = await readJson<SnapshotFile>(FILE, { snapshots: [] });
	return Array.isArray(file.snapshots) ? file.snapshots : [];
}

/** Snapshots dentro de uma janela de dias. */
export function withinDays(snapshots: readonly HealthSnapshot[], days: number, now = Date.now()): HealthSnapshot[] {
	const limit = now - days * 86_400_000;
	return snapshots.filter((snapshot) => {
		const at = Date.parse(snapshot.at);
		return Number.isFinite(at) && at >= limit;
	});
}

/**
 * O snapshot mais próximo de N dias atrás.
 *
 * "Mais próximo" e não "o primeiro dentro da janela": comparar hoje com uma
 * medição de 29 dias atrás e chamar isso de "30 dias" seria impreciso de um jeito
 * que ninguém notaria — e o número de comparação precisa ser defensável.
 */
export function snapshotNearest(
	snapshots: readonly HealthSnapshot[],
	daysAgo: number,
	now = Date.now()
): HealthSnapshot | undefined {
	const target = now - daysAgo * 86_400_000;

	let best: HealthSnapshot | undefined;
	let bestDistance = Number.POSITIVE_INFINITY;

	for (const snapshot of snapshots) {
		const at = Date.parse(snapshot.at);
		if (!Number.isFinite(at)) continue;

		const distance = Math.abs(at - target);
		if (distance < bestDistance) {
			best = snapshot;
			bestDistance = distance;
		}
	}

	return best;
}

// ---------------------------------------------------------------------------
// Regressão (§13)
// ---------------------------------------------------------------------------

export interface HealthRegression {
	/** Diferença no score geral. Negativo é piora. */
	delta: number;
	previous: number;
	current: number;
	/** Contribuição de cada dimensão para a diferença. */
	byDimension: Array<{ dimension: string; delta: number }>;
	/** Sinais de confiabilidade que pioraram. */
	newIssues: string[];
	since: string;
}

/**
 * Compara duas medições.
 *
 * Só a diferença **negativa** por dimensão entra em `byDimension`: o pedido da
 * §13 é explicar a queda, e listar as dimensões que melhoraram no meio da
 * explicação de uma piora dilui exatamente o que se quer ler.
 */
export function detectRegression(previous: HealthSnapshot, current: HealthSnapshot): HealthRegression {
	const dimensions = new Set([...Object.keys(previous.dimensions), ...Object.keys(current.dimensions)]);

	const byDimension = [...dimensions]
		.map((dimension) => ({
			dimension,
			delta: (current.dimensions[dimension] ?? 0) - (previous.dimensions[dimension] ?? 0),
		}))
		.filter((entry) => entry.delta < 0)
		.sort((a, b) => a.delta - b.delta);

	const newIssues: string[] = [];
	const compare = (key: keyof HealthSnapshot['reliability'], label: string) => {
		const difference = current.reliability[key] - previous.reliability[key];
		if (difference > 0) newIssues.push(`+${difference} ${label}`);
	};

	compare('brokenLinks', 'link(s) quebrado(s)');
	compare('failedTests', 'teste(s) reprovado(s)');
	compare('brokenContracts', 'contrato(s) quebrado(s)');
	compare('invalidPages', 'página(s) com evidência inválida');

	return {
		delta: current.score - previous.score,
		previous: previous.score,
		current: current.score,
		byDimension,
		newIssues,
		since: previous.at,
	};
}

/**
 * Correlação com mudanças (§14).
 *
 * O que esta função devolve são **candidatos**, e o nome dos campos diz isso. Ela
 * lista os commits entre as duas medições e o que cada um tocou; não afirma
 * causa. Documentação pode degradar porque o produto mudou sem ninguém mexer na
 * documentação — e nesse caso o commit culpado não está nesta lista.
 */
export interface ChangeCandidate {
	commit: string;
	subject: string;
	/** Arquivos de conteúdo, especificação ou código que o commit tocou. */
	relevantFiles: string[];
}

export function correlateChanges(
	commits: ReadonlyArray<{ commit: string; subject: string; files: string[] }>,
	affectedPaths: readonly string[]
): ChangeCandidate[] {
	const targets = new Set(affectedPaths);

	return commits
		.map((entry) => ({
			commit: entry.commit,
			subject: entry.subject,
			relevantFiles: entry.files.filter(
				(file) =>
					targets.has(file) ||
					file.startsWith('src/schemas/') ||
					file.startsWith('src/content/docs/') ||
					file.startsWith('src/pages/api/')
			),
		}))
		.filter((candidate) => candidate.relevantFiles.length > 0)
		.sort((a, b) => b.relevantFiles.length - a.relevantFiles.length)
		.slice(0, 5);
}
