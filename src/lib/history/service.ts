/**
 * `DocumentationHistoryService` (P2.1).
 *
 * Reconstrói o passado a partir do Git e responde às cinco perguntas da spec:
 * como esta página evoluiu, como o portal estava naquela data, o que mudou entre
 * dois pontos, o que aquele commit afetou, e como voltar atrás com segurança.
 *
 * Duas regras atravessam o arquivo:
 *
 *  1. **Nada aqui escreve no repositório.** Nem o `restore` — ele escreve no
 *     workspace isolado dos agentes, e o caminho até a branch principal continua
 *     sendo diff → validação → pull request → aprovação humana.
 *  2. **O que não dá para reconstruir com honestidade vem ausente**, não
 *     estimado. Health Score de maio não se recalcula em agosto: ele dependia de
 *     testes e contratos avaliados com as ferramentas daquela época.
 */

import { randomUUID } from 'node:crypto';
import { lintDocument } from '../linter/lint';
import { loadConfig } from '../linter/config';
import { getGlossaryIndex } from '../glossary/loader';
import { setGlossaryIndex } from '../linter/rules/glossary';
import { listSnapshots, snapshotNearest } from '../health/snapshots';
import { analyzeImpactOf } from '../impact/engine';
import { AgentWorkspace } from '../agents/workspace';
import { unifiedDiff } from '../agents/workspace';
import { commitAt, commitInfo, commitsBetween, docsAt, fileAt, hasHistory, resolveRef, timelineOf, treeAt } from './git';
import { semanticDiff } from './semantic';
import type {
	DocumentationDiff,
	DocumentationSnapshot,
	HistoricalImpact,
	HistoryEntry,
	SnapshotComparison,
	SnapshotMetrics,
	SnapshotRef,
} from './types';

const DOCS_PREFIX = 'src/content/docs/';

// ---------------------------------------------------------------------------
// Resolução de referência
// ---------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resolve `HEAD`, um SHA, uma tag ou uma data para um commit.
 *
 * O campo `resolvedFrom` acompanha o resultado porque as três formas erram
 * diferente: uma data cai no commit **anterior** a ela, e quem lê o relatório
 * precisa saber que a comparação é com o estado daquele dia, não com o commit que
 * tem aquela data no assunto.
 */
export async function resolveSnapshotRef(input: string): Promise<SnapshotRef | undefined> {
	if (ISO_DATE.test(input)) {
		const commit = await commitAt(input);
		if (!commit) return undefined;

		const resolved = await resolveRef(commit);
		return { ref: commit, date: resolved?.date, resolvedFrom: 'date' };
	}

	const resolved = await resolveRef(input);
	if (!resolved) return undefined;

	return {
		ref: resolved.commit,
		date: resolved.date,
		resolvedFrom: /^v?\d+\./.test(input) ? 'tag' : 'ref',
	};
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export interface SnapshotOptions {
	/** Calcular a nota do linter sobre o conteúdo daquele commit. É caro. */
	withLint?: boolean;
	/** Limite de páginas lidas — o conteúdo inteiro de um portal grande é pesado. */
	maxPages?: number;
}

export async function getSnapshot(ref: SnapshotRef, options: SnapshotOptions = {}): Promise<DocumentationSnapshot> {
	const paths = await docsAt(ref.ref);
	const limited = options.maxPages ? paths.slice(0, options.maxPages) : paths;

	const pages = await Promise.all(
		limited.map(async (path) => ({ path, content: await fileAt(ref.ref, `${DOCS_PREFIX}${path}`) }))
	);

	return {
		id: randomUUID(),
		timestamp: ref.date ?? new Date().toISOString(),
		gitRef: ref.ref,
		pages,
		metrics: await measure(ref, pages, options),
	};
}

/**
 * As métricas reconstruíveis de um ponto do passado.
 *
 * Contagem de página, palavras, termos de glossário e endpoints saem do conteúdo
 * daquele commit — são exatas. A nota do linter é recalculada com as **regras de
 * hoje**, o que é uma escolha defensável (a régua é a mesma para os dois lados da
 * comparação) e está dito no nome do campo.
 *
 * O Health Score não é recalculado. Ele vem do histórico de medições quando há uma
 * próxima àquela data, e vem ausente quando não há — com `healthMeasured` dizendo
 * qual dos dois casos é.
 */
async function measure(
	ref: SnapshotRef,
	pages: ReadonlyArray<{ path: string; content?: string }>,
	options: SnapshotOptions
): Promise<SnapshotMetrics> {
	const words = pages.reduce((sum, page) => sum + (page.content?.split(/\s+/).length ?? 0), 0);

	const [glossaryFiles, schemaFiles] = await Promise.all([
		treeAt(ref.ref, 'src/content/glossary', /\.mdx?$/),
		treeAt(ref.ref, 'src/schemas', /\.(ya?ml|json)$/),
	]);

	let endpoints = 0;
	for (const file of schemaFiles) {
		const raw = await fileAt(ref.ref, file);
		if (!raw || !/^\s*["']?(openapi|swagger)["']?\s*:/m.test(raw)) continue;
		// Contagem por forma, sem interpretar a especificação inteira: o que se quer
		// aqui é a série ao longo do tempo, e um parser completo por commit tornaria
		// a comparação lenta demais para ser usada.
		endpoints += [...raw.matchAll(/^\s{4}(get|post|put|patch|delete):/gim)].length;
	}

	let lintScore: number | undefined;
	if (options.withLint && pages.length > 0) {
		const config = await loadConfig('default');
		setGlossaryIndex(await getGlossaryIndex());

		const scores: number[] = [];
		for (const page of pages.slice(0, 60)) {
			if (!page.content) continue;
			const result = await lintDocument(page.content, { path: page.path, config });
			scores.push(result.score);
		}

		if (scores.length > 0) lintScore = Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 10) / 10;
	}

	const snapshots = await listSnapshots();
	const target = ref.date ? Date.parse(ref.date) : Date.now();
	const nearest = snapshotNearest(snapshots, 0, Number.isFinite(target) ? target : Date.now());

	// Só aceita a medição de saúde do **mesmo dia**.
	//
	// A janela era de sete dias, e o resultado foi uma comparação entre 12 e 18 de
	// agosto exibindo o mesmo Health Score nas duas pontas — a medição de hoje
	// apresentada como se descrevesse o passado, com delta zero convidando à
	// conclusão de que nada mudou. Um dia é o limite em que a medição ainda fala
	// daquele estado; fora dele, ausente é mais honesto que aproximado.
	const health = nearest && Math.abs(Date.parse(nearest.at) - target) < 86_400_000 ? nearest.score : undefined;

	return {
		pages: pages.length,
		words,
		lintScore,
		glossaryTerms: glossaryFiles.length,
		endpoints,
		health,
		healthMeasured: health !== undefined,
	};
}

// ---------------------------------------------------------------------------
// Comparação
// ---------------------------------------------------------------------------

export async function compare(from: SnapshotRef, to: SnapshotRef, options: SnapshotOptions = {}): Promise<SnapshotComparison> {
	const [before, after, commits] = await Promise.all([
		getSnapshot(from, options),
		getSnapshot(to, options),
		commitsBetween(from.ref, to.ref),
	]);

	const beforePages = new Map(before.pages.map((page) => [page.path, page.content ?? '']));
	const afterPages = new Map(after.pages.map((page) => [page.path, page.content ?? '']));

	const added = [...afterPages.keys()].filter((path) => !beforePages.has(path)).sort();
	const removed = [...beforePages.keys()].filter((path) => !afterPages.has(path)).sort();
	const modified = [...afterPages.keys()]
		.filter((path) => beforePages.has(path) && beforePages.get(path) !== afterPages.get(path))
		.sort();

	const metric = (name: string, left: number | null | undefined, right: number | null | undefined) => ({
		name,
		before: left ?? null,
		after: right ?? null,
		delta: left !== undefined && left !== null && right !== undefined && right !== null ? right - left : null,
	});

	return {
		from,
		to,
		metrics: [
			metric('Páginas', before.metrics?.pages, after.metrics?.pages),
			metric('Palavras', before.metrics?.words, after.metrics?.words),
			metric('Termos de glossário', before.metrics?.glossaryTerms, after.metrics?.glossaryTerms),
			metric('Endpoints', before.metrics?.endpoints, after.metrics?.endpoints),
			metric('Nota do linter', before.metrics?.lintScore, after.metrics?.lintScore),
			metric('Health Score', before.metrics?.health, after.metrics?.health),
		],
		pages: { added, removed, modified },
		commits: commits.length,
	};
}

/** Diff textual e semântico de uma página entre dois pontos. */
export async function diffPage(path: string, from: SnapshotRef, to: SnapshotRef): Promise<DocumentationDiff> {
	const file = `${DOCS_PREFIX}${path}`;

	const [before, after] = await Promise.all([fileAt(from.ref, file), fileAt(to.ref, file)]);

	return {
		path,
		textual: unifiedDiff(path, before ?? '', after ?? ''),
		semantic: semanticDiff(before ?? '', after ?? ''),
	};
}

// ---------------------------------------------------------------------------
// Impacto histórico
// ---------------------------------------------------------------------------

export async function getImpact(ref: string): Promise<HistoricalImpact | undefined> {
	const info = await commitInfo(ref);
	if (!info) return undefined;

	const pages = info.files.filter((file) => file.startsWith(DOCS_PREFIX) && /\.mdx?$/.test(file));

	const product = info.files.filter(
		(file) => file.startsWith('src/schemas/') || file.startsWith('src/pages/api/') || file.startsWith('src/lib/')
	);

	// O que aquele commit mudou de comportamento: compara cada página com o pai.
	const semantic = (
		await Promise.all(
			pages.map(async (file) => {
				const [before, after] = await Promise.all([fileAt(`${info.commit}^`, file), fileAt(info.commit, file)]);
				return semanticDiff(before ?? '', after ?? '');
			})
		)
	).flat();

	// Páginas que mudaram por tabela — o Impact Engine já sabe disso, e refazer o
	// cálculo aqui criaria uma segunda resposta para a mesma pergunta.
	const indirect = new Set<string>();
	for (const file of pages) {
		const impact = await analyzeImpactOf({ file }).catch(() => null);
		for (const item of impact?.items ?? []) {
			if (item.hidden) indirect.add(item.node.path);
		}
	}

	return {
		commit: info.commit,
		subject: info.subject,
		date: info.date,
		author: info.author,
		pages: pages.map((file) => file.slice(DOCS_PREFIX.length)),
		product,
		semantic,
		indirect: [...indirect].sort(),
	};
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

export interface RestoreResult {
	runId: string;
	path: string;
	diff: string;
	semantic: ReturnType<typeof semanticDiff>;
	/** O caminho que a restauração ainda precisa percorrer. */
	nextSteps: string[];
}

/**
 * Restaura uma página a um ponto do passado — **no workspace**.
 *
 * A spec desenha o fluxo e ele é seguido à risca: snapshot → workspace → diff →
 * validação → PR. Nenhuma etapa aqui toca a branch principal, e nem poderia: o
 * workspace dos agentes recusa qualquer caminho fora de `src/content/`, e o
 * repositório só muda quando alguém aprova e aplica.
 *
 * Restaurar é uma operação perigosa disfarçada de simples: o conteúdo antigo pode
 * estar antigo por um bom motivo. Por isso o resultado é um diff para leitura
 * humana, e não uma reversão.
 */
export async function restore(path: string, ref: SnapshotRef): Promise<RestoreResult | undefined> {
	const file = `${DOCS_PREFIX}${path}`;
	const historical = await fileAt(ref.ref, file);
	if (historical === undefined) return undefined;

	const runId = `restore-${randomUUID()}`;
	const workspace = new AgentWorkspace(runId);
	await workspace.prepare();

	const current = await workspace.readOriginal(file);
	await workspace.write(file, historical);

	return {
		runId,
		path,
		diff: unifiedDiff(path, current ?? '', historical),
		semantic: semanticDiff(current ?? '', historical),
		nextSteps: [
			'Revise o diff acima: conteúdo antigo pode estar antigo por um bom motivo.',
			'Rode a validação: `npm run docs:test -- --standard` e `npm run contract -- test`.',
			'Abra o pull request pelo editor; a branch principal não é alterada por esta operação.',
		],
	};
}

// ---------------------------------------------------------------------------
// Serviço (§ API)
// ---------------------------------------------------------------------------

export interface DocumentationHistoryService {
	getTimeline(pageId: string): Promise<HistoryEntry[]>;
	getSnapshot(date: string): Promise<DocumentationSnapshot | undefined>;
	compare(from: string, to: string): Promise<SnapshotComparison | undefined>;
	getImpact(changeId: string): Promise<HistoricalImpact | undefined>;
	restore(pageId: string, at: string): Promise<RestoreResult | undefined>;
	available(): Promise<boolean>;
}

export const documentationHistory: DocumentationHistoryService = {
	async getTimeline(pageId) {
		return timelineOf(pageId);
	},

	async getSnapshot(date) {
		const ref = await resolveSnapshotRef(date);
		return ref ? getSnapshot(ref, { maxPages: 400 }) : undefined;
	},

	async compare(from, to) {
		const [left, right] = await Promise.all([resolveSnapshotRef(from), resolveSnapshotRef(to)]);
		return left && right ? compare(left, right, { maxPages: 400 }) : undefined;
	},

	async getImpact(changeId) {
		return getImpact(changeId);
	},

	async restore(pageId, at) {
		const ref = await resolveSnapshotRef(at);
		return ref ? restore(pageId, ref) : undefined;
	},

	available: hasHistory,
};
