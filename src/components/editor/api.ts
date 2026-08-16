import type {
	ContentGraph,
	ContentNode,
	ContentProblem,
	ContentRoot,
	GitStatusMap,
	ImpactAnalysis,
	ReferenceDetail,
	ReusableItem,
	SearchHit,
	TreeNode,
	VariableMap,
} from './types';

async function handle<T>(res: Response): Promise<T> {
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		const message = (data && typeof data.error === 'string') ? data.error : `Erro HTTP ${res.status}`;
		throw new Error(message);
	}
	return data as T;
}

export async function fetchTree(root: ContentRoot = 'docs'): Promise<TreeNode[]> {
	const res = await fetch(`/api/editor/tree?root=${root}`);
	const data = await handle<{ tree: TreeNode[] }>(res);
	return data.tree;
}

export interface FileResponse {
	path: string;
	content: string;
	frontmatter: Record<string, unknown>;
	body: string;
	mtimeMs: number;
}

export async function fetchFile(path: string, root: ContentRoot = 'docs'): Promise<FileResponse> {
	const res = await fetch(`/api/editor/file?path=${encodeURIComponent(path)}&root=${root}`);
	return handle<FileResponse>(res);
}

export async function saveFile(
	path: string,
	content: string,
	root: ContentRoot = 'docs'
): Promise<{ ok: true; savedAt: number }> {
	const res = await fetch('/api/editor/file', {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ path, content, root }),
	});
	return handle(res);
}

export async function createFile(
	path: string,
	content: string,
	root: ContentRoot = 'docs'
): Promise<{ ok: true }> {
	const res = await fetch('/api/editor/file', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ path, content, root }),
	});
	return handle(res);
}

export async function deleteFile(path: string, root: ContentRoot = 'docs'): Promise<{ ok: true }> {
	const res = await fetch(`/api/editor/file?path=${encodeURIComponent(path)}&root=${root}`, { method: 'DELETE' });
	return handle(res);
}

export interface PreviewResponse {
	html: string;
	frontmatter: Record<string, unknown>;
	warning?: string;
	errorLine?: number;
	reusableIssues?: { id: string; reason: 'not-found' | 'circular' }[];
	conditionalIssues?: { flag: string; reason: 'unknown-variable' }[];
	hiddenReason?: 'visible-false' | 'condition-off' | null;
}

export async function fetchPreview(
	content: string,
	filePath?: string | null,
	root: ContentRoot = 'docs'
): Promise<PreviewResponse> {
	const res = await fetch('/api/editor/preview', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ content, path: filePath ?? undefined, root }),
	});
	return handle<PreviewResponse>(res);
}

export async function fetchReusable(): Promise<{ blocks: ReusableItem[]; pages: ReusableItem[] }> {
	const res = await fetch('/api/editor/reusable');
	return handle(res);
}

export interface ReferencesResponse {
	/** O arquivo consultado, quando ele já existe no grafo. */
	node?: ContentNode;
	/** Conteúdo reutilizável que este arquivo consome. */
	uses: ReferenceDetail[];
	/** Arquivos que consomem este conteúdo (backlinks diretos). */
	usedBy: ReferenceDetail[];
	/** Impacto transitivo de editar este arquivo. */
	impact: ImpactAnalysis;
	/** Problemas do grafo que pertencem a este arquivo. */
	problems: ContentProblem[];
}

export async function fetchReferences(path: string, root: ContentRoot = 'docs'): Promise<ReferencesResponse> {
	const res = await fetch(`/api/editor/references?path=${encodeURIComponent(path)}&root=${root}`);
	return handle(res);
}

export interface GraphResponse {
	graph: ContentGraph;
	problems: ContentProblem[];
}

/** Grafo completo + problemas globais (referências quebradas, ciclos, órfãos). */
export async function fetchGraph(options: { fresh?: boolean } = {}): Promise<GraphResponse> {
	const res = await fetch(`/api/editor/graph${options.fresh ? '?fresh=1' : ''}`);
	return handle<GraphResponse>(res);
}

/**
 * Inserir `targetRef` ("block:auth-warning") dentro de `sourceKey`
 * ("docs:guides/a.mdx") fecharia um ciclo? Retorna a cadeia culpada ou null.
 */
export async function checkCycle(sourceKey: string, targetRef: string): Promise<string[] | null> {
	const res = await fetch(
		`/api/editor/graph?source=${encodeURIComponent(sourceKey)}&target=${encodeURIComponent(targetRef)}`
	);
	const data = await handle<{ cycle: string[] | null }>(res);
	return data.cycle;
}

// ---------------------------------------------------------------------------
// Fase 5
// ---------------------------------------------------------------------------

export async function fetchVariables(): Promise<VariableMap> {
	const res = await fetch('/api/editor/variables');
	const data = await handle<{ variables: VariableMap }>(res);
	return data.variables;
}

export async function saveVariables(variables: VariableMap): Promise<VariableMap> {
	const res = await fetch('/api/editor/variables', {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ variables }),
	});
	const data = await handle<{ ok: true; variables: VariableMap }>(res);
	return data.variables;
}

export async function searchContent(query: string, caseSensitive = false): Promise<SearchHit[]> {
	const res = await fetch(
		`/api/editor/search?q=${encodeURIComponent(query)}${caseSensitive ? '&case=1' : ''}`
	);
	const data = await handle<{ hits: SearchHit[] }>(res);
	return data.hits;
}

export async function fetchGitStatus(): Promise<GitStatusMap> {
	const res = await fetch('/api/editor/git');
	return handle<GitStatusMap>(res);
}
