/**
 * Conversas em memória e limite de uso (§5, §55, §56, §65).
 *
 * As conversas **não são persistidas em disco**, e isso é uma decisão, não uma
 * simplificação: a §65 manda registrar métricas de segurança sem conteúdo de
 * conversa, e gravar o histórico num arquivo criaria exatamente o repositório
 * de perguntas de usuário que o resto do desenho evita. Quem quiser guardar o
 * que perguntou tem a própria tela aberta.
 *
 * Consequência aceita: reiniciar o servidor esvazia as conversas em andamento.
 */

import { randomUUID } from 'node:crypto';
import type { ChatUser, Conversation } from './types';

/** Conversa inativa por mais que isto é descartada. */
const TTL_MS = 2 * 60 * 60 * 1000;
/** Teto por usuário — impede que uma sessão longa cresça sem limite. */
const MAX_CONVERSATIONS_PER_USER = 20;
/** Mensagens mantidas por conversa; o excedente sai pela frente. */
const MAX_MESSAGES = 60;

const conversations = new Map<string, Conversation>();

function sweep(): void {
	const cutoff = Date.now() - TTL_MS;
	for (const [id, conversation] of conversations) {
		if (new Date(conversation.updatedAt).getTime() < cutoff) conversations.delete(id);
	}
}

export function createConversation(user: ChatUser): Conversation {
	sweep();

	const owned = [...conversations.values()]
		.filter((entry) => entry.userId === user.id)
		.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));

	while (owned.length >= MAX_CONVERSATIONS_PER_USER) {
		const oldest = owned.shift();
		if (oldest) conversations.delete(oldest.id);
	}

	const now = new Date().toISOString();
	const conversation: Conversation = {
		id: randomUUID(),
		userId: user.id,
		createdAt: now,
		updatedAt: now,
		messages: [],
	};
	conversations.set(conversation.id, conversation);
	return conversation;
}

/**
 * Recupera a conversa **do próprio usuário**.
 *
 * A checagem de dono é o ponto: o id vem do cliente, e sem ela um id adivinhado
 * ou vazado daria a alguém o histórico de outra pessoa.
 */
export function getConversation(id: string, user: ChatUser): Conversation | null {
	const conversation = conversations.get(id);
	if (!conversation) return null;
	if (conversation.userId !== user.id) return null;
	return conversation;
}

export function getOrCreateConversation(id: string | undefined, user: ChatUser): Conversation {
	if (id) {
		const existing = getConversation(id, user);
		if (existing) return existing;
	}
	return createConversation(user);
}

/** Recorta a conversa depois de um turno, mantendo o começo como resumo. */
export function trimConversation(conversation: Conversation): void {
	if (conversation.messages.length <= MAX_MESSAGES) return;

	const removed = conversation.messages.splice(0, conversation.messages.length - MAX_MESSAGES);

	// Resumo extrativo: as perguntas que saíram, em uma linha. Um resumo gerado
	// por modelo seria melhor e custa uma chamada por turno; ficou fora do
	// escopo desta fase, e o seam para trocá-lo é este.
	const questions = removed
		.filter((entry) => entry.role === 'user')
		.map((entry) => entry.content.slice(0, 120))
		.slice(-6);

	if (questions.length > 0) {
		conversation.summary = `Antes disto o usuário perguntou sobre: ${questions.join('; ')}.`;
	}
}

export function deleteConversation(id: string, user: ChatUser): boolean {
	const conversation = getConversation(id, user);
	if (!conversation) return false;
	conversations.delete(id);
	return true;
}

export function conversationCount(): number {
	sweep();
	return conversations.size;
}

// ---------------------------------------------------------------------------
// Limite de uso (§55)
// ---------------------------------------------------------------------------

interface Bucket {
	windowStart: number;
	count: number;
}

const buckets = new Map<string, Bucket>();
const WINDOW_MS = 60 * 60 * 1000;

export interface RateLimitResult {
	allowed: boolean;
	remaining: number;
	/** Segundos até a janela reabrir; `0` quando ainda há saldo. */
	retryAfter: number;
}

/**
 * Janela fixa por usuário.
 *
 * Janela fixa e não deslizante de propósito: o objetivo é conter abuso e custo,
 * não medir tráfego com precisão, e um contador por usuário custa nada. O
 * limite é por usuário autenticado, então não há como girar identidade sem uma
 * conta nova — que só um admin cria.
 */
export function checkRateLimit(userId: string, limitPerHour: number): RateLimitResult {
	const now = Date.now();
	const bucket = buckets.get(userId);

	if (!bucket || now - bucket.windowStart >= WINDOW_MS) {
		buckets.set(userId, { windowStart: now, count: 1 });
		return { allowed: true, remaining: limitPerHour - 1, retryAfter: 0 };
	}

	if (bucket.count >= limitPerHour) {
		const retryAfter = Math.ceil((bucket.windowStart + WINDOW_MS - now) / 1000);
		return { allowed: false, remaining: 0, retryAfter };
	}

	bucket.count++;
	return { allowed: true, remaining: limitPerHour - bucket.count, retryAfter: 0 };
}

/** Só para testes: zera conversas e contadores. */
export function resetChatState(): void {
	conversations.clear();
	buckets.clear();
}
