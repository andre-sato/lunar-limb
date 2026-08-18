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
