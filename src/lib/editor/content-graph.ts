import { getContentFs, type ContentFs, type TreeNode } from './content-fs';
import {
	analyzeImpact,
	collectProblems,
	edgeTargetRef,
	extractReferences,
	findCycles,
	findNodeByKey,
	getBacklinks,
	getUses,
	indexNodesByRef,
	nodeKey,
	nodeRef,
	problemsForNode,
	refOf,
	stripExtension,
	typeForRoot,
	wouldCreateCycle,
	type ContentEdge,
	type ContentGraph,
	type ContentNode,
	type ContentProblem,
	type ContentRootKey,
	type ImpactAnalysis,
	type ReusableType,
} from './graph-model';

/**
 * Fase 4 — construção do Content Graph a partir dos arquivos.
 *
 * O índice é *derivado*: os arquivos Markdown/MDX continuam sendo a fonte de
 * verdade (§36 da especificação). Nada aqui é persistido; o grafo é
 * reconstruído sob demanda e mantido em um cache curto em memória apenas para
 * não reler o repositório inteiro a cada tecla digitada no editor.
 */

export type {
	ContentEdge,
	ContentGraph,
	ContentNode,
	ContentProblem,
	ImpactAnalysis,
	ReusableType,
} from './graph-model';

export interface ReusableItem {
	id: string;
	type: ReusableType;
	/** Relativo à raiz da sua collection (snippets/ ou docs/). */
	path: string;
	title?: string;
	description?: string;
	/** Quantas páginas usam este conteúdo (backlinks diretos). */
	usedByCount?: number;
}

/** Mantido para compatibilidade com a Fase 3 (formato antigo de referência). */
export interface ContentReference {
	source: string;
	target: string;
	type: ReusableType;
}

const ROOTS: ContentRootKey[] = ['docs', 'snippets'];

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/**
 * O editor pede referências a cada save e a cada troca de arquivo; sem cache
 * isso relê e reparseia todo o conteúdo do repositório toda vez. TTL curto de
 * propósito: os arquivos podem ser editados por fora (Git, VS Code, Codex), e
 * um índice velho é pior do que um índice barato.
 */
const CACHE_TTL_MS = 1500;
let cached: { graph: ContentGraph; problems: ContentProblem[] } | null = null;
let cachedAt = 0;

export function invalidateGraphCache(): void {
	cached = null;
	cachedAt = 0;
}

// ---------------------------------------------------------------------------
// Construção
// ---------------------------------------------------------------------------

function flattenFiles(nodes: TreeNode[]): TreeNode[] {
	const files: TreeNode[] = [];
	for (const node of nodes) {
		if (node.type === 'file') files.push(node);
		else if (node.children) files.push(...flattenFiles(node.children));
	}
	return files;
}

/** As duas collections lidas pelo grafo. Parametrizado para os testes poderem
 *  apontar para um diretório temporário em vez do repositório real. */
export type ContentSources = Record<ContentRootKey, Pick<ContentFs, 'getTree' | 'readDocument'>>;

function defaultSources(): ContentSources {
	return { docs: getContentFs('docs'), snippets: getContentFs('snippets') };
}

async function collectNodes(root: ContentRootKey, sources: ContentSources): Promise<ContentNode[]> {
	const files = flattenFiles(await sources[root].getTree());
	const type = typeForRoot(root);

	return files.map((file) => ({
		key: nodeKey(root, file.path),
		id: stripExtension(file.path),
		type,
		root,
		path: file.path,
		title: file.title,
	}));
}

async function collectEdges(
	nodes: ContentNode[],
	knownRefs: Set<string>,
	sources: ContentSources
): Promise<ContentEdge[]> {
	const edges: ContentEdge[] = [];

	for (const node of nodes) {
		let raw: string;
		try {
			raw = (await sources[node.root].readDocument(node.path)).content;
		} catch {
			// Arquivo ilegível/apagado no meio do scan — pular em vez de derrubar
			// a montagem inteira do grafo.
			continue;
		}

		for (const ref of extractReferences(raw)) {
			edges.push({
				source: node.key,
				sourceId: node.id,
				target: ref.id,
				type: 'uses',
				refType: ref.type,
				resolved: knownRefs.has(refOf(ref.type, ref.id)),
				location: ref.location,
			});
		}
	}

	return edges;
}

/** Monta o grafo (e seus problemas) a partir de um par de collections. */
export async function buildGraphFrom(
	sources: ContentSources = defaultSources()
): Promise<{ graph: ContentGraph; problems: ContentProblem[] }> {
	const nodeGroups = await Promise.all(ROOTS.map((root) => collectNodes(root, sources)));
	const nodes = nodeGroups.flat();

	const knownRefs = new Set(nodes.map(nodeRef));
	const edges = await collectEdges(nodes, knownRefs, sources);

	const graph: ContentGraph = { nodes, edges, generatedAt: Date.now() };
	return { graph, problems: collectProblems(graph) };
}

export async function getContentGraph(options: { fresh?: boolean } = {}): Promise<ContentGraph> {
	return (await getGraphWithProblems(options)).graph;
}

export async function getGraphWithProblems(
	options: { fresh?: boolean } = {}
): Promise<{ graph: ContentGraph; problems: ContentProblem[] }> {
	const now = Date.now();
	if (!options.fresh && cached && now - cachedAt < CACHE_TTL_MS) return cached;

	cached = await buildGraphFrom();
	cachedAt = now;
	return cached;
}

// ---------------------------------------------------------------------------
// Consultas usadas pelas rotas de API
// ---------------------------------------------------------------------------

export async function listReusable(): Promise<{ blocks: ReusableItem[]; pages: ReusableItem[] }> {
	const graph = await getContentGraph();

	const usageCount = new Map<string, number>();
	for (const edge of graph.edges) {
		const ref = edgeTargetRef(edge);
		usageCount.set(ref, (usageCount.get(ref) ?? 0) + 1);
	}

	const toItem = (node: ContentNode): ReusableItem => ({
		id: node.id,
		type: node.type,
		path: node.path,
		title: node.title,
		description: node.description,
		usedByCount: usageCount.get(nodeRef(node)) ?? 0,
	});

	return {
		blocks: graph.nodes.filter((node) => node.type === 'block').map(toItem),
		pages: graph.nodes.filter((node) => node.type === 'page').map(toItem),
	};
}

/** Uma referência já resolvida para exibição na UI (título, caminho, linha). */
export interface ReferenceDetail {
	/** id do conteúdo do outro lado da aresta. */
	id: string;
	type: ReusableType;
	/** Caminho do arquivo do outro lado, quando ele existe. */
	path?: string;
	root?: ContentRootKey;
	title?: string;
	resolved: boolean;
	/** Onde a tag aparece no arquivo *de origem* da aresta. */
	location: { line: number; column: number };
}

export interface ReferencesResult {
	/** O arquivo consultado, se ele existir no grafo. */
	node?: ContentNode;
	/** Conteúdo que este arquivo usa. */
	uses: ReferenceDetail[];
	/** Arquivos que usam este conteúdo (backlinks diretos). */
	usedBy: ReferenceDetail[];
	/** Impacto total de editar este arquivo (diretos + indiretos). */
	impact: ImpactAnalysis;
	/** Problemas que pertencem a este arquivo. */
	problems: ContentProblem[];
	// --- compat Fase 3 --------------------------------------------------
	/** @deprecated Use `uses`. Mantido para não quebrar consumidores antigos. */
	usesLegacy: ContentReference[];
	/** @deprecated Use `usedBy`. */
	usedByLegacy: ContentReference[];
}

/** `key` é "docs:guides/payments.mdx" ou "snippets/auth-warning.md". */
export async function getReferencesFor(key: string): Promise<ReferencesResult> {
	const { graph, problems } = await getGraphWithProblems();
	const byRef = indexNodesByRef(graph);

	const node = findNodeByKey(graph, key);
	// Um arquivo recém-criado pode ainda não estar no grafo em cache; derivar o
	// ref direto do próprio key evita um painel vazio nesse caso.
	const fallbackRef = refOfKey(key);
	const ref = node ? nodeRef(node) : fallbackRef;

	const uses: ReferenceDetail[] = getUses(graph, key).map((edge) => {
		const target = byRef.get(edgeTargetRef(edge));
		return {
			id: edge.target,
			type: edge.refType,
			path: target?.path,
			root: target?.root,
			title: target?.title,
			resolved: edge.resolved,
			location: { line: edge.location.line, column: edge.location.column },
		};
	});

	const usedBy: ReferenceDetail[] = getBacklinks(graph, ref).map((edge) => {
		const source = findNodeByKey(graph, edge.source);
		return {
			id: edge.sourceId,
			type: source?.type ?? 'page',
			path: source?.path,
			root: source?.root,
			title: source?.title,
			resolved: true,
			location: { line: edge.location.line, column: edge.location.column },
		};
	});

	return {
		node,
		uses,
		usedBy,
		impact: analyzeImpact(graph, ref),
		problems: problemsForNode(problems, key, ref),
		usesLegacy: getUses(graph, key).map(toLegacy),
		usedByLegacy: getBacklinks(graph, ref).map(toLegacy),
	};
}

function toLegacy(edge: ContentEdge): ContentReference {
	return { source: edge.source, target: edge.target, type: edge.refType };
}

function refOfKey(key: string): string {
	const idx = key.indexOf(':');
	const root: ContentRootKey = key.slice(0, idx) === 'snippets' ? 'snippets' : 'docs';
	const path = idx === -1 ? key : key.slice(idx + 1);
	return refOf(typeForRoot(root), stripExtension(path));
}

/** Impacto de mexer (ou apagar) um conteúdo, pelo seu ref (`block:x`/`page:x`). */
export async function getImpactFor(ref: string): Promise<ImpactAnalysis> {
	const graph = await getContentGraph();
	return analyzeImpact(graph, ref);
}

/**
 * Inserir `targetRef` dentro de `sourceKey` fecharia um ciclo? Usado pela rota
 * de grafo para o editor bloquear a inserção antes de gravar o arquivo.
 */
export async function checkCycle(sourceKey: string, targetRef: string): Promise<string[] | null> {
	const graph = await getContentGraph();
	const node = findNodeByKey(graph, sourceKey);
	const sourceRef = node ? nodeRef(node) : refOfKey(sourceKey);
	return wouldCreateCycle(graph, sourceRef, targetRef);
}

// ---------------------------------------------------------------------------
// Compat Fase 3
// ---------------------------------------------------------------------------

/** @deprecated Use `getContentGraph()`. */
export async function buildReferenceGraph(): Promise<ContentReference[]> {
	const graph = await getContentGraph();
	return graph.edges.map(toLegacy);
}

export interface CircularCheckResult {
	circular: boolean;
	chain?: string[];
}

/** @deprecated Use `checkCycle`/`collectProblems`. Este conteúdo participa de algum ciclo? */
export async function detectCircular(startId: string, type: ReusableType = 'block'): Promise<CircularCheckResult> {
	const graph = await getContentGraph();
	const ref = refOf(type, startId);

	for (const cycle of findCycles(graph)) {
		if (cycle.includes(ref)) return { circular: true, chain: cycle };
	}
	return { circular: false };
}

export { extractReferences, stripExtension as docPathToId } from './graph-model';

export function idToLikelyPaths(id: string): string[] {
	return [`${id}.md`, `${id}.mdx`];
}
