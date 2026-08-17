/**
 * Qualidade das respostas do chatbot (§52, §53, §71).
 *
 * Só contadores e votos entram no arquivo — nenhuma pergunta, nenhuma resposta.
 * Isso limita o que o painel pode mostrar (não há como reler uma resposta ruim)
 * e é a troca deliberada: um arquivo com o histórico de perguntas dos leitores
 * seria o dado mais sensível do portal.
 */

import { randomUUID } from 'node:crypto';
import { readJson, withFileLock, writeJson } from '../auth/store';

const FILE = 'chat-feedback.json';
const MAX_ENTRIES = 5000;

export interface AnswerFeedback {
	id: string;
	messageId: string;
	conversationId?: string;
	vote: 'up' | 'down';
	userId: string;
	timestamp: string;
}

interface FeedbackFile {
	entries: AnswerFeedback[];
}

export async function recordAnswerFeedback(input: {
	messageId: string;
	conversationId?: string;
	vote: 'up' | 'down';
	userId: string;
}): Promise<AnswerFeedback> {
	return withFileLock(FILE, async () => {
		const file = await readJson<FeedbackFile>(FILE, { entries: [] });
		const entries = Array.isArray(file.entries) ? file.entries : [];

		// Um voto por mensagem por pessoa: trocar de opinião substitui o voto,
		// clicar duas vezes não conta duas.
		const existing = entries.findIndex(
			(entry) => entry.messageId === input.messageId && entry.userId === input.userId
		);

		const entry: AnswerFeedback = {
			id: existing >= 0 ? entries[existing].id : randomUUID(),
			messageId: input.messageId,
			conversationId: input.conversationId,
			vote: input.vote,
			userId: input.userId,
			timestamp: new Date().toISOString(),
		};

		if (existing >= 0) entries[existing] = entry;
		else entries.push(entry);

		await writeJson(FILE, { entries: entries.slice(-MAX_ENTRIES) });
		return entry;
	});
}

export interface ChatQualitySummary {
	total: number;
	up: number;
	down: number;
	/** Proporção de respostas úteis, ou `null` quando ainda não há votos. */
	satisfaction: number | null;
}

export async function summarizeChatQuality(): Promise<ChatQualitySummary> {
	const file = await readJson<FeedbackFile>(FILE, { entries: [] });
	const entries = Array.isArray(file.entries) ? file.entries : [];

	const up = entries.filter((entry) => entry.vote === 'up').length;
	const down = entries.length - up;

	return {
		total: entries.length,
		up,
		down,
		satisfaction: entries.length === 0 ? null : up / entries.length,
	};
}
