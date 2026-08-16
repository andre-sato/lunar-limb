import { readFile, writeFile, mkdir, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';

const ALLOWED_EXTENSIONS = new Set(['.md', '.mdx']);

export class ContentFsError extends Error {
	status: number;
	constructor(message: string, status = 400) {
		super(message);
		this.status = status;
	}
}

function toPosix(p: string): string {
	return p.split(path.sep).join('/');
}

export interface TreeNode {
	name: string;
	path: string; // posix, relative to the collection root
	type: 'dir' | 'file';
	ext?: string;
	title?: string;
	children?: TreeNode[];
}

export interface ReadResult {
	path: string;
	content: string;
	frontmatter: Record<string, unknown>;
	body: string;
	mtimeMs: number;
}

/**
 * Builds a small filesystem API scoped to one collection root (docs or
 * snippets). Every function re-resolves + re-validates the incoming path
 * against `root` before touching disk — never trust a path coming from a
 * request.
 */
export function createContentFs(root: string) {
	function resolveSafePath(relativePath: string): string {
		if (!relativePath || typeof relativePath !== 'string') {
			throw new ContentFsError('Caminho inválido.', 400);
		}
		const cleaned = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
		const resolved = path.resolve(root, cleaned);
		const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;

		if (resolved !== root && !resolved.startsWith(rootWithSep)) {
			throw new ContentFsError('Caminho fora da área de conteúdo permitida.', 403);
		}
		return resolved;
	}

	async function getTree(): Promise<TreeNode[]> {
		async function walk(dirAbs: string, dirRel: string): Promise<TreeNode[]> {
			let entries;
			try {
				entries = await readdir(dirAbs, { withFileTypes: true });
			} catch {
				return [];
			}
			const nodes: TreeNode[] = [];

			for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
				if (entry.name.startsWith('.')) continue;
				const abs = path.join(dirAbs, entry.name);
				const rel = dirRel ? `${dirRel}/${entry.name}` : entry.name;

				if (entry.isDirectory()) {
					const children = await walk(abs, rel);
					nodes.push({ name: entry.name, path: toPosix(rel), type: 'dir', children });
				} else {
					const ext = path.extname(entry.name);
					if (!ALLOWED_EXTENSIONS.has(ext)) continue;

					let title: string | undefined;
					try {
						const raw = await readFile(abs, 'utf-8');
						const parsed = matter(raw);
						title = typeof parsed.data?.title === 'string' ? parsed.data.title : undefined;
					} catch {
						// Unreadable/invalid frontmatter shouldn't break the whole tree.
					}

					nodes.push({ name: entry.name, path: toPosix(rel), type: 'file', ext, title });
				}
			}

			nodes.sort((a, b) => {
				if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
				return a.name.localeCompare(b.name);
			});
			return nodes;
		}

		return walk(root, '');
	}

	async function readDocument(relativePath: string): Promise<ReadResult> {
		const abs = resolveSafePath(relativePath);
		const ext = path.extname(abs);
		if (!ALLOWED_EXTENSIONS.has(ext)) {
			throw new ContentFsError('Apenas arquivos .md e .mdx podem ser abertos.', 400);
		}

		let raw: string;
		try {
			raw = await readFile(abs, 'utf-8');
		} catch {
			throw new ContentFsError('Arquivo não encontrado.', 404);
		}

		const info = await stat(abs);
		const parsed = matter(raw);

		return {
			path: toPosix(path.relative(root, abs)),
			content: raw,
			frontmatter: parsed.data ?? {},
			body: parsed.content,
			mtimeMs: info.mtimeMs,
		};
	}

	async function writeDocument(relativePath: string, content: string): Promise<void> {
		const abs = resolveSafePath(relativePath);
		const ext = path.extname(abs);
		if (!ALLOWED_EXTENSIONS.has(ext)) {
			throw new ContentFsError('Apenas arquivos .md e .mdx podem ser salvos.', 400);
		}
		try {
			await stat(abs);
		} catch {
			throw new ContentFsError('Arquivo não encontrado. Use "criar" para um novo arquivo.', 404);
		}
		await writeFile(abs, content, 'utf-8');
	}

	async function createDocument(relativePath: string, content: string): Promise<void> {
		const abs = resolveSafePath(relativePath);
		const ext = path.extname(abs);
		if (!ALLOWED_EXTENSIONS.has(ext)) {
			throw new ContentFsError('O novo arquivo precisa terminar em .md ou .mdx.', 400);
		}

		let exists = true;
		try {
			await stat(abs);
		} catch {
			exists = false;
		}
		if (exists) {
			throw new ContentFsError('Já existe um arquivo nesse caminho.', 409);
		}

		await mkdir(path.dirname(abs), { recursive: true });
		await writeFile(abs, content, 'utf-8');
	}

	async function deleteDocument(relativePath: string): Promise<void> {
		const abs = resolveSafePath(relativePath);
		try {
			await unlink(abs);
		} catch {
			throw new ContentFsError('Arquivo não encontrado.', 404);
		}
	}

	return { root, resolveSafePath, getTree, readDocument, writeDocument, createDocument, deleteDocument };
}

export type ContentFs = ReturnType<typeof createContentFs>;

export const CONTENT_ROOTS = {
	docs: path.join(process.cwd(), 'src', 'content', 'docs'),
	snippets: path.join(process.cwd(), 'src', 'content', 'snippets'),
} as const;

export type ContentRootKey = keyof typeof CONTENT_ROOTS;

const instances: Partial<Record<ContentRootKey, ContentFs>> = {};

export function getContentFs(key: ContentRootKey): ContentFs {
	if (!instances[key]) {
		instances[key] = createContentFs(CONTENT_ROOTS[key]);
	}
	return instances[key]!;
}

export function isContentRootKey(value: string | null): value is ContentRootKey {
	return value === 'docs' || value === 'snippets';
}
