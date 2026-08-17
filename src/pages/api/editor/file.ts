import type { APIRoute } from 'astro';
import { ContentFsError, getContentFs, isContentRootKey } from '../../../lib/editor/content-fs';
import { invalidateGraphCache } from '../../../lib/editor/content-graph';
import { createMirrors, type MirrorResult } from '../../../lib/editor/locale-mirror';
import { recordAudit, type AuditAction } from '../../../lib/auth/audit';

export const prerender = false;

/**
 * Auditoria de conteúdo (§34).
 *
 * Registrada depois da escrita: um evento de "documento salvo" só deve existir
 * se o arquivo realmente mudou. `recordAudit` nunca lança, então a falha do log
 * não derruba o salvamento.
 */
async function auditContent(
	locals: App.Locals,
	action: AuditAction,
	filePath: string,
	root: string | null
): Promise<void> {
	await recordAudit({
		actorId: locals.user?.id ?? 'anonymous',
		action,
		metadata: { path: filePath, root: root ?? 'docs' },
	});
}

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

export const PUT: APIRoute = async ({ request, locals }) => {
	try {
		const body = await request.json();
		const { path: filePath, content, root } = body ?? {};
		if (!filePath || typeof content !== 'string') {
			return json({ error: 'Corpo inválido: esperado { path, content }.' }, 400);
		}
		await pickRoot(typeof root === 'string' ? root : null).writeDocument(filePath, content);
		// O grafo é derivado dos arquivos: qualquer escrita invalida o índice.
		invalidateGraphCache();
		await auditContent(locals, 'DOCUMENT_UPDATED', filePath, typeof root === 'string' ? root : null);
		return json({ ok: true, savedAt: Date.now() });
	} catch (err) {
		return errorResponse(err);
	}
};

export const POST: APIRoute = async ({ request, locals }) => {
	try {
		const body = await request.json();
		const { path: filePath, content, root } = body ?? {};
		if (!filePath || typeof content !== 'string') {
			return json({ error: 'Corpo inválido: esperado { path, content }.' }, 400);
		}
		const rootKey = typeof root === 'string' ? root : null;
		const fs = pickRoot(rootKey);
		await fs.createDocument(filePath, content);
		invalidateGraphCache();
		await auditContent(locals, 'DOCUMENT_CREATED', filePath, rootKey);

		// Espelho nos outros idiomas. Só para páginas: um bloco reutilizável não
		// tem versão por idioma — quem tem idioma é a página que o inclui.
		let mirrors: MirrorResult | null = null;
		if (rootKey === null || rootKey === 'docs') {
			mirrors = await createMirrors(filePath, content, fs.createDocument);
			for (const created of mirrors.created) {
				await auditContent(locals, 'DOCUMENT_CREATED', created, rootKey);
			}
			if (mirrors.created.length > 0) invalidateGraphCache();
		}

		return json({ ok: true, mirrors }, 201);
	} catch (err) {
		return errorResponse(err);
	}
};

export const DELETE: APIRoute = async ({ url, locals }) => {
	const filePath = url.searchParams.get('path');
	if (!filePath) return json({ error: 'Parâmetro "path" é obrigatório.' }, 400);
	const fs = pickRoot(url.searchParams.get('root'));

	try {
		await fs.deleteDocument(filePath);
		invalidateGraphCache();
		await auditContent(locals, 'DOCUMENT_DELETED', filePath, url.searchParams.get('root'));
		return json({ ok: true });
	} catch (err) {
		return errorResponse(err);
	}
};
