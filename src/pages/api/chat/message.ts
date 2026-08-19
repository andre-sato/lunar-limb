import type { APIRoute } from 'astro';
import { jsonResponse, requireAuthUser } from '../../../lib/auth/api';
import { recordAudit } from '../../../lib/auth/audit';
import { canGenerate, loadChatConfig, providerApiKey } from '../../../lib/chat/config';
import { anthropicModel } from '../../../lib/chat/models';
import { createAssistant } from '../../../lib/chat/service';
import { can } from '../../../lib/auth/permissions';
import { normalizeLocale } from '../../../lib/chat/retrieval';
import { ChatError } from '../../../lib/chat/search';
import { checkRateLimit, getOrCreateConversation } from '../../../lib/chat/store';
import { getTrustIndex } from '../../../lib/trust/load';
import { recordSearchEvent } from '../../../lib/health/analytics';
import { loadHealthConfig } from '../../../lib/health/config';
import { contextFromCookie, mergeContext, normalizeContext, CONTEXT_COOKIE } from '../../../lib/adaptive/context';
import { recordAudienceEvent } from '../../../lib/adaptive/analytics';
import { recordQuerySignal } from '../../../lib/gaps/telemetry';
import { recordEvent } from '../../../lib/observe/store';
import { loadObservabilityConfig } from '../../../lib/observe/config';
import { sanitizeSession } from '../../../lib/observe/store';

export const prerender = false;

/**
 * Uma consulta à documentação.
 *
 * O middleware já garantiu autenticação e `docs.read` (ver `guard.ts`); a
 * checagem aqui é a segunda camada, não a primeira — uma rota que confia apenas
 * no middleware fica insegura no dia em que alguém mexe na tabela de rotas.
 */
export const POST: APIRoute = async ({ request, locals, cookies }) => {
	const actor = requireAuthUser(locals);
	if (!actor) return jsonResponse({ error: 'unauthorized' }, 401);

	const config = await loadChatConfig();
	if (!config.enabled) {
		return jsonResponse({ error: 'disabled', message: 'A busca na documentação está desativada.' }, 503);
	}

	let payload: Record<string, unknown>;
	try {
		payload = await request.json();
	} catch {
		return jsonResponse({ error: 'invalid_request', message: 'Corpo inválido.' }, 400);
	}

	const message = typeof payload.message === 'string' ? payload.message : '';
	const conversationId = typeof payload.conversationId === 'string' ? payload.conversationId : undefined;

	const limit = checkRateLimit(actor.id, config.rateLimitPerHour);
	if (!limit.allowed) {
		await recordAudit({
			actorId: actor.id,
			action: 'CHAT_RATE_LIMITED',
			metadata: { limitPerHour: config.rateLimitPerHour },
		});
		return new Response(
			JSON.stringify({
				error: 'rate_limited',
				message: `Você atingiu o limite de ${config.rateLimitPerHour} buscas por hora.`,
				retryAfter: limit.retryAfter,
			}),
			{
				status: 429,
				headers: { 'content-type': 'application/json', 'retry-after': String(limit.retryAfter) },
			}
		);
	}

	const user = { id: actor.id, role: actor.role, status: actor.status };

	// Contexto de leitura (§10, §11): o que o cliente mandou no corpo, e o cookie
	// como fallback. Tudo passa pela normalização — audiência é escolha do
	// navegador de quem lê, e chega aqui como dado, nunca como permissão.
	const readerContext = mergeContext(
		normalizeContext(payload.context as Record<string, unknown> | undefined),
		contextFromCookie(cookies.get(CONTEXT_COOKIE)?.value),
		{ role: actor.role }
	);
	const conversation = getOrCreateConversation(conversationId, user);

	// O idioma vem do cliente e é normalizado contra a lista de traduções
	// existentes — nada do que chega aqui vira caminho de arquivo.
	if (typeof payload.locale === 'string') {
		conversation.locale = normalizeLocale(payload.locale);
	}

	try {
		// O modelo entra no pipeline só quando há credencial no ambiente e a
		// redação está ligada. Sem isso, o mesmo pipeline devolve os trechos.
		const model = canGenerate(config)
			? anthropicModel({ apiKey: providerApiKey(), model: config.model, effort: 'low' })
			: undefined;

		// O índice de confiança é lido uma vez e consultado em memória: ele reordena
		// os trechos e decide se a resposta sai com aviso de verificação vencida.
		const trust = await getTrustIndex();

		const assistant = createAssistant({
			model,
			maxExcerpts: config.maxExcerpts,
			minScore: config.minScore,
			excerptChars: config.excerptChars,
			// A autorização acontece **antes** do contexto ir ao modelo. Hoje o
			// portal não tem documentação restrita por papel, então a regra é a
			// mesma para todos; o gancho existe para o dia em que tiver, e para o
			// filtro nunca acontecer depois da geração.
			authorize: (_, candidate) => can(candidate, 'docs.read'),
			readerContext,
			trustFor: (documentPath) => {
				const page = trust.byPath.get(documentPath);
				return page ? { status: page.status, lastVerified: page.lastVerified } : undefined;
			},
			onEvent: async (event) => {
				await recordAudit({
					actorId: event.userId,
					action: 'CHAT_GUARDRAIL',
					metadata: { event: event.event, detail: event.detail ?? null },
				});
			},
		});

		const answer = await assistant.ask(conversation, message, user);

		// Analytics de busca (§7, §8 de Health & SLO). Contadores sempre; o **texto**
		// da pergunta só quando quem opera o portal ligou isso explicitamente, e só
		// para as consultas que ficaram sem resposta. Ver `health/analytics.ts`.
		const health = await loadHealthConfig();
		await recordSearchEvent({
			confidence: answer.confidence,
			empty: answer.empty,
			refused: answer.safety?.filtered === true,
			question: message,
			storeQuestions: health.storeQuestions,
		}).catch(() => {
			// Falha ao registrar métrica não pode derrubar a resposta de quem perguntou.
		});

		// Distribuição por audiência (§13): só contadores, nada que identifique.
		await recordAudienceEvent(readerContext.audience, answer.empty).catch(() => {});

		// Sinal para o Gap Mining. O texto só é gravado quando quem opera o portal
		// ligou isso, e mesmo então apenas quando a consulta **falhou** — pergunta
		// respondida não é lacuna. Ver `gaps/telemetry.ts`.
		// Observabilidade de leitura (P3.2): quantos resultados a consulta devolveu.
		//
		// O evento é gravado com a **sessão do navegador**, não com o id do usuário
		// — a camada de observabilidade não tem onde guardar quem é a pessoa, e é
		// isso que a mantém agregada. Sem sessão no corpo, o evento não é gravado:
		// inventar uma aqui a partir do usuário desfaria a separação.
		const observeSession = sanitizeSession(payload.session);
		if (observeSession) {
			const observeConfig = await loadObservabilityConfig();
			await recordEvent({
				type: 'search',
				session: observeSession,
				at: Math.floor(Date.now() / 60_000) * 60_000,
				results: answer.sources.length,
				...(observeConfig.storeQueryText ? { query: message.slice(0, 120) } : {}),
			}).catch(() => {});
		}

		await recordQuerySignal({
			question: message,
			origin: 'assistant',
			// Falha aqui é "não houve resposta com fundamento": ou nada passou do
			// limiar, ou a confiança ficou baixa. Uma resposta fraca conta como
			// lacuna tanto quanto nenhuma resposta.
			failed: answer.empty || answer.confidence === 'low',
			storeQuestions: health.storeQuestions,
		}).catch(() => {});

		return jsonResponse({ ...answer, remaining: limit.remaining }, 200);
	} catch (error) {
		if (error instanceof ChatError) {
			const status = error.code === 'unauthorized' ? 403 : 400;
			return jsonResponse({ error: error.code, message: error.message }, status);
		}
		console.error('[chat] falha inesperada', error);
		return jsonResponse({ error: 'internal_error', message: 'Não consegui buscar agora.' }, 500);
	}
};
