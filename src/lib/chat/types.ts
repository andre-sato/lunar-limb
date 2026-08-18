/**
 * Tipos da busca conversacional na documentação.
 *
 * Não há modelo de linguagem envolvido: a pergunta vira consulta, a consulta
 * traz trechos, e os trechos vêm com o link da página. Isso tem duas
 * consequências que valem estar no topo do arquivo, porque explicam o desenho
 * inteiro:
 *
 *  - **não há como alucinar.** Tudo que aparece na tela está literalmente numa
 *    página publicada, e o link prova onde;
 *  - **não há prompt para atacar.** Injeção de prompt, jailbreak e vazamento de
 *    instruções deixam de ser categorias de risco porque não existe instrução
 *    nem modelo para manipular.
 */

export type ChatRole = 'user' | 'assistant';

export interface SourceReference {
	/** Caminho relativo em `content/docs`. */
	documentId: string;
	title: string;
	/** URL da página, com âncora da seção quando houver. */
	url: string;
	/** Maior relevância entre os trechos que apontam para esta página. */
	relevance: number;
}

/** Fragmento indexado, antes de receber uma pontuação. */
export interface DocumentChunk {
	id: string;
	documentId: string;
	path: string;
	title: string;
	heading?: string;
	content: string;
	url: string;
	kind: 'page' | 'snippet';
	/**
	 * Tags do frontmatter. São o assunto declarado pelo autor, iguais nos três
	 * idiomas, e pesam na relevância junto com título e heading.
	 */
	tags?: string[];
	/** Páginas que consomem este bloco reutilizável. */
	usedBy?: string[];
}

/** Trecho recuperado, já pontuado pela consulta. */
export interface RetrievedChunk extends DocumentChunk {
	score: number;
}

/** Um trecho como ele chega à interface. */
export interface Excerpt {
	title: string;
	section?: string;
	/** Texto do trecho, já recortado e com credenciais redigidas. */
	text: string;
	/** Link da página onde o trecho está. */
	url: string;
	path: string;
	/** Relevância 0–1, normalizada pela melhor da consulta. */
	score: number;
}

export interface ChatMessage {
	role: ChatRole;
	content: string;
	timestamp: string;
	excerpts?: Excerpt[];
	sources?: SourceReference[];
}

export interface Conversation {
	id: string;
	userId: string;
	createdAt: string;
	updatedAt: string;
	messages: ChatMessage[];
	/** Idioma do leitor: restringe a busca à tradução correspondente. */
	locale?: string;
	/**
	 * Resumo extrativo das buscas que saíram da janela. Serve só para resolver
	 * pergunta de acompanhamento depois de uma conversa longa.
	 */
	summary?: string;
}

export interface SearchAnswer {
	/** Frase curta de enquadramento — não é resposta gerada. */
	message: string;
	excerpts: Excerpt[];
	sources: SourceReference[];
	/** `true` quando nada passou do limiar de relevância. */
	empty: boolean;
	conversationId: string;
	messageId: string;
}

export interface ChatUser {
	id: string;
	role: 'viewer' | 'editor' | 'admin';
	status: 'active' | 'inactive';
}

// ---------------------------------------------------------------------------
// Camada de modelo e segurança
//
// Estes tipos voltaram do histórico junto com os guardrails: o chatbot passa a
// redigir quando há credencial, e redigir exige classificar a entrada, isolar o
// contexto e conferir a saída. Sem credencial nada disso roda — a busca
// devolve os trechos, como antes.
// ---------------------------------------------------------------------------

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
