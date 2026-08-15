import { readFile, writeFile, mkdir, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';

/**
 * Everything the editor can touch lives under this directory. All paths that
 * come in from the client are relative to this root, and every function here
 * re-resolves + re-validates them before touching the filesystem — never
 * trust a path coming from a request.
 */
const CONTENT_ROOT = path.join(process.cwd(), 'src', 'content', 'docs');

const ALLOWED_EXTENSIONS = new Set(['.md', '.mdx']);

export class ContentFsError extends Error {
	status: number;
	constructor(message: string, status = 400) {
		super(message);
		this.status = status;
	}
}

/** Turns a client-supplied relative path into a safe, absolute path inside CONTENT_ROOT. */
export function resolveSafePath(relativePath: string): string {
	if (!relativePath || typeof relativePath !== 'string') {
		throw new ContentFsError('Caminho inválido.', 400);
	}
	// Normalize slashes and strip any leading slash so path.join can't escape the root.
	const cleaned = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
	const resolved = path.resolve(CONTENT_ROOT, cleaned);
	const rootWithSep = CONTENT_ROOT.endsWith(path.sep) ? CONTENT_ROOT : CONTENT_ROOT + path.sep;

	if (resolved !== CONTENT_ROOT && !resolved.startsWith(rootWithSep)) {
		throw new ContentFsError('Caminho fora da área de conteúdo permitida.', 403);
	}
	return resolved;
}

function toPosix(p: string): string {
	return p.split(path.sep).join('/');
}

export interface TreeNode {
	name: string;
	path: string; // posix, relative to CONTENT_ROOT
	type: 'dir' | 'file';
	ext?: string;
	title?: string;
	children?: TreeNode[];
}

/** Recursively walks CONTENT_ROOT and returns a nested tree of folders/files. */
export async function getTree(): Promise<TreeNode[]> {
	async function walk(dirAbs: string, dirRel: string): Promise<TreeNode[]> {
		const entries = await readdir(dirAbs, { withFileTypes: true });
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

		// Folders first, then files, both alphabetically.
		nodes.sort((a, b) => {
			if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
			return a.name.localeCompare(b.name);
		});
		return nodes;
	}

	return walk(CONTENT_ROOT, '');
}

export interface ReadResult {
	path: string;
	content: string;
	frontmatter: Record<string, unknown>;
	body: string;
	mtimeMs: number;
}

export async function readDocument(relativePath: string): Promise<ReadResult> {
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
		path: toPosix(path.relative(CONTENT_ROOT, abs)),
		content: raw,
		frontmatter: parsed.data ?? {},
		body: parsed.content,
		mtimeMs: info.mtimeMs,
	};
}

export async function writeDocument(relativePath: string, content: string): Promise<void> {
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

export async function createDocument(relativePath: string, content: string): Promise<void> {
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

export async function deleteDocument(relativePath: string): Promise<void> {
	const abs = resolveSafePath(relativePath);
	try {
		await unlink(abs);
	} catch {
		throw new ContentFsError('Arquivo não encontrado.', 404);
	}
}
