/**
 * Recomendações contextuais (§9).
 *
 * "Você também pode precisar de" só vale se a lista for justificável. Cada
 * recomendação carrega o motivo — vizinha no grafo de conteúdo, mesmo assunto,
 * mesma audiência — porque uma lista de links sem explicação é indistinguível de
 * uma lista aleatória, e depois de duas sugestões ruins ninguém mais olha.
 *
 * Função pura: recebe o grafo, os metadados das páginas e o contexto. Quem lê
 * disco é quem chama.
 */

import { scoreForContext } from './context';
import type { DocumentationContext, PageContextMeta, Recommendation } from './types';

export interface RecommendInput {
	/** Página onde o leitor está. */
	current: PageContextMeta;
	/** Todas as páginas candidatas. */
	pages: readonly PageContextMeta[];
	context: DocumentationContext;
	/** Arestas do Content Graph, em pares `origem → destino` por caminho. */
	edges?: ReadonlyArray<{ from: string; to: string }>;
	/** Popularidade por caminho, quando houver — votos úteis, por exemplo. */
	popularity?: ReadonlyMap<string, number>;
	limit?: number;
}

interface Candidate {
	page: PageContextMeta;
	score: number;
	reasons: string[];
}

/**
 * O idioma de uma página, pelo prefixo do caminho.
 *
 * A raiz é o idioma do projeto (`pt`); `en/` e `es/` são as traduções. Derivar do
 * caminho evita ler o frontmatter de novo só para saber isto — a Starlight já usa
 * a mesma convenção para montar o seletor de idioma.
 */
function localeOf(path: string): string {
	const first = path.split('/')[0];
	return /^[a-z]{2}(-[a-z]{2})?$/i.test(first) ? first.toLowerCase() : 'root';
}


export function recommendPages(input: RecommendInput): Recommendation[] {
	const { current, pages, context } = input;
	const limit = input.limit ?? 4;

	// Vizinhança no grafo: quem esta página usa e quem a usa. É o sinal mais forte,
	// porque foi alguém que escreveu a ligação — não é inferência.
	const neighbours = new Set<string>();
	for (const edge of input.edges ?? []) {
		if (edge.from === current.path) neighbours.add(edge.to);
		if (edge.to === current.path) neighbours.add(edge.from);
	}

	const currentTags = new Set(current.tags);
	const currentLocale = localeOf(current.path);
	const candidates: Candidate[] = [];

	for (const page of pages) {
		if (page.path === current.path) continue;

		// Só o mesmo idioma. As traduções da mesma página compartilham tags e
		// vizinhança no grafo, então sem este corte a página em português
		// recomendava a si mesma em inglês e espanhol — que foi o que apareceu ao
		// olhar o HTML gerado.
		if (localeOf(page.path) !== currentLocale) continue;

		let score = 0;
		const reasons: string[] = [];

		if (neighbours.has(page.path)) {
			score += 5;
			reasons.push('ligada a esta página');
		}

		const shared = page.tags.filter((tag) => currentTags.has(tag));
		if (shared.length > 0) {
			score += Math.min(4, shared.length * 2);
			reasons.push(`mesmo assunto: ${shared.slice(0, 2).join(', ')}`);
		}

		const contextual = scoreForContext(page, context);
		if (contextual.score > 0) {
			score += contextual.score;
			reasons.push(...contextual.reasons);
		}

		const popularity = input.popularity?.get(page.path) ?? 0;
		if (popularity > 0) {
			// Popularidade entra com peso pequeno e teto: ela mede o que já é
			// encontrado, e deixá-la dominar faria o portal recomendar sempre as
			// mesmas cinco páginas, enterrando o resto.
			score += Math.min(2, popularity / 10);
			reasons.push('lida com frequência');
		}

		if (score > 0) candidates.push({ page, score, reasons });
	}

	return candidates
		.sort((a, b) => b.score - a.score || a.page.path.localeCompare(b.page.path))
		.slice(0, limit)
		.map((candidate) => ({
			title: candidate.page.title ?? candidate.page.path,
			url: candidate.page.url ?? `/${candidate.page.path.replace(/\.mdx?$/, '')}/`,
			path: candidate.page.path,
			reason: candidate.reasons[0] ?? 'relacionada',
			score: Math.round(candidate.score * 10) / 10,
		}));
}

/**
 * Ordem adaptada de uma lista de navegação (§8).
 *
 * Reordena e destaca; **não remove**. A spec é explícita: a navegação base
 * continua definida pelo projeto, e a adaptação só muda prioridade, recomendação
 * e destaque. Um item que some do menu porque o leitor marcou "suporte" é uma
 * página que ele não sabe que existe.
 */
export function adaptNavigation<T extends { path: string }>(
	items: readonly T[],
	pages: ReadonlyMap<string, PageContextMeta>,
	context: DocumentationContext
): Array<T & { highlighted: boolean }> {
	if (!context.audience) return items.map((item) => ({ ...item, highlighted: false }));

	return items
		.map((item, index) => {
			const page = pages.get(item.path);
			const score = page ? scoreForContext(page, context).score : 0;
			return { item, index, score };
		})
		.sort((a, b) => b.score - a.score || a.index - b.index)
		.map((entry) => ({ ...entry.item, highlighted: entry.score > 0 }));
}
