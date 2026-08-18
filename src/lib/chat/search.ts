/**
 * Busca conversacional na documentação.
 *
 * O fluxo inteiro, e não sobra etapa escondida:
 *
 *   autenticar → normalizar a consulta → buscar no índice → recortar os
 *   trechos → devolver com os links
 *
 * O que **não** existe mais aqui, e é o ponto da simplificação: não há prompt,
 * não há modelo, não há guardrail de saída. Tudo que a interface mostra está
 * literalmente numa página publicada, e o link prova onde. Alucinação e injeção
 * de prompt deixam de ser riscos por construção, não por mitigação.
 */

import { randomUUID } from 'node:crypto';
import { redactSecrets } from './sanitize';
import { summarize } from './summary';
import { retrieveDocumentation, toSourceReferences, urlForPath } from './retrieval';
import { trimConversation } from './store';
import type { ChatUser, Conversation, Excerpt, RetrievedChunk, SearchAnswer } from './types';

/** Teto da consulta. Uma pergunta de busca não tem por que ser um texto longo. */
/**
 * Teto da pergunta.
 *
 * Era 500 quando a busca só casava palavras: uma consulta lexical não melhora
 * com mais texto. Com o assistente redigindo, a pergunta carrega contexto — o
 * que a pessoa tentou, o erro que recebeu — e cortar isso empobrece a resposta.
 */
export const MAX_QUERY_CHARS = 2000;

export class ChatError extends Error {
	constructor(
		readonly code: 'unauthorized' | 'too_long' | 'empty',
		message: string
	) {
		super(message);
	}
}

/** Os três papéis buscam; ninguém ganha alcance a mais por ser admin. */
export function canUseChat(user: ChatUser | null): boolean {
	return Boolean(user) && user!.status === 'active';
}

/**
 * Normaliza a consulta antes da busca.
 *
 * Uma pergunta curta de acompanhamento ("e a expiração?") não recupera nada
 * sozinha; somada ao assunto da pergunta anterior, recupera a página certa. O
 * histórico serve só para isto — não há contexto de conversa em nenhum outro
 * lugar do fluxo.
 */
export function normalizeQuery(message: string, history: readonly { role: string; content: string }[]): string {
	const trimmed = message.trim();
	const words = trimmed.split(/\s+/).filter(Boolean);

	const isFollowUp = words.length <= 6 || /^(?:e|and|what about|y)\b/i.test(trimmed);
	if (!isFollowUp) return trimmed;

	const previous = [...history].reverse().find((entry) => entry.role === 'user');
	if (!previous) return trimmed;

	return `${previous.content} ${trimmed}`.slice(0, MAX_QUERY_CHARS);
}

/**
 * Para onde o trecho aponta.
 *
 * Um bloco reutilizável não tem página: o `url` que o indexador guarda para ele
 * (`/rate-limit/`) responde 404. Quem tem página é quem o inclui, então o link
 * vai para a primeira página consumidora — e o título diz de onde o texto vem,
 * para o leitor não se surpreender ao chegar numa página com outro nome.
 *
 * Bloco sem nenhuma página consumidora não tem para onde levar e é descartado
 * da lista: um trecho sem link é um beco sem saída.
 */
export function targetFor(chunk: RetrievedChunk): { url: string; path: string } | null {
	if (chunk.kind !== 'snippet') return { url: chunk.url, path: chunk.path };

	const consumer = chunk.usedBy?.[0];
	if (!consumer) return null;

	return { url: urlForPath(consumer), path: consumer };
}

/**
 * Recorta um trecho para leitura.
 *
 * O cabeçalho `Document:/Section:`, que o indexador põe para melhorar a busca, é
 * removido — para o leitor é ruído, porque a interface já mostra título e seção.
 * E o corte respeita fim de frase: cortar no meio de uma frase produz um trecho
 * que parece dizer outra coisa.
 *
 * Devolve `null` quando o trecho não tem página para onde levar (ver `targetFor`).
 */
export function excerptFrom(chunk: RetrievedChunk, maxChars: number): Excerpt | null {
	const target = targetFor(chunk);
	if (!target) return null;

	const withoutHeader = chunk.content
		.split('\n')
		.filter((line) => !/^(?:Document|Section):\s/.test(line))
		.join('\n')
		.trim();

	// Credencial que tenha vazado para a documentação não é repassada.
	const { text: safe } = redactSecrets(withoutHeader);

	let text = safe;
	if (text.length > maxChars) {
		const window = text.slice(0, maxChars);
		const lastStop = Math.max(window.lastIndexOf('. '), window.lastIndexOf('.\n'));
		text = lastStop > maxChars * 0.5 ? window.slice(0, lastStop + 1) : `${window.trimEnd()}…`;
	}

	return {
		title: chunk.title,
		// Para um bloco, a seção informa em qual página o leitor vai cair.
		section: chunk.kind === 'snippet' ? `usado em ${target.path.replace(/\.mdx?$/, '')}` : chunk.heading,
		text,
		url: target.url,
		path: target.path,
		score: chunk.score,
	};
}

export interface SearchOptions {
	maxExcerpts?: number;
	minScore?: number;
	excerptChars?: number;
}

const NOTHING_FOUND =
	'Não encontrei isso na documentação deste portal. Tente outros termos, ou procure pelo nome exato de um campo, erro ou comando.';



/**
 * Executa uma consulta e registra o turno na conversa.
 *
 * A resposta tem três partes, nesta ordem: um resumo curto do que foi
 * encontrado, os trechos, e os links das páginas. O resumo é extrativo — cita a
 * primeira frase útil do trecho mais relevante, com a origem declarada. Sem
 * modelo de linguagem, resumir de outra forma seria inventar; ver `summary.ts`.
 */
export async function searchDocumentation(
	conversation: Conversation,
	message: string,
	user: ChatUser,
	options: SearchOptions = {}
): Promise<SearchAnswer> {
	if (!canUseChat(user)) {
		throw new ChatError('unauthorized', 'Sem permissão para usar a busca.');
	}

	const trimmed = message.trim();
	if (trimmed === '') throw new ChatError('empty', 'Consulta vazia.');
	if (trimmed.length > MAX_QUERY_CHARS) {
		throw new ChatError('too_long', `Encurte a busca para até ${MAX_QUERY_CHARS} caracteres.`);
	}

	const query = normalizeQuery(trimmed, conversation.messages);
	const chunks = await retrieveDocumentation(query, {
		threshold: options.minScore,
		maxChunks: options.maxExcerpts,
		locale: conversation.locale,
	});

	// `filter` depois do `map`: um bloco reutilizável sem página consumidora não
	// tem link e sai da lista.
	const excerpts = chunks
		.map((chunk) => excerptFrom(chunk, options.excerptChars ?? 700))
		.filter((excerpt): excerpt is Excerpt => excerpt !== null);
	const sources = toSourceReferences(chunks);
	const empty = excerpts.length === 0;

	const summary = empty ? NOTHING_FOUND : summarize(excerpts);

	const now = new Date().toISOString();
	conversation.messages.push({ role: 'user', content: trimmed, timestamp: now });
	conversation.messages.push({
		role: 'assistant',
		content: summary,
		timestamp: now,
		excerpts,
		sources,
	});
	conversation.updatedAt = now;
	trimConversation(conversation);

	return {
		message: summary,
		excerpts,
		sources,
		empty,
		conversationId: conversation.id,
		messageId: randomUUID(),
	};
}
