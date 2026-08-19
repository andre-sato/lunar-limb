/**
 * Execução das avaliações (P3.3 — § Automated evaluation).
 *
 * A parte que fala com o assistente. Ela roda em dois regimes, e a diferença
 * entre eles precisa aparecer no relatório em vez de virar um número parecido:
 *
 * - **Com modelo** (`ANTHROPIC_API_KEY` no ambiente): avalia a resposta gerada.
 * - **Só recuperação** (sem chave): o pipeline devolve os trechos encontrados, e
 *   o que está sendo medido é a busca, não a redação. As métricas que dependem de
 *   texto gerado continuam sendo calculadas sobre o trecho — o que é honesto, e
 *   o relatório diz isso em cada caso e no resumo.
 *
 * Chamar as duas de "avaliação do agente" sem distinguir faria uma corrida sem
 * chave parecer uma aprovação do modelo.
 */

import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { createAssistant } from '../chat/service';
import { getOrCreateConversation } from '../chat/store';
import { scoreCase } from './score';
import type {
	CaseResult,
	EvaluationCase,
	EvaluationRun,
	EvaluationSummary,
	EvaluationTrace,
} from './types';

const DOCS_ROOT = path.resolve(process.cwd(), 'src/content/docs');

/** Todas as páginas do portal, para conferir se uma citação existe. */
export async function knownPages(): Promise<Set<string>> {
	const found = new Set<string>();

	async function walk(dir: string, base = ''): Promise<void> {
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const relative = base ? `${base}/${entry.name}` : entry.name;
			if (entry.isDirectory()) await walk(path.join(dir, entry.name), relative);
			else if (/\.mdx?$/.test(entry.name)) found.add(relative);
		}
	}

	await walk(DOCS_ROOT);
	return found;
}

function median(values: readonly number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1] + sorted[middle]) / 2) : sorted[middle];
}

function average(values: readonly (number | null)[]): number | null {
	const measured = values.filter((value): value is number => value !== null);
	if (measured.length === 0) return null;
	return Math.round((measured.reduce((sum, value) => sum + value, 0) / measured.length) * 100) / 100;
}

export interface RunOptions {
	label?: string;
	dataset?: string;
	/** Injetável para os testes descreverem um assistente sem tocar em rede. */
	ask?: (question: string) => Promise<{ text: string; cited: string[]; refused: boolean; retrievalOnly: boolean }>;
}

/**
 * Pergunta ao assistente do portal.
 *
 * Cada caso abre a **própria conversa**: reaproveitar uma faria a resposta de um
 * caso influenciar a do seguinte, e a corrida deixaria de ser reproduzível.
 */
async function defaultAsk(question: string) {
	const assistant = createAssistant();
	const user = { id: 'evaluation', role: 'admin' as const, status: 'active' as const };
	const conversation = getOrCreateConversation(undefined, user);

	const answer = await assistant.ask(conversation, question, user);

	// Uma página citada em três trechos é **uma** citação. Sem a deduplicação, uma
	// resposta que recupera três pedaços da mesma página inflava o denominador de
	// `citationValidity` e diluía o recall.
	const cited = [...new Set(answer.sources.map((source) => source.documentId))];
	const text = [answer.message, ...answer.excerpts.map((excerpt) => excerpt.text)].join('\n\n');

	return {
		text,
		cited,
		// Recusa é o que os guardrails marcaram, ou a ausência de qualquer fonte
		// com um enquadramento de "não encontrei". Inferir recusa a partir do texto
		// livre daria falso positivo em toda resposta que começa com "não".
		refused: answer.safety?.filtered === true || answer.empty,
		retrievalOnly: !process.env.ANTHROPIC_API_KEY,
	};
}

export async function runEvaluation(cases: readonly EvaluationCase[], options: RunOptions = {}): Promise<EvaluationRun> {
	const ask = options.ask ?? defaultAsk;
	const pages = await knownPages();
	const results: CaseResult[] = [];

	for (const testCase of cases) {
		const startedAt = Date.now();

		let answer: Awaited<ReturnType<typeof defaultAsk>>;
		try {
			answer = await ask(testCase.question);
		} catch (error) {
			// Falha de execução **não** é falha do agente. Contá-la como reprovação
			// transformaria uma rede instável em regressão de qualidade.
			results.push({
				caseId: testCase.id,
				dataset: testCase.dataset,
				kind: testCase.kind,
				score: null,
				passed: null,
				metrics: {
					termCoverage: { value: null, judge: 'verifiable', detail: 'Não medido.' },
					citationValidity: { value: null, judge: 'verifiable', detail: 'Não medido.' },
					sourceRecall: { value: null, judge: 'verifiable', detail: 'Não medido.' },
					safety: { value: null, judge: 'verifiable', detail: 'Não medido.' },
				},
				trace: { retrieved: [], cited: [], latencyMs: Date.now() - startedAt, retrievalOnly: false, refused: false, answerChars: 0 },
				notes: [`Não foi possível executar: ${error instanceof Error ? error.message : 'erro desconhecido'}.`],
			});
			continue;
		}

		const trace: EvaluationTrace = {
			retrieved: answer.cited,
			cited: answer.cited,
			latencyMs: Date.now() - startedAt,
			retrievalOnly: answer.retrievalOnly,
			refused: answer.refused,
			answerChars: answer.text.length,
		};

		results.push(scoreCase({ evaluationCase: testCase, answer: answer.text, cited: answer.cited, knownPages: pages, trace }));
	}

	return {
		id: `run-${Date.now()}`,
		at: new Date().toISOString(),
		label: options.label ?? 'local',
		model: process.env.ANTHROPIC_API_KEY ? 'claude-opus-5' : null,
		results,
		summary: summarize(results),
	};
}

export function summarize(results: readonly CaseResult[]): EvaluationSummary {
	const measured = results.filter((result) => result.passed !== null);
	const retrievalOnly = results.length > 0 && results.every((result) => result.trace.retrievalOnly);

	const limitations: string[] = [];
	if (retrievalOnly) {
		limitations.push(
			'Nenhum modelo de linguagem configurado: o que foi medido é a recuperação de trechos, não a resposta gerada.'
		);
	}
	if (results.length - measured.length > 0) {
		limitations.push(`${results.length - measured.length} caso(s) não puderam ser medidos e ficaram fora das médias.`);
	}
	if (results.length < 10) limitations.push('Poucos casos: a média oscila muito e não sustenta comparação entre configurações.');

	return {
		total: results.length,
		passed: measured.filter((result) => result.passed === true).length,
		failed: measured.filter((result) => result.passed === false).length,
		unmeasured: results.length - measured.length,
		averageScore: average(results.map((result) => result.score)),
		termCoverage: average(results.map((result) => result.metrics.termCoverage.value)),
		citationValidity: average(results.map((result) => result.metrics.citationValidity.value)),
		sourceRecall: average(results.map((result) => result.metrics.sourceRecall.value)),
		safety: average(results.map((result) => result.metrics.safety.value)),
		medianLatencyMs: median(results.map((result) => result.trace.latencyMs)),
		retrievalOnly,
		limitations,
	};
}
