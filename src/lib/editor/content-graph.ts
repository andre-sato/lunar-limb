import matter from 'gray-matter';
import { getContentFs, type TreeNode } from './content-fs';

export interface ReusableItem {
	id: string;
	type: 'block' | 'page';
	path: string; // relative to its collection root (snippets/ or docs/)
	title?: string;
	description?: string;
}

export interface ContentReference {
	source: string; // "docs:guides/payments.md" or "snippets:auth-warning.md"
	target: string; // reusable id
	type: 'block' | 'page';
}

// Matches the exact self-closing JSX tags the editor inserts:
//   <ContentBlock id="auth-warning" />
//   <IncludePage id="authentication" />
// Deliberately simple (regex, not a full MDX AST parse) — good enough since
// this is the only shape the editor itself ever writes.
const REFERENCE_RE = /<(ContentBlock|IncludePage)\s+id=["']([^"']+)["']\s*\/?>/g;

function docIdFromPath(relPath: string): string {
	return relPath.replace(/\.(md|mdx)$/i, '');
}

function flattenFiles(nodes: TreeNode[]): TreeNode[] {
	const files: TreeNode[] = [];
	for (const node of nodes) {
		if (node.type === 'file') files.push(node);
		else if (node.children) files.push(...flattenFiles(node.children));
	}
	return files;
}

export function extractReferences(rawContent: string): { type: 'block' | 'page'; id: string }[] {
	const body = matter(rawContent).content;
	const refs: { type: 'block' | 'page'; id: string }[] = [];
	for (const match of body.matchAll(REFERENCE_RE)) {
		refs.push({ type: match[1] === 'ContentBlock' ? 'block' : 'page', id: match[2] });
	}
	return refs;
}

export async function listReusable(): Promise<{ blocks: ReusableItem[]; pages: ReusableItem[] }> {
	const [snippetTree, docsTree] = await Promise.all([
		getContentFs('snippets').getTree(),
		getContentFs('docs').getTree(),
	]);

	const blocks: ReusableItem[] = flattenFiles(snippetTree).map((node) => ({
		id: docIdFromPath(node.path),
		type: 'block',
		path: node.path,
		title: node.title,
	}));

	const pages: ReusableItem[] = flattenFiles(docsTree).map((node) => ({
		id: docIdFromPath(node.path),
		type: 'page',
		path: node.path,
		title: node.title,
	}));

	return { blocks, pages };
}

/** Scans every doc + snippet and returns every reference edge found. */
export async function buildReferenceGraph(): Promise<ContentReference[]> {
	const docsFs = getContentFs('docs');
	const snippetsFs = getContentFs('snippets');

	const [docFiles, snippetFiles] = await Promise.all([
		flattenFiles(await docsFs.getTree()),
		flattenFiles(await snippetsFs.getTree()),
	]);

	const edges: ContentReference[] = [];

	async function scan(files: TreeNode[], fs: ReturnType<typeof getContentFs>, sourcePrefix: 'docs' | 'snippets') {
		for (const file of files) {
			try {
				const doc = await fs.readDocument(file.path);
				for (const ref of extractReferences(doc.content)) {
					edges.push({ source: `${sourcePrefix}:${file.path}`, target: ref.id, type: ref.type });
				}
			} catch {
				// Unreadable file — skip it rather than failing the whole scan.
			}
		}
	}

	await scan(docFiles, docsFs, 'docs');
	await scan(snippetFiles, snippetsFs, 'snippets');

	return edges;
}

export interface ReferencesForResult {
	uses: ContentReference[];
	usedBy: ContentReference[];
}

/** `sourceKey` is e.g. "docs:guides/payments.md" or "snippets:auth-warning.md". */
export async function getReferencesFor(sourceKey: string): Promise<ReferencesForResult> {
	const [, relPath] = splitSourceKey(sourceKey);
	const id = docIdFromPath(relPath);
	const edges = await buildReferenceGraph();

	const uses = edges.filter((e) => e.source === sourceKey);
	const usedBy = edges.filter((e) => e.target === id);

	return { uses, usedBy };
}

function splitSourceKey(sourceKey: string): [string, string] {
	const idx = sourceKey.indexOf(':');
	if (idx === -1) return ['docs', sourceKey];
	return [sourceKey.slice(0, idx), sourceKey.slice(idx + 1)];
}

export interface CircularCheckResult {
	circular: boolean;
	chain?: string[];
}

/**
 * Depth-first search from `startId` (a reusable id) following its outgoing
 * references, looking for a path back to `startId`. Used both to warn before
 * saving/inserting and to guard the preview resolver against infinite loops.
 */
export async function detectCircular(startId: string): Promise<CircularCheckResult> {
	const { blocks, pages } = await listReusable();
	const byId = new Map<string, ReusableItem>();
	for (const item of [...blocks, ...pages]) byId.set(item.id, item);

	const docsFs = getContentFs('docs');
	const snippetsFs = getContentFs('snippets');

	async function outgoing(id: string): Promise<{ type: 'block' | 'page'; id: string }[]> {
		const item = byId.get(id);
		if (!item) return [];
		const fs = item.type === 'block' ? snippetsFs : docsFs;
		try {
			const doc = await fs.readDocument(item.path);
			return extractReferences(doc.content);
		} catch {
			return [];
		}
	}

	async function dfs(id: string, chain: string[]): Promise<CircularCheckResult> {
		if (chain.includes(id)) {
			return { circular: true, chain: [...chain, id] };
		}
		const nextChain = [...chain, id];
		for (const ref of await outgoing(id)) {
			const result = await dfs(ref.id, nextChain);
			if (result.circular) return result;
		}
		return { circular: false };
	}

	return dfs(startId, []);
}

export function docPathToId(relPath: string): string {
	return docIdFromPath(relPath);
}

export function idToLikelyPaths(id: string): string[] {
	return [`${id}.md`, `${id}.mdx`];
}
