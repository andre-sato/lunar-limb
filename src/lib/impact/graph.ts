/**
 * Grafo de impacto (§4, §7, §8).
 *
 * O Content Graph do editor já sabe quem inclui quem. O que falta nele para
 * responder à pergunta do impacto são duas coisas:
 *
 *  1. **Direção.** As arestas são "A usa B"; a análise de impacto caminha ao
 *     contrário — mudou B, quem depende dele?
 *  2. **Transitividade.** Se a página X inclui o bloco A, e A inclui o bloco B,
 *     mudar B altera X sem que exista aresta entre os dois. Um motor que só olha
 *     um salto declara "nenhuma página afetada" com convicção e está errado.
 *
 * Este arquivo é puro: recebe o grafo já lido e devolve estrutura. Quem lê disco
 * é o `engine.ts`.
 */

import type { ContentGraph } from '../editor/graph-model';
import type { GlossDef } from '../glossary/types';
import type { ApiModel } from '../api-explorer/model';
import type { ImpactEdge, ImpactGraph, ImpactNode } from './types';

// ---------------------------------------------------------------------------
// Identidade
// ---------------------------------------------------------------------------

export function pageId(path: string): string {
	return `page:${path.replace(/\.mdx?$/, '')}`;
}

export function snippetId(id: string): string {
	return `snippet:${id}`;
}

export function apiId(operation: string): string {
	return `api:${operation}`;
}

export function glossaryId(id: string): string {
	return `glossary:${id}`;
}

// ---------------------------------------------------------------------------
// Construção (§4)
// ---------------------------------------------------------------------------

export interface BuildInput {
	graph: ContentGraph;
	glossary?: readonly GlossDef[];
	/** Especificações lidas, com o caminho do arquivo de cada uma. */
	apis?: ReadonlyArray<{ path: string; model: ApiModel }>;
	/** Páginas com o texto do corpo, para localizar ocorrências de termo. */
	pageBodies?: ReadonlyMap<string, string>;
	/** Páginas que documentam cada operação, quando se sabe. */
	documents?: ReadonlyArray<{ page: string; operation: string }>;
}

export function buildImpactGraph(input: BuildInput): ImpactGraph {
	const nodes = new Map<string, ImpactNode>();
	const edges: ImpactEdge[] = [];

	const put = (node: ImpactNode) => {
		if (!nodes.has(node.id)) nodes.set(node.id, node);
	};

	for (const node of input.graph.nodes) {
		const isPage = node.type === 'page';
		put({
			id: isPage ? pageId(node.path) : snippetId(node.id),
			type: isPage ? 'page' : 'snippet',
			path: isPage ? `src/content/docs/${node.path}` : `src/content/snippets/${node.path}`,
			title: node.title,
		});
	}

	// "A usa B" vira aresta `uses` de A para B. A travessia de impacto inverte a
	// leitura; guardar invertido aqui deixaria o grafo mentindo sobre o conteúdo.
	for (const edge of input.graph.edges) {
		const source = input.graph.nodes.find((node) => node.key === edge.source);
		if (!source) continue;

		const sourceKey = source.type === 'page' ? pageId(source.path) : snippetId(source.id);
		const targetKey = edge.refType === 'block' ? snippetId(edge.target) : pageId(edge.target);
		edges.push({ source: sourceKey, target: targetKey, type: 'uses' });
	}

	for (const { path, model } of input.apis ?? []) {
		for (const operation of model.operations) {
			const id = apiId(`${operation.method.toUpperCase()} ${operation.path}`);
			put({ id, type: 'api', path, title: operation.summary ?? operation.id, version: model.version });
		}
	}

	// Página que documenta uma operação: a aresta é `documents`, e ela é o que
	// permite dizer "o endpoint mudou, revise esta página" em vez de só listar a
	// especificação alterada.
	for (const { page, operation } of input.documents ?? []) {
		const target = apiId(operation);
		if (!nodes.has(target)) continue;
		edges.push({ source: pageId(page), target, type: 'documents' });
	}

	for (const term of input.glossary ?? []) {
		put({ id: glossaryId(term.id), type: 'glossary', path: `src/content/glossary/${term.id}.md`, title: term.term });
	}

	// Ocorrência de termo em página: aresta `references`. Sem isso, mudar a grafia
	// canônica de um termo não aponta para nenhuma das páginas que a usam.
	for (const term of input.glossary ?? []) {
		for (const [page, body] of input.pageBodies ?? new Map()) {
			if (!mentionsTerm(body, term)) continue;
			edges.push({ source: pageId(page), target: glossaryId(term.id), type: 'references' });
		}
	}

	return { nodes: [...nodes.values()], edges };
}

/** Dobra acento e caixa: `Autenticação` e `autenticacao` são a mesma palavra. */
function fold(text: string): string {
	return text
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '');
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * O termo aparece no texto?
 *
 * Usa as mesmas formas que o glossário reconhece — termo canônico, aliases e
 * grafias desaconselhadas. Ignorar os aliases faria o motor perder exatamente as
 * páginas que escrevem o termo "errado", que são as que mais precisam de revisão
 * quando a terminologia muda.
 */
export function mentionsTerm(body: string, term: GlossDef): boolean {
	const surfaces = [term.term, ...term.aliases, ...term.deprecated].filter((surface) => surface.trim() !== '');
	const haystack = term.caseSensitive ? body : fold(body);

	return surfaces.some((surface) => {
		const needle = term.caseSensitive ? surface : fold(surface);
		if (!term.matchWholeWord) return haystack.includes(needle);
		return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(needle)}(?![\\p{L}\\p{N}])`, 'u').test(haystack);
	});
}

// ---------------------------------------------------------------------------
// Travessia (§7, "dependências indiretas")
// ---------------------------------------------------------------------------

export interface Dependent {
	id: string;
	/** Caminho de quem depende até a origem, incluindo as duas pontas. */
	via: string[];
}

/**
 * Quem depende de `targetId`, direta ou indiretamente.
 *
 * Largura primeiro, para o caminho encontrado ser o mais curto — o relatório
 * mostra "por onde passou", e o caminho mais curto é o mais fácil de conferir.
 * O conjunto `seen` também é a defesa contra ciclo: o grafo de conteúdo permite
 * inclusão circular (o editor a reporta como problema, mas ela existe em disco), e
 * sem essa guarda a travessia não terminaria.
 */
export function dependentsOf(graph: ImpactGraph, targetId: string, maxDepth = 6): Dependent[] {
	const incoming = new Map<string, string[]>();
	for (const edge of graph.edges) {
		const list = incoming.get(edge.target);
		if (list) list.push(edge.source);
		else incoming.set(edge.target, [edge.source]);
	}

	const found: Dependent[] = [];
	const seen = new Set<string>([targetId]);
	let frontier: Dependent[] = [{ id: targetId, via: [targetId] }];

	for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
		const next: Dependent[] = [];

		for (const current of frontier) {
			for (const source of incoming.get(current.id) ?? []) {
				if (seen.has(source)) continue;
				seen.add(source);
				const dependent = { id: source, via: [source, ...current.via] };
				found.push(dependent);
				next.push(dependent);
			}
		}

		frontier = next;
	}

	return found;
}

export function nodeById(graph: ImpactGraph, id: string): ImpactNode | undefined {
	return graph.nodes.find((node) => node.id === id);
}
