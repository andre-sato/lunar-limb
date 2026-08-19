import type { APIRoute } from 'astro';
import { jsonResponse, requireAuthUser } from '../../../lib/auth/api';
import { can } from '../../../lib/auth/permissions';
import { collectOrganization, searchOrganization } from '../../../lib/org/service';
import { loadOrganization } from '../../../lib/org/config';

export const prerender = false;

/**
 * Enterprise / Multi-repository (P3.5).
 *
 * Só leitura. Registrar repositório é editar o `organization.yml`, versionado
 * pelo Git — um verbo de escrita aqui criaria um registro que nenhum arquivo
 * sustenta, e a configuração passaria a existir em dois lugares.
 *
 * O papel do usuário é repassado ao serviço, e o filtro de visibilidade acontece
 * **antes** de qualquer leitura de disco: um repositório invisível para o papel
 * não deve nem ter os arquivos lidos, senão a contagem agregada denunciaria a
 * existência dele.
 */
export const GET: APIRoute = async ({ url, locals }) => {
	const actor = requireAuthUser(locals);
	if (!actor) return jsonResponse({ error: 'unauthorized' }, 401);
	if (!can(actor, 'settings.access')) return jsonResponse({ error: 'forbidden' }, 403);

	const view = url.searchParams.get('view') ?? 'status';

	try {
		if (view === 'repositories') return jsonResponse(await loadOrganization(), 200);

		if (view === 'search') {
			const term = url.searchParams.get('q') ?? '';
			if (term.trim() === '') return jsonResponse({ error: 'invalid_request', message: 'Informe o termo.' }, 400);

			return jsonResponse({ hits: await searchOrganization(term.slice(0, 120), { role: actor.role, limit: 40 }) }, 200);
		}

		return jsonResponse(await collectOrganization({ role: actor.role }), 200);
	} catch (error) {
		console.error('[org] falha ao montar o relatório', error);
		return jsonResponse({ error: 'internal_error' }, 500);
	}
};
