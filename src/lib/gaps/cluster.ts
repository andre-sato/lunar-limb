/**
 * Agrupamento de perguntas (§12, §13).
 *
 * "How rotate API key?", "Can I change API key?", "Where can I regenerate API
 * key?" são a mesma dúvida. Sem agrupar, o sistema cria quatro tarefas para um
 * problema — e uma fila com quatro entradas idênticas é uma fila que ninguém usa.
 *
 * O agrupamento é **lexical**, e a escolha é deliberada. A §13 sugere embeddings,
 * e o projeto tem a infraestrutura de RAG; mas embeddings aqui exigiriam chamar um
 * provedor a cada análise, para separar frases de cinco palavras que compartilham
 * três. A similaridade por termos, com dobra de acento e o mesmo radicalizador
 * leve que a busca já usa, resolve o caso real e roda sem rede — e a estrutura
 * aceita trocar a métrica sem mexer no resto.
 */

const STOPWORDS = new Set([
	'a', 'o', 'as', 'os', 'um', 'uma', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas',
	'para', 'por', 'com', 'sem', 'que', 'qual', 'quais', 'como', 'onde', 'quando', 'e', 'ou', 'se',
	'eu', 'meu', 'minha', 'posso', 'preciso', 'quero', 'fazer', 'faco', 'ser', 'estar', 'the', 'a',
	'an', 'of', 'to', 'in', 'on', 'how', 'do', 'i', 'my', 'can', 'where', 'what', 'is', 'are',
]);

/** Sufixos removidos, do mais longo para o mais curto. */
const SUFFIXES = ['acoes', 'acao', 'coes', 'cao', 'mente', 'ando', 'endo', 'indo', 'ar', 'er', 'ir', 'es', 's'];

export function fold(text: string): string {
	return text
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '');
}

export function stem(word: string): string {
	for (const suffix of SUFFIXES) {
		if (word.length > suffix.length + 3 && word.endsWith(suffix)) return word.slice(0, -suffix.length);
	}
	return word;
}

export function tokenize(question: string): string[] {
	return fold(question)
		.replace(/[^\p{L}\p{N}\s]/gu, ' ')
		.split(/\s+/)
		.filter((word) => word.length > 1 && !STOPWORDS.has(word))
		.map(stem);
}

/** Similaridade de Jaccard entre dois conjuntos de termos. */
export function similarity(left: readonly string[], right: readonly string[]): number {
	if (left.length === 0 || right.length === 0) return 0;

	const a = new Set(left);
	const b = new Set(right);
	let shared = 0;
	for (const token of a) if (b.has(token)) shared++;

	return shared / (a.size + b.size - shared);
}

export interface QueryInput {
	question: string;
	count: number;
}

export interface QueryCluster {
	/** A pergunta mais frequente do grupo — é ela que vai para o relatório. */
	representative: string;
	variants: string[];
	/**
	 * Termos que **todas** as variações têm em comum. É o critério de admissão no
	 * grupo: unir faria o grupo crescer a cada entrada e acabar atraindo qualquer
	 * pergunta.
	 */
	tokens: string[];
	/**
	 * Todos os termos que apareceram em alguma variação.
	 *
	 * É o que a medida de cobertura precisa olhar, e a diferença entre os dois
	 * campos deu um erro real: ao juntar "como rotacionar a chave de api" com
	 * "posso trocar minha chave de api", a interseção vira `chave, api` — que o
	 * portal documenta — e a cobertura saía 100% para um assunto, rotação de
	 * chave, sobre o qual não existe uma linha.
	 */
	terms: string[];
	count: number;
}

/**
 * Agrupa perguntas parecidas.
 *
 * O limiar é alto de propósito. Agrupar demais funde dúvidas diferentes numa
 * tarefa só, e o resultado é uma página que responde metade de cada uma — pior
 * que duas tarefas separadas.
 */
export function clusterQueries(queries: readonly QueryInput[], threshold = 0.5): QueryCluster[] {
	// Da mais frequente para a menos: a pergunta mais feita é a que melhor
	// representa o grupo, e começar por ela evita que uma variação rara vire o
	// nome do problema.
	const ordered = [...queries].sort((a, b) => b.count - a.count || a.question.localeCompare(b.question));
	const clusters: QueryCluster[] = [];

	for (const query of ordered) {
		const tokens = tokenize(query.question);
		if (tokens.length === 0) continue;

		const match = clusters.find((cluster) => similarity(cluster.tokens, tokens) >= threshold);

		if (match) {
			match.variants.push(query.question);
			match.count += query.count;
			match.tokens = match.tokens.filter((token) => tokens.includes(token));
			match.terms = [...new Set([...match.terms, ...tokens])];
			continue;
		}

		clusters.push({
			representative: query.question,
			variants: [query.question],
			tokens,
			terms: [...tokens],
			count: query.count,
		});
	}

	return clusters.sort((a, b) => b.count - a.count);
}
