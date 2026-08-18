/**
 * Confiança na recuperação do assistente (§11 da spec de Trust & Provenance).
 *
 * A ordem de preferência da spec:
 *
 *     verificado → verificado há pouco → verificação vencida → não verificado
 *
 * Duas decisões que mudam o comportamento e merecem ficar explícitas.
 *
 * A primeira: a confiança **ajusta** a relevância, não a substitui. Um trecho
 * verificado que não responde à pergunta continua sendo um trecho que não
 * responde à pergunta; promovê-lo por causa do selo daria uma resposta confiável
 * e inútil. Por isso o ajuste é multiplicativo e modesto.
 *
 * A segunda: conteúdo com verificação vencida **não** é escondido. Ele é a melhor
 * informação que o portal tem sobre o assunto; omiti-lo faria o assistente
 * responder "não encontrei" quando encontrou. O que se faz é responder **e**
 * avisar — o leitor decide o que fazer com o aviso.
 */

import type { VerificationStatus } from '../trust/types';

export interface TrustLookup {
	(documentId: string): { status: VerificationStatus; lastVerified?: string } | undefined;
}

/**
 * Peso por estado.
 *
 * `invalid` cai bastante, mas não a zero: uma evidência que deixou de conferir
 * não torna a página inteira falsa, e o aviso já sai junto da resposta.
 */
const WEIGHT: Record<VerificationStatus, number> = {
	verified: 1,
	stale: 0.9,
	unverified: 0.85,
	invalid: 0.6,
};

export interface RankableChunk {
	documentId: string;
	path: string;
	score: number;
}

export function trustWeight(status: VerificationStatus | undefined): number {
	// Sem informação de confiança, nada muda. Página não anotada não é página
	// suspeita — a maior parte do portal ainda não tem proveniência declarada, e
	// penalizá-la por isso viraria uma reordenação silenciosa e arbitrária.
	return status ? WEIGHT[status] : 1;
}

export function rankByTrust<T extends RankableChunk>(chunks: readonly T[], trustFor?: TrustLookup): T[] {
	if (!trustFor) return [...chunks];

	return [...chunks]
		.map((chunk, index) => ({
			chunk,
			index,
			adjusted: chunk.score * trustWeight(trustFor(chunk.path)?.status),
		}))
		// Empate mantém a ordem original: a recuperação já ordenou por relevância, e
		// desempatar por outro critério embaralharia resultados equivalentes.
		.sort((a, b) => b.adjusted - a.adjusted || a.index - b.index)
		.map((entry) => entry.chunk);
}

export interface TrustNotice {
	/** Texto para o leitor, ou `undefined` quando não há o que avisar. */
	message?: string;
	/** O pior estado entre as fontes usadas na resposta. */
	status?: VerificationStatus;
}

/**
 * O aviso que acompanha a resposta.
 *
 * Só aparece quando as fontes **usadas** têm problema de verificação, e diz qual
 * é o problema. Um aviso genérico em toda resposta seria ruído; um aviso ausente
 * quando a informação está vencida seria omissão.
 */
export function trustNotice(paths: readonly string[], trustFor?: TrustLookup): TrustNotice {
	if (!trustFor || paths.length === 0) return {};

	const statuses = paths
		.map((path) => trustFor(path)?.status)
		.filter((status): status is VerificationStatus => status !== undefined);

	if (statuses.length === 0) return {};

	if (statuses.includes('invalid')) {
		return {
			status: 'invalid',
			message:
				'Atenção: a evidência que sustenta parte desta informação não confere mais com a fonte citada. Confirme antes de usar.',
		};
	}

	if (statuses.includes('stale')) {
		return {
			status: 'stale',
			message: 'Esta informação não foi verificada recentemente.',
		};
	}

	// Não verificado só rende aviso quando **nenhuma** fonte foi verificada:
	// havendo uma verificada entre elas, a resposta tem lastro e o aviso viraria
	// alarme sem consequência.
	if (statuses.every((status) => status === 'unverified')) {
		return {
			status: 'unverified',
			message: 'Esta informação não tem verificação registrada.',
		};
	}

	return {};
}
