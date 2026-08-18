/**
 * Analytics de busca e de assistente (§7, §8).
 *
 * Aqui há um conflito real, e ele é resolvido de propósito em favor da
 * privacidade.
 *
 * A §7 pede "top unanswered questions", o que exige guardar o **texto** das
 * perguntas dos leitores. O portal já tinha decidido o contrário: o arquivo de
 * qualidade do chatbot guarda apenas contadores e votos, "nenhuma pergunta,
 * nenhuma resposta", porque um histórico de perguntas seria o dado mais sensível
 * do portal — é onde as pessoas escrevem o que não sabem, e às vezes com o que
 * estão trabalhando.
 *
 * A saída adotada:
 *
 *  - **Contadores sempre.** Quantas consultas, quantas com confiança alta, baixa,
 *    quantas sem resposta. Isso responde à §8 inteira e não guarda texto nenhum.
 *  - **Texto só com autorização explícita.** `analytics.storeUnansweredQuestions`
 *    em `health.yml`, desligado por padrão. Ligado, guarda apenas a pergunta que
 *    **não** foi respondida, sem identificação de quem perguntou, truncada, com
 *    credenciais redigidas e com teto de registros.
 *
 * Sem o texto, as lacunas continuam sendo detectadas pelos outros sinais —
 * endpoint sem página, voto negativo, evidência inválida, teste falhando. O que
 * se perde é a lista de perguntas, e essa perda é uma escolha de quem opera o
 * portal, não uma feita por mim em nome dele.
 */

import { readJson, withFileLock, writeJson } from '../auth/store';
import { redactSecrets } from '../chat/sanitize';

const FILE = 'search-analytics.json';
const MAX_QUESTIONS = 500;
const MAX_QUESTION_CHARS = 160;

export interface AnalyticsCounters {
	queries: number;
	highConfidence: number;
	mediumConfidence: number;
	lowConfidence: number;
	/** Consultas em que nada passou do limiar de relevância. */
	unanswered: number;
	/** Consultas recusadas por guardrail — contadas, nunca registradas. */
	refused: number;
}

export interface UnansweredQuestion {
	/** Texto normalizado. Só existe quando o registro está ligado. */
	question: string;
	count: number;
	lastSeen: string;
}

interface AnalyticsFile {
	counters: AnalyticsCounters;
	questions: UnansweredQuestion[];
}

const EMPTY: AnalyticsFile = {
	counters: { queries: 0, highConfidence: 0, mediumConfidence: 0, lowConfidence: 0, unanswered: 0, refused: 0 },
	questions: [],
};

/** Normaliza a pergunta para agrupar variações da mesma dúvida. */
export function normalizeQuestion(text: string): string {
	return redactSecrets(text)
		.text.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^\p{L}\p{N}\s?]/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, MAX_QUESTION_CHARS);
}

export interface RecordInput {
	confidence: 'high' | 'medium' | 'low';
	empty: boolean;
	refused?: boolean;
	/** Texto da pergunta. Ignorado quando o registro está desligado. */
	question?: string;
	/** Vem da configuração; sem ele, nenhum texto é gravado. */
	storeQuestions: boolean;
}

export async function recordSearchEvent(input: RecordInput): Promise<void> {
	await withFileLock(FILE, async () => {
		const file = await readJson<AnalyticsFile>(FILE, EMPTY);
		const counters = { ...EMPTY.counters, ...file.counters };
		const questions = Array.isArray(file.questions) ? file.questions : [];

		counters.queries++;
		if (input.refused) counters.refused++;
		if (input.empty) counters.unanswered++;
		if (input.confidence === 'high') counters.highConfidence++;
		else if (input.confidence === 'medium') counters.mediumConfidence++;
		else counters.lowConfidence++;

		// O texto só entra aqui quando duas coisas são verdade: o registro está
		// ligado **e** a consulta ficou sem resposta. Pergunta respondida não vira
		// registro — ela não é lacuna, e guardá-la seria só coletar.
		if (input.storeQuestions && input.empty && input.question) {
			const normalized = normalizeQuestion(input.question);
			if (normalized.length >= 8) {
				const existing = questions.find((entry) => entry.question === normalized);
				if (existing) {
					existing.count++;
					existing.lastSeen = new Date().toISOString();
				} else {
					questions.push({ question: normalized, count: 1, lastSeen: new Date().toISOString() });
				}
			}
		}

		// Teto por frequência, não por ordem de chegada: o que interessa manter é a
		// dúvida recorrente, e descartar por antiguidade jogaria fora justamente a
		// que se repete desde o começo.
		const trimmed = [...questions].sort((a, b) => b.count - a.count).slice(0, MAX_QUESTIONS);

		await writeJson(FILE, { counters, questions: trimmed });
	});
}

export interface AnalyticsSummary {
	counters: AnalyticsCounters;
	/** Perguntas sem resposta mais frequentes. Vazio quando o registro está desligado. */
	topUnanswered: UnansweredQuestion[];
	/** `true` quando o texto das perguntas está sendo guardado. */
	questionsStored: boolean;
}

export async function summarizeAnalytics(storeQuestions: boolean): Promise<AnalyticsSummary> {
	const file = await readJson<AnalyticsFile>(FILE, EMPTY);
	const questions = Array.isArray(file.questions) ? file.questions : [];

	return {
		counters: { ...EMPTY.counters, ...file.counters },
		topUnanswered: [...questions].sort((a, b) => b.count - a.count).slice(0, 10),
		questionsStored: storeQuestions,
	};
}

/** Apaga o texto guardado, mantendo os contadores. */
export async function forgetQuestions(): Promise<void> {
	await withFileLock(FILE, async () => {
		const file = await readJson<AnalyticsFile>(FILE, EMPTY);
		await writeJson(FILE, { counters: { ...EMPTY.counters, ...file.counters }, questions: [] });
	});
}
