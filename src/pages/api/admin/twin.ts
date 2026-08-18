import type { APIRoute } from 'astro';
import { jsonResponse, requireAuthUser } from '../../../lib/auth/api';
import { answerTwinQuery, digitalTwin } from '../../../lib/twin/service';

export const prerender = false;

/**
 * Digital Twin (§16, §17, §18, §19).
 *
 * `GET` devolve o resumo — cobertura, não documentados, potencialmente obsoletos.
 * `?node=` devolve um nó com suas relações e impacto, que é o que alimenta a
 * navegação produto ↔ documentação (§14, §15). `?q=` responde às perguntas
 * conhecidas (§18).
 *
 * Só leitura. O Twin é derivado das fontes de verdade; um `POST` aqui seria a
 * porta pela qual ele viraria a segunda verdade que a §2 proíbe.
 */
export const GET: APIRoute = async ({ url, locals }) => {
	const actor = requireAuthUser(locals);
	if (!actor) return jsonResponse({ error: 'unauthorized' }, 401);

	try {
		const question = url.searchParams.get('q');
		if (question) {
			const answer = await answerTwinQuery(question);
			return answer
				? jsonResponse(answer, 200)
				: jsonResponse(
						{
							error: 'unknown_question',
							message:
								'Sei responder sobre: endpoints não documentados, documentação potencialmente obsoleta, cobertura, e onde um endpoint está documentado.',
						},
						400
					);
		}

		const nodeId = url.searchParams.get('node');
		if (nodeId) {
			const node = await digitalTwin.getNode(nodeId);
			if (!node) return jsonResponse({ error: 'not_found' }, 404);

			const [relations, impact] = await Promise.all([
				digitalTwin.getRelations(nodeId),
				digitalTwin.getImpact(nodeId),
			]);

			return jsonResponse({ node, relations, impact }, 200);
		}

		return jsonResponse(await digitalTwin.getSummary(), 200);
	} catch (error) {
		return jsonResponse({ error: error instanceof Error ? error.message : 'Falha ao montar o Digital Twin.' }, 500);
	}
};
