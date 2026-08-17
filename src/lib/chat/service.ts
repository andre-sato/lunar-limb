/**
 * Pipeline do chatbot (§62, §81).
 *
 *   autenticar → autorizar → guardrail de entrada → normalizar consulta
 *   → retrieval → guardrail de contexto → modelo → guardrail de saída → resposta
 *
 * Cada etapa é uma função separada e o serviço as encadeia. É o que permite
 * testar "o guardrail de saída bloqueia isto?" sem subir modelo nem rede.
 */

import { randomUUID } from 'node:crypto';
import { classifyInputDeterministic, isAllowed, refusalFor } from './guardrails';
import { detectSecrets, detectPii, redactSecrets } from './sanitize';
import { retrieveDocumentation, toSourceReferences } from './retrieval';
import { buildPrompt, NO_CONTEXT_ANSWER, NOT_ENOUGH_CONTEXT_ANSWER, DEFAULT_BUDGET } from './prompt';
import { trimConversation } from './store';
import type {
	ChatMessage,
	ChatModel,
	ChatResponse,
	ChatSecurityEvent,
	ChatUser,
	Conversation,
	SafetyClassification,
} from './types';

export interface ChatServiceOptions {
	model: ChatModel;
	/** `false` quando não há credencial: responde só com os trechos. */
	generationEnabled: boolean;
	maxOutputTokens?: number;
	retrievalThreshold?: number;
	maxChunks?: number;
	/** Registra evento de segurança; nunca recebe conteúdo de conversa (§65). */
	onEvent?: (event: ChatSecurityEvent) => void | Promise<void>;
}

/** Limite de entrada (§56). Medido em caracteres — barato e suficiente. */
export const MAX_INPUT_CHARS = 8000;

export class ChatError extends Error {
	constructor(
		readonly code: 'unauthorized' | 'too_long' | 'empty' | 'rate_limited',
		message: string
	) {
		super(message);
	}
}

function eventForRisk(risk: SafetyClassification['risk']): ChatSecurityEvent['event'] {
	switch (risk) {
		case 'jailbreak':
			return 'JAILBREAK_DETECTED';
		case 'prompt_injection':
			return 'PROMPT_INJECTION_DETECTED';
		default:
			return 'CHAT_BLOCKED';
	}
}

/** §36 — os três papéis leem; nenhum ganha poder no chat por ser admin. */
export function canUseChat(user: ChatUser | null): boolean {
	if (!user) return false;
	return user.status === 'active';
}

/**
 * Normaliza a consulta antes do retrieval.
 *
 * Resolve pronome de acompanhamento juntando o assunto da última pergunta do
 * usuário: "e a expiração?" sozinho não recupera nada útil, mas somado a
 * "como autenticar" recupera a página certa (§46). Isso é feito **só para a
 * busca** — a pergunta que vai ao modelo continua a original.
 */
export function normalizeQuery(message: string, history: readonly ChatMessage[]): string {
	const trimmed = message.trim();
	const words = trimmed.split(/\s+/).filter(Boolean);

	// Pergunta curta ou que começa por conector depende do que veio antes.
	const isFollowUp = words.length <= 6 || /^(?:e|and|what about|y)\b/i.test(trimmed);
	if (!isFollowUp) return trimmed;

	const previousUser = [...history].reverse().find((entry) => entry.role === 'user');
	if (!previousUser) return trimmed;

	return `${previousUser.content} ${trimmed}`.slice(0, 500);
}

export function createChatService(options: ChatServiceOptions) {
	const maxOutputTokens = options.maxOutputTokens ?? 2048;

	async function emit(event: ChatSecurityEvent): Promise<void> {
		try {
			await options.onEvent?.(event);
		} catch {
			// Observabilidade não derruba a conversa.
		}
	}

	async function sendMessage(
		conversation: Conversation,
		message: string,
		user: ChatUser
	): Promise<ChatResponse> {
		const started = Date.now();

		// --- autenticação e autorização ------------------------------------
		if (!canUseChat(user)) {
			throw new ChatError('unauthorized', 'Sem permissão para usar o assistente.');
		}

		const trimmed = message.trim();
		if (trimmed === '') throw new ChatError('empty', 'Mensagem vazia.');
		if (trimmed.length > MAX_INPUT_CHARS) {
			throw new ChatError(
				'too_long',
				'Sua mensagem é longa demais. Encurte-a ou divida em perguntas menores.'
			);
		}

		await emit({
			event: 'CHAT_REQUEST',
			userId: user.id,
			conversationId: conversation.id,
			timestamp: new Date().toISOString(),
			metrics: { inputChars: trimmed.length },
		});

		// --- guardrail de entrada ------------------------------------------
		// O contexto recente entra na classificação para pegar ataque
		// distribuído em várias mensagens (§26, §27).
		const recentContext = conversation.messages
			.slice(-6)
			.map((entry) => entry.content)
			.join('\n');

		const inputSafety = classifyInputDeterministic(trimmed, { conversationContext: recentContext });

		if (!isAllowed(inputSafety)) {
			await emit({
				// O tipo do evento acompanha o risco: no painel, "tentativa de
				// injeção" e "conteúdo inseguro" pedem reações diferentes, e um
				// CHAT_BLOCKED genérico obrigaria a ler o metadata para saber.
				event: eventForRisk(inputSafety.risk),
				userId: user.id,
				conversationId: conversation.id,
				timestamp: new Date().toISOString(),
				riskCategory: inputSafety.categories.join(','),
				confidence: inputSafety.confidence,
			});

			return refusalResponse(conversation, refusalFor(inputSafety), inputSafety);
		}

		if (inputSafety.risk === 'suspicious') {
			await emit({
				event: 'PROMPT_INJECTION_DETECTED',
				userId: user.id,
				conversationId: conversation.id,
				timestamp: new Date().toISOString(),
				riskCategory: inputSafety.categories.join(','),
				confidence: inputSafety.confidence,
			});
		}

		// --- retrieval -----------------------------------------------------
		const query = normalizeQuery(trimmed, conversation.messages);
		const chunks = await retrieveDocumentation(query, {
			threshold: options.retrievalThreshold,
			maxChunks: options.maxChunks,
			locale: conversation.locale,
		});

		const sources = toSourceReferences(chunks);

		if (chunks.length === 0) {
			// §40: nada acima do limiar → dizer isso, não inventar.
			const answer = NO_CONTEXT_ANSWER;
			appendTurn(conversation, trimmed, answer, []);
			await emit({
				event: 'CHAT_COMPLETED',
				userId: user.id,
				conversationId: conversation.id,
				timestamp: new Date().toISOString(),
				metrics: { chunks: 0, durationMs: Date.now() - started },
			});
			return {
				message: answer,
				sources: [],
				safety: { filtered: false },
				conversationId: conversation.id,
				messageId: randomUUID(),
			};
		}

		// --- guardrail de contexto -----------------------------------------
		const prompt = buildPrompt({
			message: trimmed,
			history: conversation.messages,
			summary: conversation.summary,
			chunks,
			budget: DEFAULT_BUDGET,
		});

		if (prompt.indirectInjectionDetected) {
			// A documentação recuperada continha algo com forma de instrução. O
			// texto já foi neutralizado por `sanitizeRetrievedContent`; o evento
			// existe para alguém ir olhar a página.
			await emit({
				event: 'INDIRECT_INJECTION_DETECTED',
				userId: user.id,
				conversationId: conversation.id,
				timestamp: new Date().toISOString(),
				riskCategory: 'prompt-injection',
			});
		}

		// --- modo só-retrieval ---------------------------------------------
		if (!options.generationEnabled || !options.model.isConfigured()) {
			const answer = composeRetrievalAnswer(chunks);
			appendTurn(conversation, trimmed, answer, sources);
			await emit({
				event: 'CHAT_COMPLETED',
				userId: user.id,
				conversationId: conversation.id,
				timestamp: new Date().toISOString(),
				metrics: { chunks: chunks.length, durationMs: Date.now() - started },
			});
			return {
				message: answer,
				sources,
				safety: { filtered: false },
				retrievalOnly: true,
				conversationId: conversation.id,
				messageId: randomUUID(),
			};
		}

		// --- modelo ---------------------------------------------------------
		let generated: string;
		let usage: ChatResponse['usage'];
		try {
			const result = await options.model.generate({
				systemPrompt: prompt.systemPrompt,
				messages: prompt.messages,
				maxOutputTokens,
				temperature: 0,
			});
			generated = result.text;
			usage = result.usage;
		} catch (error) {
			await emit({
				event: 'CHAT_BLOCKED',
				userId: user.id,
				conversationId: conversation.id,
				timestamp: new Date().toISOString(),
				riskCategory: 'model-error',
			});
			// Falha do provedor não deve virar resposta inventada: cai no modo
			// só-retrieval, que continua sendo útil.
			const answer = composeRetrievalAnswer(chunks);
			appendTurn(conversation, trimmed, answer, sources);
			return {
				message: answer,
				sources,
				safety: { filtered: false },
				retrievalOnly: true,
				conversationId: conversation.id,
				messageId: randomUUID(),
			};
		}

		// --- guardrail de saída ---------------------------------------------
		const outputCheck = checkOutput(generated, prompt.systemPrompt);

		if (outputCheck.blocked) {
			await emit({
				event: 'OUTPUT_BLOCKED',
				userId: user.id,
				conversationId: conversation.id,
				timestamp: new Date().toISOString(),
				riskCategory: outputCheck.categories.join(','),
			});
			const answer = 'Não consigo fornecer essa resposta. Posso tentar de outra forma?';
			appendTurn(conversation, trimmed, answer, []);
			return {
				message: answer,
				sources: [],
				safety: { filtered: true, reason: 'saída bloqueada' },
				conversationId: conversation.id,
				messageId: randomUUID(),
			};
		}

		const finalText = outputCheck.text.trim() === '' ? NOT_ENOUGH_CONTEXT_ANSWER : outputCheck.text;
		appendTurn(conversation, trimmed, finalText, sources);

		await emit({
			event: 'CHAT_COMPLETED',
			userId: user.id,
			conversationId: conversation.id,
			timestamp: new Date().toISOString(),
			metrics: {
				chunks: chunks.length,
				durationMs: Date.now() - started,
				inputTokens: usage?.inputTokens ?? 0,
				outputTokens: usage?.outputTokens ?? 0,
			},
		});

		return {
			message: finalText,
			sources,
			safety: { filtered: outputCheck.redacted > 0, reason: outputCheck.redacted > 0 ? 'credenciais removidas' : undefined },
			usage,
			conversationId: conversation.id,
			messageId: randomUUID(),
		};
	}

	return { sendMessage };

	function refusalResponse(
		conversation: Conversation,
		text: string,
		classification: SafetyClassification
	): ChatResponse {
		conversation.messages.push({
			role: 'assistant',
			content: text,
			timestamp: new Date().toISOString(),
			refused: true,
		});
		return {
			message: text,
			sources: [],
			safety: { filtered: true, reason: classification.risk },
			conversationId: conversation.id,
			messageId: randomUUID(),
		};
	}
}

function appendTurn(
	conversation: Conversation,
	userMessage: string,
	assistantMessage: string,
	sources: ChatResponse['sources']
): void {
	const now = new Date().toISOString();
	conversation.messages.push({ role: 'user', content: userMessage, timestamp: now });
	conversation.messages.push({ role: 'assistant', content: assistantMessage, timestamp: now, sources });
	conversation.updatedAt = now;
	trimConversation(conversation);
}

/**
 * Verificação da saída (§28–§32).
 *
 * Três coisas, na ordem: vazamento do system prompt, credenciais, PII. As
 * credenciais são **removidas** em vez de bloquear a resposta inteira — o
 * restante pode ser útil; o system prompt, ao contrário, bloqueia, porque não
 * há como "editar" um vazamento de instruções sem virar outra resposta.
 */
export function checkOutput(
	text: string,
	systemPrompt: string
): { blocked: boolean; text: string; categories: string[]; redacted: number } {
	const categories: string[] = [];

	// Trechos característicos do system prompt reaparecendo na resposta.
	const markers = ['Regra de isolamento', 'documentation_context', 'dado não confiável', 'user_question'];
	const leaked = markers.filter((marker) => text.includes(marker)).length;
	// Um marcador pode aparecer por coincidência ao explicar o mecanismo; dois
	// ou mais indicam que o prompt está sendo reproduzido.
	if (leaked >= 2) {
		categories.push('system-prompt-leak');
		return { blocked: true, text, categories, redacted: 0 };
	}

	// Frase longa copiada literalmente do system prompt.
	const longLines = systemPrompt
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 60);
	if (longLines.some((line) => text.includes(line))) {
		categories.push('system-prompt-leak');
		return { blocked: true, text, categories, redacted: 0 };
	}

	const secrets = detectSecrets(text);
	const { text: cleaned, redacted } = redactSecrets(text);
	if (secrets.length > 0) categories.push('secret-exposure');

	const pii = detectPii(cleaned);
	if (pii.length > 0) categories.push('pii-exposure');

	return { blocked: false, text: cleaned, categories, redacted };
}

/** Resposta do modo só-retrieval: os próprios trechos, com a origem. */
function composeRetrievalAnswer(chunks: Awaited<ReturnType<typeof retrieveDocumentation>>): string {
	const parts = ['Não há um modelo de linguagem configurado, então não posso redigir uma resposta. Encontrei estes trechos na documentação:', ''];

	for (const chunk of chunks.slice(0, 3)) {
		const heading = chunk.heading ? ` — ${chunk.heading}` : '';
		parts.push(`**${chunk.title}${heading}**`);
		parts.push('');
		parts.push(chunk.content.slice(0, 700).trim());
		parts.push('');
	}

	return parts.join('\n').trim();
}

// A criação de conversa vive em `store.ts`, junto do ciclo de vida (TTL, teto
// por usuário) — o serviço só recebe a conversa e a faz avançar.
