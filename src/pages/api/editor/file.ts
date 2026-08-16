import type { APIRoute } from 'astro';
import { ContentFsError, getContentFs, isContentRootKey } from '../../../lib/editor/content-fs';
import { invalidateGraphCache } from '../../../lib/editor/content-graph';

export const prerender = false;

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

function errorResponse(err: unknown): Response {
	if (err instanceof ContentFsError) {
		return json({ error: err.message }, err.status);
	}
	const message = err instanceof Error ? err.message : 'Erro desconhecido.';
	return json({ error: message }, 500);
}

function pickRoot(value: string | null) {
	return getContentFs(isContentRootKey(value) ? value : 'docs');
}

export const GET: APIRoute = async ({ url }) => {
	const filePath = url.searchParams.get('path');
	if (!filePath) return json({ error: 'Parâmetro "path" é obrigatório.' }, 400);
	const fs = pickRoot(url.searchParams.get('root'));

	try {
		const doc = await fs.readDocument(filePath);
		return json(doc);
	} catch (err) {
		return errorResponse(err);
	}
};

export const PUT: APIRoute = async ({ request }) => {
	try {
		const body = await request.json();
		const { path: filePath, content, root } = body ?? {};
		if (!filePath || typeof content !== 'string') {
			return json({ error: 'Corpo inválido: esperado { path, content }.' }, 400);
		}
		await pickRoot(typeof root === 'string' ? root : null).writeDocument(filePath, content);
		// O grafo é derivado dos arquivos: qualquer escrita invalida o índice.
		invalidateGraphCache();
		return json({ ok: true, savedAt: Date.now() });
	} catch (err) {
		return errorResponse(err);
	}
};

export const POST: APIRoute = async ({ request }) => {
	try {
		const body = await request.json();
		const { path: filePath, content, root } = body ?? {};
		if (!filePath || typeof content !== 'string') {
			return json({ error: 'Corpo inválido: esperado { path, content }.' }, 400);
		}
		await pickRoot(typeof root === 'string' ? root : null).createDocument(filePath, content);
		invalidateGraphCache();
		return json({ ok: true }, 201);
	} catch (err) {
		return errorResponse(err);
	}
};

export const DELETE: APIRoute = async ({ url }) => {
	const filePath = url.searchParams.get('path');
	if (!filePath) return json({ error: 'Parâmetro "path" é obrigatório.' }, 400);
	const fs = pickRoot(url.searchParams.get('root'));

	try {
		await fs.deleteDocument(filePath);
		invalidateGraphCache();
		return json({ ok: true });
	} catch (err) {
		return errorResponse(err);
	}
};
