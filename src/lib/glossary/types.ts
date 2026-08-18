/**
 * Glossário: tipos (§6).
 *
 * O glossário é a **fonte canônica de terminologia do portal** (§54), não uma
 * coleção de tooltips. Dois consumidores leem a mesma estrutura: o renderizador
 * da documentação, que destaca os termos, e o linter, que avalia consistência.
 * Por isso o modelo vive aqui, e não dentro de nenhum dos dois.
 */

/** Um termo do glossário, como definido em `src/content/glossary/*.md` (§5). */
export interface GlossDef {
	/**
	 * Identificador estável e único. Não deriva do texto exibido: renomear
	 * `RAG` para `Retrieval-Augmented Generation` não pode quebrar referências
	 * (§7.1).
	 */
	id: string;
	/** Termo canônico apresentado ao leitor. */
	term: string;
	/** Outras formas que apontam para o mesmo termo (§7.3). */
	aliases: string[];
	/** Definição em Markdown limitado (§7.4). */
	definition: string;
	/** `false` mantém o termo no dicionário, fora do matching automático (§7.5). */
	enabled: boolean;
	caseSensitive: boolean;
	matchWholeWord: boolean;
	/**
	 * Terminologia desaconselhada que aponta para este termo. Alimenta a regra
	 * de termo obsoleto do linter (§32, CONSISTENCY-003 do portal).
	 */
	deprecated: string[];
	createdAt?: string;
	updatedAt?: string;
}

/** Uma forma de escrita que leva a um `GlossDef`. */
export interface Matcher {
	/** O texto procurado, como escrito na definição. */
	surface: string;
	/** Forma normalizada usada na busca (minúscula quando não sensível a caixa). */
	normalized: string;
	definitionId: string;
	caseSensitive: boolean;
	matchWholeWord: boolean;
	/** `term` para a forma canônica, `alias` para as demais (§26). */
	kind: 'term' | 'alias' | 'deprecated';
}

/** Duas definições disputando a mesma forma de escrita (§18). */
export interface MatcherConflict {
	surface: string;
	definitionIds: string[];
}

export interface GlossaryIndex {
	byId: Map<string, GlossDef>;
	/**
	 * Formas ordenadas da mais longa para a mais curta. A ordem **é** a
	 * resolução de conflito por maior correspondência (§17): quem procura de
	 * cima para baixo encontra `API Gateway` antes de `API`.
	 */
	matchers: Matcher[];
	conflicts: MatcherConflict[];
}

/** Uma ocorrência encontrada em um texto. */
export interface GlossaryMatch {
	definitionId: string;
	/** O texto como aparece no documento, preservando a caixa original. */
	text: string;
	start: number;
	end: number;
	kind: Matcher['kind'];
}
