import type { APIRoute } from 'astro';
import { readVariables, writeVariables } from '../../../lib/editor/variables-fs';
import { isValidVariableName, type VariableMap } from '../../../lib/content/variables';

export const prerender = false;

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

/** `GET /api/editor/variables` → { variables } */
export const GET: APIRoute = async () => {
	try {
		return json({ variables: await readVariables() });
	} catch (err) {
		return json({ error: err instanceof Error ? err.message : 'Erro desconhecido.' }, 500);
	}
};

/**
 * `PUT /api/editor/variables` com `{ variables }` — grava o conjunto inteiro.
 *
 * A escrita é do mapa completo, não incremental: o editor sempre manda o estado
 * que o autor está vendo, o que evita merges parciais estranhos quando duas
 * abas mexem no mesmo arquivo.
 */
export const PUT: APIRoute = async ({ request }) => {
	try {
		const body = await request.json();
		const incoming = body?.variables;

		if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
			return json({ error: 'Corpo inválido: esperado { variables }.' }, 400);
		}

		const validated: VariableMap = {};
		for (const [name, entry] of Object.entries(incoming as Record<string, unknown>)) {
			if (!isValidVariableName(name)) {
				return json({ error: `Nome de variável inválido: "${name}". Use letras, números, "-" e "_".` }, 400);
			}
			const candidate = entry as { value?: unknown; description?: unknown };
			const value = candidate?.value;
			if (typeof value !== 'boolean' && typeof value !== 'string') {
				return json({ error: `A variável "${name}" precisa de um valor booleano ou string.` }, 400);
			}
			validated[name] = {
				value,
				description: typeof candidate.description === 'string' && candidate.description.trim() !== ''
					? candidate.description.trim()
					: undefined,
			};
		}

		await writeVariables(validated);
		return json({ ok: true, variables: validated });
	} catch (err) {
		return json({ error: err instanceof Error ? err.message : 'Erro desconhecido.' }, 500);
	}
};
