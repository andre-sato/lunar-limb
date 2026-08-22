import type { APIRoute } from 'astro';
import { lintDocument } from '../../../lib/linter/lint';
import { listProfiles } from '../../../lib/linter/config';
import { getGlossaryIndex } from '../../../lib/glossary/loader';
import { setGlossaryIndex } from '../../../lib/linter/rules/glossary';
import { readJsonObject } from '../../../lib/auth/api';

export const prerender = false;

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
	});
}

/**
 * Analisa o conteúdo enviado pelo editor.
 *
 * Recebe o texto do buffer, e não o arquivo em disco: o autor precisa ver o
 * resultado do que está escrevendo agora, inclusive antes de salvar.
 */
export const POST: APIRoute = async ({ request }) => {
	const parsed = await readJsonObject(request);
	if (!parsed.ok) return json({ error: parsed.error }, 400);

	const body: { path?: unknown; content?: unknown; profile?: unknown } = parsed.value;

	if (typeof body.content !== 'string') {
		return json({ error: 'Corpo inválido: esperado { content }.' }, 400);
	}

	try {
		// O glossário alimenta as regras de consistência (§30). O índice tem cache
		// curto, então isto não relê o disco a cada tecla digitada no editor.
		setGlossaryIndex(await getGlossaryIndex());

		const result = await lintDocument(body.content, {
			path: typeof body.path === 'string' ? body.path : undefined,
			profile: typeof body.profile === 'string' && body.profile ? body.profile : undefined,
		});
		return json(result);
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : 'Falha ao analisar.' }, 500);
	}
};

/** Profiles disponíveis, para o seletor da interface. */
export const GET: APIRoute = async () => {
	return json({ profiles: await listProfiles() });
};
