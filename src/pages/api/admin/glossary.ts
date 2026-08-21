import type { APIRoute } from 'astro';
import { jsonResponse, requireAuthUser } from '../../../lib/auth/api';
import { can } from '../../../lib/auth/permissions';
import { auditGlossary } from '../../../lib/glossary/audit';

export const prerender = false;

/**
 * Glossário na administração (issue #4).
 *
 * Somente `GET`. O glossário é Markdown versionado em `src/content/glossary/`, e
 * editar um termo continua sendo editar o arquivo — no editor, com diff e
 * revisão. Uma rota de escrita aqui criaria um segundo caminho para o mesmo
 * conteúdo, com regras diferentes das do editor, e a mais fraca é a que valeria.
 *
 * O que esta tela acrescenta é a visão do conjunto: quais termos ninguém usa,
 * quais definições não se sustentam numa bolha, e quais formas estão em conflito
 * — perguntas que não se respondem abrindo arquivo por arquivo.
 */
export const GET: APIRoute = async ({ locals }) => {
	const actor = requireAuthUser(locals);
	if (!actor) return jsonResponse({ error: 'unauthorized' }, 401);
	if (!can(actor, 'settings.access')) return jsonResponse({ error: 'forbidden' }, 403);

	try {
		return jsonResponse(await auditGlossary(), 200);
	} catch (error) {
		// Glossário ilegível não derruba a tela: ela diz que não conseguiu ler, em
		// vez de mostrar zero termos, que pareceria um glossário vazio.
		return jsonResponse(
			{ error: 'glossary_unreadable', message: error instanceof Error ? error.message : String(error) },
			500
		);
	}
};
