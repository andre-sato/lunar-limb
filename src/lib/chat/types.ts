/**
 * Contratos do chatbot de documentação.
 *
 * A regra que organiza o desenho (§81):
 *
 *   Never trust the user input, never trust retrieved content,
 *   and never trust model output without validation.
 *
 * As três desconfianças aparecem como camadas separadas e independentes do
 * modelo. O system prompt é **uma** delas, não a barreira (§63).
 */

// ---------------------------------------------------------------- segurança

export type InputRisk = 'safe' | 'suspicious' | 'prompt_injection' | 'jailbreak' | 'unsafe_content';

export type SafetyCategory =
	| 'prompt-injection'
	| 'jailbreak'
	| 'system-prompt-probe'
	| 'hate'
	| 'harassment'
	| 'threat'
	| 'violence-incitement'
	| 'dehumanization'
	| 'data-exfiltration'
	| 'secret-exposure'
	| 'pii-exposure'
	| 'ungrounded'
	| 'off-topic';

export interface SafetyClassification {
	risk: InputRisk;
	/** 0–1. Abaixo de 0,70 não deve gerar bloqueio duro (§64 do linter, mesma lógica). */
	confidence: number;
	categories: SafetyCategory[];
	/**
	 * Trechos que dispararam a classificação, para auditoria. Nunca vão para o
	 * usuário nem para o modelo — o §19 proíbe revelar o funcionamento interno,
	 * e o §25 proíbe repetir o conteúdo ofensivo de volta.
	 */
	evidence?: string[];
}

/**
 * Abstração de moderação (§59).
 *
 * A implementação determinística cobre ataques estruturais com boa precisão.
 * Sutileza semântica é o que um provedor de moderação de verdade resolve — e é
 * por isso que isto é uma interface, e não uma função.
 */
export interface SafetyClassifier {
	classifyInput(input: string, context?: string): Promise<SafetyClassification>;
	classifyOutput(output: string, groundingContext?: string): Promise<SafetyClassification>;
}

// ------------------------------------------------------------------- modelo

export interface ChatMessage {
	role: 'user' | 'assistant';
	content: string;
	/** Presente em respostas do assistente. */
	sources?: SourceReference[];
	timestamp: string;
	/** Marca respostas que foram substituídas por uma recusa. */
	refused?: boolean;
}

export interface ChatModelRequest {
	systemPrompt: string;
	/** Histórico já recortado pelo orçamento de contexto. */
	messages: ChatMessage[];
	maxOutputTokens: number;
	temperature: number;
}

export interface ChatModelResponse {
	text: string;
	usage?: { inputTokens: number; outputTokens: number };
	/** Identificação do modelo que respondeu, para observabilidade. */
	model: string;
}

/** Abstração de provedor (§58): trocar o modelo não deve tocar o chatbot. */
export interface ChatModel {
	readonly name: string;
	/** `false` quando falta credencial — o serviço cai no modo só-retrieval. */
	isConfigured(): boolean;
	generate(request: ChatModelRequest): Promise<ChatModelResponse>;
}

// ---------------------------------------------------------------- retrieval

export interface DocumentChunk {
	id: string;
	documentId: string;
	path: string;
	title: string;
	heading?: string;
	content: string;
	url: string;
	/** `snippet` marca conteúdo reutilizável, para a citação apontar a página consumidora. */
	kind: 'page' | 'snippet';
}

export interface RetrievedChunk extends DocumentChunk {
	/** 0–1. Comparado ao threshold configurado (§40). */
	score: number;
	/** Páginas que consomem este bloco reutilizável, via Content Graph (§9). */
	usedBy?: string[];
}

export interface SourceReference {
	documentId: string;
	url: string;
	title: string;
	relevance: number;
}

// ------------------------------------------------------------------- chat

export interface Conversation {
	id: string;
	userId: string;
	createdAt: string;
	updatedAt: string;
	messages: ChatMessage[];
	/** Resumo das mensagens antigas, para não reenviar a conversa inteira (§5). */
	summary?: string;
	/** Idioma do leitor: restringe o retrieval à tradução correspondente. */
	locale?: string;
}

export interface ChatResponse {
	message: string;
	sources: SourceReference[];
	safety: {
		filtered: boolean;
		/** Motivo legível para a interface; nunca expõe regra interna. */
		reason?: string;
	};
	usage?: { inputTokens: number; outputTokens: number };
	/** `true` quando não havia modelo configurado e a resposta é só retrieval. */
	retrievalOnly?: boolean;
	conversationId: string;
	messageId: string;
}

export interface ChatUser {
	id: string;
	role: 'viewer' | 'editor' | 'admin';
	status: 'active' | 'inactive';
}

// ------------------------------------------------------------ observabilidade

export type ChatEventName =
	| 'CHAT_REQUEST'
	| 'CHAT_COMPLETED'
	| 'CHAT_BLOCKED'
	| 'PROMPT_INJECTION_DETECTED'
	| 'JAILBREAK_DETECTED'
	| 'INDIRECT_INJECTION_DETECTED'
	| 'OUTPUT_BLOCKED'
	| 'RATE_LIMITED'
	| 'CHAT_FEEDBACK'
	| 'CHAT_REPORTED';

/**
 * Evento de segurança (§65).
 *
 * Sem conteúdo de conversa: registra-se o que aconteceu, não o que foi dito.
 * Guardar a mensagem que disparou um bloqueio de ódio significaria manter um
 * arquivo de conteúdo ofensivo, e guardar as bem-sucedidas significaria manter
 * um histórico que ninguém pediu.
 */
export interface ChatSecurityEvent {
	event: ChatEventName;
	userId?: string;
	conversationId?: string;
	timestamp: string;
	riskCategory?: string;
	confidence?: number;
	/** Metadados numéricos apenas (contagens, durações). */
	metrics?: Record<string, number>;
}
