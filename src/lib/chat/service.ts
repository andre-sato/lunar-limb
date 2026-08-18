/**
 * Pipeline do assistente (§2).
 *
 *   entrada → guardrails → recuperação → autorização → contexto → modelo
 *   → guardrails de saída → validação de citação → resposta
 *
 * **Os dois modos são o mesmo pipeline.** Com credencial de modelo, ele redige
 * a resposta a partir dos trechos; sem credencial, devolve os trechos e as
 * fontes. A busca, a autorização, os guardrails de entrada e a validação de
 * citação rodam nos dois casos — o modelo é a última etapa, não a espinha.
 *
 * Isso não é degradação por conveniência: o modo sem modelo é **imune por
 * construção** a alucinação e a injeção indireta, porque não há nada a instruir.
 * Ele continua sendo a configuração padrão do portal.
 */

import { randomUUID } from 'node:crypto';
import { classifyInputDeterministic, isAllowed, refusalFor } from './guardrails';
import { detectPii, detectSecrets, redactSecrets } from './sanitize';
import { buildPrompt, NO_CONTEXT_ANSWER, NOT_ENOUGH_CONTEXT_ANSWER } from './prompt';
import { retrieveDocumentation, toSourceReferences } from './retrieval';
import { excerptFrom, canUseChat, normalizeQuery, ChatError, MAX_QUERY_CHARS } from './search';
import { summarize } from './summary';
import type { ChatModel, ChatUser, Conversation, Excerpt, RetrievedChunk, SourceReference } from './types';

/** Confiança da resposta (§8). */
export type Confidence = 'high' | 'medium' | 'low';

export interface AssistantAnswer {
	message: string;
	excerpts: Excerpt[];
	sources: SourceReference[];
	confidence: Confidence;
	/** `true` quando a resposta veio dos trechos, sem modelo. */
	retrievalOnly: boolean;
	empty: boolean;
	conversationId: string;
	messageId: string;
	/** Preenchido quando um guardrail interveio. */
	safety?: { filtered: boolean; reason?: string };
}

export interface AssistantOptions {
	/** Ausente ou não configurado: o pipeline responde com os trechos. */
	model?: ChatModel;
	maxOutputTokens?: number;
	maxExcerpts?: number;
	minScore?: number;
	excerptChars?: number;
	/** Filtro de autorização aplicado **antes** do contexto ir ao modelo (§11). */
	authorize?: (chunk: RetrievedChunk, user: ChatUser) => boolean;
	onEvent?: (event: { event: string; userId: string; detail?: string }) => void | Promise<void>;
}

/**
 * Confiança a partir do que a busca trouxe (§8).
 *
 * O sinal é a relevância do melhor trecho e quantos trechos a sustentam. Um
 * único trecho fraco é a situação em que o assistente mais erra, e é onde a
 * resposta conservadora vale mais que a tentativa.
 */
export function confidenceFrom(chunks: readonly RetrievedChunk[]): Confidence {
	if (chunks.length === 0) return 'low';

	const best = chunks[0]?.score ?? 0;
	if (best >= 0.9 && chunks.length >= 2) return 'high';
	if (best >= 0.6) return 'medium';
	return 'low';
}

/**
 * Confere que a resposta não cita o que não foi recuperado (§12).
 *
 * Uma citação inventada é pior que nenhuma: ela dá aparência de fundamento a
 * uma frase que não tem. Como as fontes são anexadas pelo sistema e não pelo
 * modelo, o que se verifica aqui é o texto não afirmar página nenhuma além das
 * que entraram no contexto.
 */
export function validateCitations(
	answer: string,
	sources: readonly SourceReference[]
): { valid: boolean; invented: string[] } {
	const allowed = new Set(sources.map((source) => source.url.toLowerCase()));
	const invented: string[] = [];

	// Só caminhos internos: um link externo na resposta é outro problema, tratado
	// pelo guardrail de saída.
	for (const match of answer.matchAll(/\((\/[^\s)]+)\)/g)) {
		const url = match[1].toLowerCase();
		if (!allowed.has(url)) invented.push(match[1]);
	}

	return { valid: invented.length === 0, invented };
}

/**
 * Guardrail de saída (§12).
 *
 * Vazamento do prompt bloqueia a resposta inteira; credencial é **removida** e o
 * resto sobrevive. A diferença é que não há como editar um vazamento de
 * instruções sem produzir outra resposta, enquanto uma credencial retirada deixa
 * um texto ainda útil.
 */
export function checkOutput(
	text: string,
	systemPrompt: string
): { blocked: boolean; text: string; categories: string[]; redacted: number } {
	const categories: string[] = [];

	const markers = ['Regra de isolamento', 'documentation_context', 'dado não confiável', 'user_question'];
	const leaked = markers.filter((marker) => text.includes(marker)).length;
	// Um marcador pode aparecer ao explicar o mecanismo; dois indicam reprodução.
	if (leaked >= 2) {
		return { blocked: true, text, categories: ['system-prompt-leak'], redacted: 0 };
	}

	const longLines = systemPrompt
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 60);
	if (longLines.some((line) => text.includes(line))) {
		return { blocked: true, text, categories: ['system-prompt-leak'], redacted: 0 };
	}

	if (detectSecrets(text).length > 0) categories.push('secret-exposure');
	const { text: cleaned, redacted } = redactSecrets(text);
	if (detectPii(cleaned).length > 0) categories.push('pii-exposure');

	return { blocked: false, text: cleaned, categories, redacted };
}

export function createAssistant(options: AssistantOptions = {}) {
	const generates = Boolean(options.model?.isConfigured());

	async function ask(
		conversation: Conversation,
		message: string,
		user: ChatUser
	): Promise<AssistantAnswer> {
		if (!canUseChat(user)) throw new ChatError('unauthorized', 'Sem permissão para usar o assistente.');

		const trimmed = message.trim();
		if (trimmed === '') throw new ChatError('empty', 'Pergunta vazia.');
		if (trimmed.length > MAX_QUERY_CHARS) {
			throw new ChatError('too_long', `Encurte a pergunta para até ${MAX_QUERY_CHARS} caracteres.`);
		}

		// --- guardrail de entrada (§10) -------------------------------------
		const recent = conversation.messages.slice(-6).map((entry) => entry.content).join('\n');
		const safety = classifyInputDeterministic(trimmed, { conversationContext: recent });

		if (!isAllowed(safety)) {
			await options.onEvent?.({
				event: safety.risk === 'jailbreak' ? 'CHAT_JAILBREAK' : 'CHAT_BLOCKED',
				userId: user.id,
				detail: safety.categories.join(','),
			});

			const refusal = refusalFor(safety);
			appendTurn(conversation, trimmed, refusal, [], []);
			return {
				message: refusal,
				excerpts: [],
				sources: [],
				confidence: 'low',
				retrievalOnly: !generates,
				empty: true,
				conversationId: conversation.id,
				messageId: randomUUID(),
				safety: { filtered: true, reason: safety.risk },
			};
		}

		// --- recuperação ------------------------------------------------------
		const query = normalizeQuery(trimmed, conversation.messages);
		const found = await retrieveDocumentation(query, {
			threshold: options.minScore,
			maxChunks: options.maxExcerpts,
			locale: conversation.locale,
		});

		// --- autorização **antes** do contexto (§11) --------------------------
		// A ordem é o ponto: filtrar depois da geração significaria que o modelo
		// já leu o que a pessoa não pode ver, e uma resposta filtrada ainda
		// vazaria pela forma como foi escrita.
		const chunks = options.authorize
			? found.filter((chunk) => options.authorize!(chunk, user))
			: found;

		if (chunks.length < found.length) {
			await options.onEvent?.({
				event: 'CHAT_CONTEXT_FILTERED',
				userId: user.id,
				detail: String(found.length - chunks.length),
			});
		}

		const excerpts = chunks
			.map((chunk) => excerptFrom(chunk, options.excerptChars ?? 700))
			.filter((excerpt): excerpt is Excerpt => excerpt !== null);
		const sources = toSourceReferences(chunks);
		const confidence = confidenceFrom(chunks);

		if (excerpts.length === 0) {
			appendTurn(conversation, trimmed, NO_CONTEXT_ANSWER, [], []);
			return {
				message: NO_CONTEXT_ANSWER,
				excerpts: [],
				sources: [],
				confidence: 'low',
				retrievalOnly: !generates,
				empty: true,
				conversationId: conversation.id,
				messageId: randomUUID(),
			};
		}

		// --- sem modelo: os trechos são a resposta ---------------------------
		if (!generates) {
			const summary = summarize(excerpts);
			appendTurn(conversation, trimmed, summary, excerpts, sources);
			return {
				message: summary,
				excerpts,
				sources,
				confidence,
				retrievalOnly: true,
				empty: false,
				conversationId: conversation.id,
				messageId: randomUUID(),
			};
		}

		// --- confiança baixa: não vale gerar (§8) ----------------------------
		// Gerar a partir de evidência fraca é exatamente onde o assistente
		// inventa. Os trechos continuam ali para quem quiser julgar sozinho.
		if (confidence === 'low') {
			const conservative = `${NOT_ENOUGH_CONTEXT_ANSWER}\n\n${summarize(excerpts)}`;
			appendTurn(conversation, trimmed, conservative, excerpts, sources);
			return {
				message: conservative,
				excerpts,
				sources,
				confidence,
				retrievalOnly: true,
				empty: false,
				conversationId: conversation.id,
				messageId: randomUUID(),
			};
		}

		// --- modelo ------------------------------------------------------------
		const prompt = buildPrompt({
			message: trimmed,
			history: conversation.messages,
			summary: conversation.summary,
			chunks,
		});

		if (prompt.indirectInjectionDetected) {
			await options.onEvent?.({
				event: 'CHAT_INDIRECT_INJECTION',
				userId: user.id,
				detail: 'documentação com forma de instrução',
			});
		}

		let generated: string;
		try {
			const result = await options.model!.generate({
				systemPrompt: prompt.systemPrompt,
				messages: prompt.messages,
				maxOutputTokens: options.maxOutputTokens ?? 2048,
				temperature: 0,
			});
			generated = result.text;
		} catch {
			// Falha do provedor não vira resposta inventada: cai nos trechos, que
			// continuam sendo uma resposta útil.
			const fallback = summarize(excerpts);
			appendTurn(conversation, trimmed, fallback, excerpts, sources);
			return {
				message: fallback,
				excerpts,
				sources,
				confidence,
				retrievalOnly: true,
				empty: false,
				conversationId: conversation.id,
				messageId: randomUUID(),
			};
		}

		// --- guardrail de saída e citações (§12) -----------------------------
		const output = checkOutput(generated, prompt.systemPrompt);

		if (output.blocked) {
			await options.onEvent?.({
				event: 'CHAT_OUTPUT_BLOCKED',
				userId: user.id,
				detail: output.categories.join(','),
			});
			const refusal = 'Não consigo fornecer essa resposta. Posso tentar de outra forma?';
			appendTurn(conversation, trimmed, refusal, [], []);
			return {
				message: refusal,
				excerpts: [],
				sources: [],
				confidence: 'low',
				retrievalOnly: false,
				empty: true,
				conversationId: conversation.id,
				messageId: randomUUID(),
				safety: { filtered: true, reason: 'saída bloqueada' },
			};
		}

		const citations = validateCitations(output.text, sources);
		let text = output.text.trim() === '' ? NOT_ENOUGH_CONTEXT_ANSWER : output.text;

		if (!citations.valid) {
			// Citação para página que não entrou no contexto é invenção. Em vez de
			// devolver a resposta com um link falso, o texto cai para os trechos.
			await options.onEvent?.({
				event: 'CHAT_INVALID_CITATION',
				userId: user.id,
				detail: citations.invented.join(','),
			});
			text = summarize(excerpts);
		}

		appendTurn(conversation, trimmed, text, excerpts, sources);

		return {
			message: text,
			excerpts,
			sources,
			confidence,
			retrievalOnly: !citations.valid,
			empty: false,
			conversationId: conversation.id,
			messageId: randomUUID(),
			safety: output.redacted > 0 ? { filtered: true, reason: 'credenciais removidas' } : undefined,
		};
	}

	return { ask, generates };
}

function appendTurn(
	conversation: Conversation,
	question: string,
	answer: string,
	excerpts: Excerpt[],
	sources: SourceReference[]
): void {
	const now = new Date().toISOString();
	conversation.messages.push({ role: 'user', content: question, timestamp: now });
	conversation.messages.push({ role: 'assistant', content: answer, timestamp: now, excerpts, sources });
	conversation.updatedAt = now;
}
