/**
 * Abstração de provedor de modelo (§58) e adaptadores.
 *
 * O chatbot fala com a interface `ChatModel`; trocar de provedor não toca no
 * pipeline nem nos guardrails. Dois adaptadores acompanham:
 *
 *  - `anthropicModel` — usa o SDK oficial, com a chave do próprio portal.
 *  - `retrievalOnlyModel` — sem chave configurada, devolve os trechos
 *    encontrados com as fontes, sem prosa gerada.
 *
 * O modo só-retrieval não é um stub: ele é o comportamento correto quando não
 * há credencial. Um chatbot de documentação que só sabe dizer "não configurado"
 * é inútil; um que devolve as passagens relevantes com link já responde à
 * maior parte das perguntas.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ChatModel, ChatModelRequest, ChatModelResponse } from './types';

/**
 * Modelos que **rejeitam** `temperature` com 400.
 *
 * A família Claude 5 e Opus 4.7+ removeram os parâmetros de amostragem: enviar
 * `temperature` derruba a requisição. Como a tela de administração expõe o
 * campo (§68), o adaptador precisa decidir se ele vai no corpo — a alternativa
 * seria um erro em produção na primeira mensagem.
 */
const NO_SAMPLING_PARAMS = /^claude-(?:fable-5|mythos-5|opus-5|opus-4-(?:7|8)|sonnet-5)/;

export function acceptsTemperature(model: string): boolean {
	return !NO_SAMPLING_PARAMS.test(model);
}

export interface AnthropicModelOptions {
	apiKey: string;
	model: string;
	temperature?: number;
	/**
	 * Profundidade de raciocínio. Para perguntas sobre documentação, `low`
	 * responde bem e mantém a latência de uma conversa — o gargalo aqui é o
	 * retrieval, não o raciocínio.
	 */
	effort?: 'low' | 'medium' | 'high';
}

export function anthropicModel(options: AnthropicModelOptions): ChatModel {
	const configured = options.apiKey.trim() !== '';
	const client = configured ? new Anthropic({ apiKey: options.apiKey }) : null;

	return {
		name: options.model,

		isConfigured: () => configured,

		async generate(request: ChatModelRequest): Promise<ChatModelResponse> {
			if (!client) throw new Error('Modelo sem credencial configurada.');

			const body: Record<string, unknown> = {
				model: options.model,
				max_tokens: request.maxOutputTokens,
				system: request.systemPrompt,
				messages: request.messages.map((message) => ({
					role: message.role,
					content: message.content,
				})),
				output_config: { effort: options.effort ?? 'low' },
			};

			// Só envia amostragem para quem aceita (ver NO_SAMPLING_PARAMS).
			if (acceptsTemperature(options.model) && options.temperature !== undefined) {
				body.temperature = options.temperature;
			}

			const response = await client.messages.create(body as never);

			// A verificação de `refusal` vem **antes** de ler o conteúdo: numa
			// recusa o array pode estar vazio, e indexar `content[0]` quebraria.
			// É também uma camada de segurança a mais — o próprio modelo declina
			// pedidos que seus classificadores barram.
			if (response.stop_reason === 'refusal') {
				return {
					text: 'Não posso responder a esse pedido.',
					model: response.model,
					usage: {
						inputTokens: response.usage?.input_tokens ?? 0,
						outputTokens: response.usage?.output_tokens ?? 0,
					},
				};
			}

			// Blocos de raciocínio (`thinking`) também vêm no array e não têm
			// `text`; só os de texto entram na resposta.
			const text = response.content
				.filter((block) => block.type === 'text')
				.map((block) => block.text)
				.join('\n')
				.trim();

			return {
				text,
				model: response.model,
				usage: {
					inputTokens: response.usage?.input_tokens ?? 0,
					outputTokens: response.usage?.output_tokens ?? 0,
				},
			};
		},
	};
}

/**
 * Modo só-retrieval.
 *
 * Nunca "gera" nada: monta a resposta a partir dos próprios trechos, que já
 * vêm higienizados. Isso o torna imune por construção a alucinação e a injeção
 * indireta — não há modelo para manipular.
 */
export function retrievalOnlyModel(): ChatModel {
	return {
		name: 'retrieval-only',
		isConfigured: () => true,
		async generate(): Promise<ChatModelResponse> {
			// O serviço monta o texto neste modo; o adaptador existe para o
			// pipeline ter sempre um `ChatModel` e nunca precisar de um ramo
			// especial "sem modelo".
			return { text: '', model: 'retrieval-only' };
		},
	};
}
