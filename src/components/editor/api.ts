import type { TreeNode } from './types';

async function handle<T>(res: Response): Promise<T> {
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		const message = (data && typeof data.error === 'string') ? data.error : `Erro HTTP ${res.status}`;
		throw new Error(message);
	}
	return data as T;
}

export async function fetchTree(): Promise<TreeNode[]> {
	const res = await fetch('/api/editor/tree');
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

export async function fetchFile(path: string): Promise<FileResponse> {
	const res = await fetch(`/api/editor/file?path=${encodeURIComponent(path)}`);
	return handle<FileResponse>(res);
}

export async function saveFile(path: string, content: string): Promise<{ ok: true; savedAt: number }> {
	const res = await fetch('/api/editor/file', {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ path, content }),
	});
	return handle(res);
}

export async function createFile(path: string, content: string): Promise<{ ok: true }> {
	const res = await fetch('/api/editor/file', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ path, content }),
	});
	return handle(res);
}

export async function deleteFile(path: string): Promise<{ ok: true }> {
	const res = await fetch(`/api/editor/file?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
	return handle(res);
}

export interface PreviewResponse {
	html: string;
	frontmatter: Record<string, unknown>;
	warning?: string;
	errorLine?: number;
}

export async function fetchPreview(content: string, docPath?: string): Promise<PreviewResponse> {
	const res = await fetch('/api/editor/preview', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ content, path: docPath }),
	});
	return handle<PreviewResponse>(res);
}
