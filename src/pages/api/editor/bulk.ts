import type { APIRoute } from 'astro';
import { ContentFsError, getContentFs, isContentRootKey, type ContentRootKey } from '../../../lib/editor/content-fs';
import { getReferencesFor, invalidateGraphCache } from '../../../lib/editor/content-graph';
import { applyReplace, planDelete, planReplace, type ReplacePlan } from '../../../lib/editor/bulk';
import { recordAudit } from '../../../lib/auth/audit';
import { readJsonObject } from '../../../lib/auth/api';

export const prerender = false;

/**
 * Operações em lote (issue #17).
 *
 *   POST /api/editor/bulk  { op: 'replace-preview', query, replacement, ... }
 *   POST /api/editor/bulk  { op: 'replace-apply', plan, only? }
 *   POST /api/editor/bulk  { op: 'delete-preview', targets }
 *   POST /api/editor/bulk  { op: 'delete-apply', targets }
 *
 * As duas operações destrutivas têm prévia separada da aplicação, e a aplicação
 * exige o plano que a prévia devolveu. Não é cerimônia: o plano carrega a
 * impressão digital de cada arquivo, e é ela que garante que o que foi aprovado
 * é o que vai ser escrito.
 */

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function errorResponse(error: unknown): Response {
	if (error instanceof ContentFsError) return json({ error: error.message }, 400);
	return json({ error: error instanceof Error ? error.message : 'Erro desconhecido.' }, 500);
}

const readFile = async (root: ContentRootKey, path: string) => (await getContentFs(root).readDocument(path)).content;
const writeFile = async (root: ContentRootKey, path: string, content: string) => {
	await getContentFs(root).writeDocument(path, content);
};

function rootOf(value: unknown): ContentRootKey {
	return typeof value === 'string' && isContentRootKey(value) ? value : 'docs';
}

/**
 * As entradas do plano, conferidas uma a uma.
 *
 * O plano chega pelo corpo da requisição, então nada nele é confiável — nem que
 * `files` seja uma lista de objetos. Conferir só `Array.isArray(plan.files)`
 * deixava passar `[null]`, e o estouro acontecia lá dentro, no `file.path`,
 * virando 500 com a mensagem do motor JavaScript.
 *
 * Entrada malformada é descartada em vez de derrubar o lote: quem manda dez
 * arquivos e erra a forma de um deve ver os outros nove aplicados, e o
 * resultado já tem onde reportar o que ficou de fora.
 */
function planFilesOf(plan: ReplacePlan): ReplacePlan['files'] {
	if (!Array.isArray(plan.files)) return [];

	return (plan.files as unknown[]).filter((file): file is ReplacePlan['files'][number] => {
		if (!file || typeof file !== 'object') return false;
		const candidate = file as Record<string, unknown>;
		return (
			typeof candidate.path === 'string' &&
			candidate.path !== '' &&
			typeof candidate.fingerprint === 'string' &&
			Array.isArray(candidate.occurrences)
		);
	});
}

export const POST: APIRoute = async ({ request, locals }) => {
	const parsed = await readJsonObject(request);
	if (!parsed.ok) return json({ error: parsed.error }, 400);

	const body = parsed.value;
	const op = body.op;

	try {
		// -------------------------------------------------------------- replace
		if (op === 'replace-preview') {
			const query = typeof body.query === 'string' ? body.query : '';
			if (query.trim() === '') return json({ error: 'Informe o termo a substituir.' }, 400);

			const plan = await planReplace({
				query,
				replacement: typeof body.replacement === 'string' ? body.replacement : '',
				options: {
					caseSensitive: body.caseSensitive === true,
					wholeWord: body.wholeWord === true,
					includeCodeBlocks: body.includeCodeBlocks === true,
					folder: typeof body.folder === 'string' ? body.folder : undefined,
				},
				read: readFile,
			});

			return json({ plan });
		}

		if (op === 'replace-apply') {
			const raw = body.plan as ReplacePlan | undefined;
			if (!raw || typeof raw !== 'object' || !Array.isArray(raw.files)) {
				return json({ error: 'Aplicação exige o plano devolvido pela prévia.' }, 400);
			}

			const files = planFilesOf(raw);
			if (files.length === 0) {
				return json({ error: 'O plano não tem nenhum arquivo em forma utilizável.' }, 400);
			}

			const plan: ReplacePlan = { ...raw, files };
			const only = Array.isArray(body.only) ? body.only.filter((entry): entry is string => typeof entry === 'string') : undefined;
			const result = await applyReplace({ plan, read: readFile, write: writeFile, only });

			if (result.applied.length > 0) invalidateGraphCache();

			// Um evento por arquivo: a auditoria precisa responder "o que aconteceu
			// com esta página", e um evento agregado não responde isso.
			for (const file of result.applied) {
				await recordAudit({
					actorId: locals.user?.id ?? 'anonymous',
					action: 'DOCUMENT_UPDATED',
					metadata: { path: file.path, root: file.root, bulk: 'replace', occurrences: file.occurrences },
				});
			}

			return json({ result });
		}

		// --------------------------------------------------------------- delete
		if (op === 'delete-preview' || op === 'delete-apply') {
			const rawTargets = Array.isArray(body.targets) ? body.targets : [];
			const targets = rawTargets
				.map((entry) => (entry ?? {}) as Record<string, unknown>)
				.filter((entry) => typeof entry.path === 'string' && entry.path !== '')
				.map((entry) => ({ path: entry.path as string, root: rootOf(entry.root) }));

			if (targets.length === 0) return json({ error: 'Nenhum arquivo selecionado.' }, 400);

			// As dependências vêm do Content Graph, que já responde "quem usa o quê".
			const dependents = new Map<string, string[]>();
			for (const target of targets) {
				const references = await getReferencesFor(`${target.root}:${target.path}`);
				dependents.set(
					`${target.root}:${target.path}`,
					references.usedBy.map((entry) => `${entry.root}:${entry.path}`)
				);
			}

			const plan = planDelete(targets, (target) => dependents.get(`${target.root}:${target.path}`) ?? []);

			if (op === 'delete-preview') return json({ plan });

			// Apagar exige confirmação explícita de que a prévia foi vista. Sem
			// isto, um cliente que erre a operação apaga o lote inteiro.
			if (body.confirmed !== true) {
				return json({ error: 'Exclusão em lote exige `confirmed: true` depois da prévia.', plan }, 409);
			}

			const deleted: string[] = [];
			const failed: Array<{ path: string; error: string }> = [];

			for (const target of plan.targets) {
				try {
					await getContentFs(target.root).deleteDocument(target.path);
					deleted.push(target.path);
					await recordAudit({
						actorId: locals.user?.id ?? 'anonymous',
						action: 'DOCUMENT_DELETED',
						metadata: { path: target.path, root: target.root, bulk: 'delete' },
					});
				} catch (error) {
					failed.push({ path: target.path, error: error instanceof Error ? error.message : String(error) });
				}
			}

			if (deleted.length > 0) invalidateGraphCache();
			return json({ deleted, failed, breaking: plan.breaking.map((entry) => entry.path) });
		}

		return json({ error: `Operação desconhecida: ${String(op)}` }, 400);
	} catch (error) {
		return errorResponse(error);
	}
};
