/**
 * Fase 4 — Bidirectional Content Graph (núcleo puro).
 *
 * Este módulo NÃO toca o filesystem de propósito: ele só conhece nós, arestas
 * e algoritmos sobre eles. Isso permite (a) rodar os mesmos algoritmos no
 * servidor (ao montar o grafo a partir dos arquivos) e no browser (para checar
 * ciclos antes de inserir uma referência, sem uma ida extra ao servidor) e
 * (b) testar tudo sem fixtures em disco.
 *
 * A leitura dos arquivos e a construção do grafo ficam em content-graph.ts.
 */

export type ReusableType = 'block' | 'page';
export type ContentRootKey = 'docs' | 'snippets';

export interface SourceLocation {
	/** 1-based, contando a partir do início do arquivo bruto (frontmatter incluído). */
	line: number;
	/** 1-based. */
	column: number;
	/** Offset em caracteres dentro do arquivo bruto. */
	offset: number;
}

export interface RawReference {
	type: ReusableType;
	id: string;
	location: SourceLocation;
}

export interface ContentNode {
	/** Identidade de arquivo: "docs:guides/authentication.mdx". */
	key: string;
	/** Identidade estável de conteúdo (caminho sem extensão): "guides/authentication". */
	id: string;
	type: ReusableType;
	root: ContentRootKey;
	/** Caminho relativo à raiz da collection. */
	path: string;
	title?: string;
	description?: string;
}

export interface ContentEdge {
	/** `key` do nó de origem. */
	source: string;
	/** `id` do nó de origem (conveniência para o cliente). */
	sourceId: string;
	/** `id` do conteúdo referenciado. */
	target: string;
	type: 'uses';
	/** `block` = <ContentBlock/> (snippets), `page` = <IncludePage/> (docs). */
	refType: ReusableType;
	/** false quando nenhum arquivo corresponde a `refType:target`. */
	resolved: boolean;
	location: SourceLocation;
}

export interface ContentGraph {
	nodes: ContentNode[];
	edges: ContentEdge[];
	generatedAt: number;
}

export type ProblemKind = 'broken-reference' | 'circular-reference' | 'duplicate-id' | 'unused-content';
export type ProblemSeverity = 'error' | 'warning' | 'info';

export interface ContentProblem {
	kind: ProblemKind;
	severity: ProblemSeverity;
	message: string;
	/** Nó onde o problema aparece (quando aplicável). */
	nodeKey?: string;
	path?: string;
	root?: ContentRootKey;
	location?: SourceLocation;
	/** Para ciclos: a cadeia de refs envolvida, já fechada (A → B → C → A). */
	chain?: string[];
	targetId?: string;
}

// ---------------------------------------------------------------------------
// Refs: identidade de conteúdo dentro do grafo
// ---------------------------------------------------------------------------

/**
 * Um `id` sozinho é ambíguo: `docs/foo.md` e `snippets/foo.md` têm o mesmo id.
 * O que desambigua é como o conteúdo foi referenciado — <ContentBlock/> sempre
 * resolve em snippets, <IncludePage/> sempre em docs. Por isso o grafo é
 * indexado por "ref" (`block:foo` / `page:foo`), não por id puro.
 */
export function refOf(type: ReusableType, id: string): string {
	return `${type}:${id}`;
}

export function nodeRef(node: Pick<ContentNode, 'type' | 'id'>): string {
	return refOf(node.type, node.id);
}

export function edgeTargetRef(edge: Pick<ContentEdge, 'refType' | 'target'>): string {
	return refOf(edge.refType, edge.target);
}

export function rootForType(type: ReusableType): ContentRootKey {
	return type === 'block' ? 'snippets' : 'docs';
}

export function typeForRoot(root: ContentRootKey): ReusableType {
	return root === 'snippets' ? 'block' : 'page';
}

export function stripExtension(relPath: string): string {
	return relPath.replace(/\.(md|mdx)$/i, '');
}

export function nodeKey(root: ContentRootKey, path: string): string {
	return `${root}:${path}`;
}

export function splitNodeKey(key: string): { root: ContentRootKey; path: string } {
	const idx = key.indexOf(':');
	if (idx === -1) return { root: 'docs', path: key };
	const root = key.slice(0, idx);
	return { root: root === 'snippets' ? 'snippets' : 'docs', path: key.slice(idx + 1) };
}

// ---------------------------------------------------------------------------
// Extração de referências
// ---------------------------------------------------------------------------

/**
 * Casa exatamente as tags auto-fechadas que o editor escreve:
 *   <ContentBlock id="auth-warning" />
 *   <IncludePage id="authentication" />
 *
 * Regex em vez de parse MDX completo de propósito: o grafo precisa rodar sobre
 * arquivos possivelmente inválidos (o autor está no meio de uma edição) sem
 * explodir, e esta é a única forma que o editor gera.
 */
const REFERENCE_RE = /<(ContentBlock|IncludePage)\s+id=["']([^"']+)["']\s*\/?>/g;

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/;

/** Tamanho (em caracteres) do bloco de frontmatter no início do arquivo, ou 0. */
export function frontmatterLength(raw: string): number {
	const match = FRONTMATTER_RE.exec(raw);
	return match ? match[0].length : 0;
}

function locationAt(raw: string, offset: number): SourceLocation {
	let line = 1;
	let lineStart = 0;
	for (let i = 0; i < offset; i++) {
		if (raw.charCodeAt(i) === 10 /* \n */) {
			line++;
			lineStart = i + 1;
		}
	}
	return { line, column: offset - lineStart + 1, offset };
}

/**
 * Trechos do arquivo que *parecem* conteúdo mas não são: blocos de código
 * cercados (``` / ~~~) e código inline (`...`). Sem isso, uma página que
 * documenta a própria sintaxe de reuso entraria no grafo como se estivesse
 * usando os blocos que ela só está mostrando — e o grafo discordaria do
 * preview, que resolve pela árvore mdast e naturalmente ignora `code`.
 *
 * Blocos indentados com 4 espaços não são tratados: dentro de listas eles são
 * conteúdo normal, e o falso negativo seria pior que o falso positivo.
 */
function codeRanges(raw: string): [number, number][] {
	const ranges: [number, number][] = [];
	const lines = raw.split('\n');

	let offset = 0;
	let fence: { marker: string; length: number; start: number } | null = null;

	for (const line of lines) {
		const lineEnd = offset + line.length + 1;
		const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);

		if (fence) {
			// Só fecha com o mesmo caractere e ao menos o mesmo comprimento.
			if (fenceMatch && fenceMatch[1][0] === fence.marker && fenceMatch[1].length >= fence.length) {
				ranges.push([fence.start, lineEnd]);
				fence = null;
			}
		} else if (fenceMatch) {
			fence = { marker: fenceMatch[1][0], length: fenceMatch[1].length, start: offset };
		} else {
			// Código inline: pares de crases de mesmo comprimento na mesma linha.
			for (const span of line.matchAll(/(`+)(?:(?!\1).)*\1/g)) {
				const spanStart = offset + (span.index ?? 0);
				ranges.push([spanStart, spanStart + span[0].length]);
			}
		}

		offset = lineEnd;
	}

	// Cerca aberta até o fim do arquivo — o autor ainda está digitando.
	if (fence) ranges.push([fence.start, raw.length]);

	return ranges;
}

function isInside(ranges: [number, number][], offset: number): boolean {
	return ranges.some(([start, end]) => offset >= start && offset < end);
}

/**
 * Referências encontradas no arquivo bruto, com linha/coluna relativas ao
 * arquivo inteiro (frontmatter incluído) — é assim que o Monaco numera.
 * Ocorrências dentro do frontmatter ou de código são ignoradas.
 */
export function extractReferences(raw: string): RawReference[] {
	const bodyStart = frontmatterLength(raw);
	const ignored = codeRanges(raw);
	const refs: RawReference[] = [];

	REFERENCE_RE.lastIndex = 0;
	for (const match of raw.matchAll(REFERENCE_RE)) {
		const offset = match.index ?? 0;
		if (offset < bodyStart) continue;
		if (isInside(ignored, offset)) continue;
		refs.push({
			type: match[1] === 'ContentBlock' ? 'block' : 'page',
			id: match[2],
			location: locationAt(raw, offset),
		});
	}

	return refs;
}

// ---------------------------------------------------------------------------
// Índices e consultas
// ---------------------------------------------------------------------------

export function indexNodesByRef(graph: ContentGraph): Map<string, ContentNode> {
	const map = new Map<string, ContentNode>();
	for (const node of graph.nodes) {
		// Primeiro vence: se `x.md` e `x.mdx` coexistem, o `.md` é o canônico
		// (mesma ordem de tentativa do resolver do preview) e o outro vira um
		// problema `duplicate-id`.
		if (!map.has(nodeRef(node))) map.set(nodeRef(node), node);
	}
	return map;
}

export function indexNodesByKey(graph: ContentGraph): Map<string, ContentNode> {
	return new Map(graph.nodes.map((node) => [node.key, node]));
}

export function findNodeByKey(graph: ContentGraph, key: string): ContentNode | undefined {
	return graph.nodes.find((node) => node.key === key);
}

export function findNodeByRef(graph: ContentGraph, ref: string): ContentNode | undefined {
	return indexNodesByRef(graph).get(ref);
}

/** Arestas que saem deste arquivo — "esta página usa". */
export function getUses(graph: ContentGraph, key: string): ContentEdge[] {
	return graph.edges.filter((edge) => edge.source === key);
}

/** Arestas que chegam neste conteúdo — "esta página é usada por" (backlinks diretos). */
export function getBacklinks(graph: ContentGraph, ref: string): ContentEdge[] {
	return graph.edges.filter((edge) => edgeTargetRef(edge) === ref);
}

/** Mapa ref -> refs que ele usa (só as que resolvem para um nó existente). */
export function buildAdjacency(graph: ContentGraph): Map<string, string[]> {
	const byKey = indexNodesByKey(graph);
	const adjacency = new Map<string, string[]>();

	for (const node of graph.nodes) {
		if (!adjacency.has(nodeRef(node))) adjacency.set(nodeRef(node), []);
	}

	for (const edge of graph.edges) {
		const sourceNode = byKey.get(edge.source);
		if (!sourceNode) continue;
		const from = nodeRef(sourceNode);
		const to = edgeTargetRef(edge);
		const list = adjacency.get(from) ?? [];
		if (!list.includes(to)) list.push(to);
		adjacency.set(from, list);
	}

	return adjacency;
}

/** Mapa invertido: ref -> refs que o consomem. */
export function buildReverseAdjacency(graph: ContentGraph): Map<string, string[]> {
	const reverse = new Map<string, string[]>();
	for (const [from, targets] of buildAdjacency(graph)) {
		if (!reverse.has(from)) reverse.set(from, []);
		for (const to of targets) {
			const list = reverse.get(to) ?? [];
			if (!list.includes(from)) list.push(from);
			reverse.set(to, list);
		}
	}
	return reverse;
}

function traverse(adjacency: Map<string, string[]>, start: string): string[] {
	const seen = new Set<string>();
	const queue = [...(adjacency.get(start) ?? [])];

	while (queue.length > 0) {
		const current = queue.shift()!;
		if (current === start || seen.has(current)) continue;
		seen.add(current);
		for (const next of adjacency.get(current) ?? []) {
			if (!seen.has(next) && next !== start) queue.push(next);
		}
	}

	return [...seen];
}

/**
 * Todo mundo que é afetado por uma mudança neste conteúdo — diretos e
 * indiretos (A usa B, B usa C ⇒ mudar C afeta B e A). É a base do
 * impact analysis da §23 da especificação.
 */
export function getTransitiveConsumers(graph: ContentGraph, ref: string): string[] {
	return traverse(buildReverseAdjacency(graph), ref);
}

/** Todo conteúdo do qual este arquivo depende, direta ou indiretamente. */
export function getTransitiveDependencies(graph: ContentGraph, ref: string): string[] {
	return traverse(buildAdjacency(graph), ref);
}

export interface ImpactAnalysis {
	/** Consumidores diretos. */
	direct: ContentNode[];
	/** Consumidores indiretos (transitivos, excluindo os diretos). */
	indirect: ContentNode[];
	/** direct.length + indirect.length. */
	total: number;
	/** Refs transitivas que não têm um nó correspondente (não deveria acontecer). */
	unresolved: string[];
}

export function analyzeImpact(graph: ContentGraph, ref: string): ImpactAnalysis {
	const byRef = indexNodesByRef(graph);
	const directRefs = new Set(
		getBacklinks(graph, ref)
			.map((edge) => findNodeByKey(graph, edge.source))
			.filter((node): node is ContentNode => Boolean(node))
			.map(nodeRef)
	);

	const direct: ContentNode[] = [];
	const indirect: ContentNode[] = [];
	const unresolved: string[] = [];

	for (const consumerRef of getTransitiveConsumers(graph, ref)) {
		const node = byRef.get(consumerRef);
		if (!node) {
			unresolved.push(consumerRef);
			continue;
		}
		if (directRefs.has(consumerRef)) direct.push(node);
		else indirect.push(node);
	}

	const byTitle = (a: ContentNode, b: ContentNode) => a.id.localeCompare(b.id);
	direct.sort(byTitle);
	indirect.sort(byTitle);

	return { direct, indirect, total: direct.length + indirect.length, unresolved };
}

// ---------------------------------------------------------------------------
// Ciclos
// ---------------------------------------------------------------------------

/**
 * Todos os ciclos distintos do grafo, cada um como uma cadeia fechada
 * (`["block:a", "block:b", "block:a"]`). DFS com marcação de estado; cada
 * ciclo é normalizado (rotacionado para começar no menor ref) para não
 * reportar o mesmo ciclo N vezes, uma por ponto de entrada.
 */
export function findCycles(graph: ContentGraph): string[][] {
	const adjacency = buildAdjacency(graph);
	const state = new Map<string, 'visiting' | 'done'>();
	const stack: string[] = [];
	const found = new Map<string, string[]>();

	function visit(ref: string) {
		if (state.get(ref) === 'done') return;

		if (state.get(ref) === 'visiting') {
			const start = stack.indexOf(ref);
			if (start === -1) return;
			const cycle = stack.slice(start);
			const signature = normalizeCycle(cycle);
			if (!found.has(signature.join('>'))) {
				found.set(signature.join('>'), [...signature, signature[0]]);
			}
			return;
		}

		state.set(ref, 'visiting');
		stack.push(ref);
		for (const next of adjacency.get(ref) ?? []) visit(next);
		stack.pop();
		state.set(ref, 'done');
	}

	for (const ref of adjacency.keys()) visit(ref);

	return [...found.values()];
}

function normalizeCycle(cycle: string[]): string[] {
	let minIndex = 0;
	for (let i = 1; i < cycle.length; i++) {
		if (cycle[i] < cycle[minIndex]) minIndex = i;
	}
	return [...cycle.slice(minIndex), ...cycle.slice(0, minIndex)];
}

/**
 * Inserir `<ContentBlock id="target"/>` dentro de `sourceRef` criaria um ciclo?
 * Retorna a cadeia culpada, ou null quando é seguro. Usado pelo modal de
 * inserção para desabilitar a opção antes de o autor cometer o erro — em vez
 * de só descobrir no preview (Fase 3).
 */
export function wouldCreateCycle(graph: ContentGraph, sourceRef: string, targetRef: string): string[] | null {
	if (sourceRef === targetRef) return [sourceRef, targetRef];

	// Se o alvo já alcança a origem, fechar a aresta origem→alvo cria o ciclo.
	const reachableFromTarget = getTransitiveDependencies(graph, targetRef);
	if (!reachableFromTarget.includes(sourceRef)) return null;

	const path = shortestPath(buildAdjacency(graph), targetRef, sourceRef);
	return path ? [sourceRef, ...path] : [sourceRef, targetRef, sourceRef];
}

function shortestPath(adjacency: Map<string, string[]>, from: string, to: string): string[] | null {
	const queue: string[][] = [[from]];
	const seen = new Set<string>([from]);

	while (queue.length > 0) {
		const path = queue.shift()!;
		const tail = path[path.length - 1];
		if (tail === to) return path;
		for (const next of adjacency.get(tail) ?? []) {
			if (seen.has(next)) continue;
			seen.add(next);
			queue.push([...path, next]);
		}
	}
	return null;
}

// ---------------------------------------------------------------------------
// Problemas
// ---------------------------------------------------------------------------

export function findBrokenReferences(graph: ContentGraph): ContentEdge[] {
	return graph.edges.filter((edge) => !edge.resolved);
}

/** Blocos reutilizáveis que ninguém consome — "dead content detection" da §21. */
export function findUnusedReusable(graph: ContentGraph): ContentNode[] {
	const consumed = new Set(graph.edges.map(edgeTargetRef));
	return graph.nodes.filter((node) => node.type === 'block' && !consumed.has(nodeRef(node)));
}

/** Mesmo id em dois arquivos (tipicamente `x.md` e `x.mdx` lado a lado). */
export function findDuplicateIds(graph: ContentGraph): ContentNode[][] {
	const groups = new Map<string, ContentNode[]>();
	for (const node of graph.nodes) {
		const ref = nodeRef(node);
		groups.set(ref, [...(groups.get(ref) ?? []), node]);
	}
	return [...groups.values()].filter((group) => group.length > 1);
}

export function collectProblems(graph: ContentGraph): ContentProblem[] {
	const problems: ContentProblem[] = [];
	const byKey = indexNodesByKey(graph);
	const byRef = indexNodesByRef(graph);

	for (const edge of findBrokenReferences(graph)) {
		const node = byKey.get(edge.source);
		problems.push({
			kind: 'broken-reference',
			severity: 'error',
			message: `Conteúdo reutilizável não encontrado: "${edge.target}".`,
			nodeKey: edge.source,
			path: node?.path,
			root: node?.root,
			location: edge.location,
			targetId: edge.target,
		});
	}

	for (const cycle of findCycles(graph)) {
		const entry = byRef.get(cycle[0]);
		problems.push({
			kind: 'circular-reference',
			severity: 'error',
			message: `Referência circular detectada: ${cycle.join(' → ')}.`,
			nodeKey: entry?.key,
			path: entry?.path,
			root: entry?.root,
			chain: cycle,
		});
	}

	for (const group of findDuplicateIds(graph)) {
		problems.push({
			kind: 'duplicate-id',
			severity: 'warning',
			message: `O id "${group[0].id}" existe em mais de um arquivo (${group
				.map((node) => node.path)
				.join(', ')}). Só o primeiro é resolvido.`,
			nodeKey: group[0].key,
			path: group[0].path,
			root: group[0].root,
		});
	}

	for (const node of findUnusedReusable(graph)) {
		problems.push({
			kind: 'unused-content',
			severity: 'info',
			message: `Bloco reutilizável "${node.id}" não é usado por nenhuma página.`,
			nodeKey: node.key,
			path: node.path,
			root: node.root,
		});
	}

	return problems;
}

/**
 * Só os problemas que pertencem a um arquivo específico (para o Problems
 * panel). Um ciclo é reportado uma vez só no grafo global, mas interessa a
 * todos os arquivos que participam dele — por isso o `ref` opcional.
 */
export function problemsForNode(problems: ContentProblem[], key: string, ref?: string): ContentProblem[] {
	return problems.filter(
		(problem) => problem.nodeKey === key || (ref !== undefined && problem.chain?.includes(ref))
	);
}
