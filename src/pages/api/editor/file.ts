import type { APIRoute } from 'astro';
import {
	ContentFsError,
	readDocument,
	writeDocument,
	createDocument,
	deleteDocument,
} from '../../../lib/editor/content-fs';

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

export const GET: APIRoute = async ({ url }) => {
	const filePath = url.searchParams.get('path');
	if (!filePath) return json({ error: 'Parâmetro "path" é obrigatório.' }, 400);

	try {
		const doc = await readDocument(filePath);
		return json(doc);
	} catch (err) {
		return errorResponse(err);
	}
};

export const PUT: APIRoute = async ({ request }) => {
	try {
		const body = await request.json();
		const { path: filePath, content } = body ?? {};
		if (!filePath || typeof content !== 'string') {
			return json({ error: 'Corpo inválido: esperado { path, content }.' }, 400);
		}
		await writeDocument(filePath, content);
		return json({ ok: true, savedAt: Date.now() });
	} catch (err) {
		return errorResponse(err);
	}
};

export const POST: APIRoute = async ({ request }) => {
	try {
		const body = await request.json();
		const { path: filePath, content } = body ?? {};
		if (!filePath || typeof content !== 'string') {
			return json({ error: 'Corpo inválido: esperado { path, content }.' }, 400);
		}
		await createDocument(filePath, content);
		return json({ ok: true }, 201);
	} catch (err) {
		return errorResponse(err);
	}
};

export const DELETE: APIRoute = async ({ url }) => {
	const filePath = url.searchParams.get('path');
	if (!filePath) return json({ error: 'Parâmetro "path" é obrigatório.' }, 400);

	try {
		await deleteDocument(filePath);
		return json({ ok: true });
	} catch (err) {
		return errorResponse(err);
	}
};
