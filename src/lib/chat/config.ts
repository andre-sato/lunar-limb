/**
 * Configuração do chatbot (§67–§71).
 *
 * A chave da API fica em `data/integrations.json` (fora do Git) e **nunca** é
 * devolvida por rota alguma — a tela recebe apenas `hasApiKey` e uma dica
 * mascarada, mesmo pedido por um admin autenticado. É o mesmo contrato do
 * Do11y, pela mesma razão: uma chave que aparece numa resposta HTTP aparece no
 * cache do navegador, no log do proxy e na aba de rede.
 *
 * Sem chave o portal não fica sem chatbot: ele opera em modo só-retrieval.
 */

import { readJson, withFileLock, writeJson } from '../auth/store';

const FILE = 'integrations.json';

export interface ChatConfig {
	enabled: boolean;
	/** Provedor. Hoje só `anthropic`; o campo existe para o §58 não mentir. */
	provider: 'anthropic';
	apiKey: string;
	model: string;
	maxOutputTokens: number;
	/** Profundidade de raciocínio do modelo. */
	effort: 'low' | 'medium' | 'high';
	/** Score mínimo de relevância para um fragmento entrar no contexto (§40). */
	retrievalThreshold: number;
	maxChunks: number;
	/** Mensagens por usuário por hora (§55). */
	rateLimitPerHour: number;
	/** Quando `false`, o chat responde só com os trechos encontrados. */
	generationEnabled: boolean;
}

export const DEFAULT_CHAT_CONFIG: ChatConfig = {
	enabled: true,
	provider: 'anthropic',
	apiKey: '',
	model: 'claude-opus-5',
	maxOutputTokens: 2048,
	effort: 'low',
	retrievalThreshold: 0.25,
	maxChunks: 6,
	rateLimitPerHour: 60,
	generationEnabled: true,
};

interface IntegrationsFile {
	chat?: Partial<ChatConfig>;
	[key: string]: unknown;
}

const MODELS_WITHOUT_SAMPLING = new Set(['claude-opus-5', 'claude-sonnet-5', 'claude-fable-5']);

/** Modelos oferecidos na tela. Lista curta e explícita, não texto livre. */
export const AVAILABLE_MODELS = [
	{ id: 'claude-opus-5', label: 'Claude Opus 5 — mais capaz' },
	{ id: 'claude-sonnet-5', label: 'Claude Sonnet 5 — equilibrado' },
	{ id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — mais rápido e barato' },
] as const;

function coerce(raw: Partial<ChatConfig> | undefined): ChatConfig {
	const base = { ...DEFAULT_CHAT_CONFIG, ...(raw ?? {}) };

	return {
		enabled: base.enabled !== false,
		provider: 'anthropic',
		apiKey: typeof base.apiKey === 'string' ? base.apiKey : '',
		model: AVAILABLE_MODELS.some((entry) => entry.id === base.model)
			? base.model
			: DEFAULT_CHAT_CONFIG.model,
		maxOutputTokens: clamp(base.maxOutputTokens, 256, 8192, DEFAULT_CHAT_CONFIG.maxOutputTokens),
		effort: base.effort === 'medium' || base.effort === 'high' ? base.effort : 'low',
		retrievalThreshold: clamp(base.retrievalThreshold, 0, 1, DEFAULT_CHAT_CONFIG.retrievalThreshold),
		maxChunks: Math.round(clamp(base.maxChunks, 1, 20, DEFAULT_CHAT_CONFIG.maxChunks)),
		rateLimitPerHour: Math.round(
			clamp(base.rateLimitPerHour, 1, 1000, DEFAULT_CHAT_CONFIG.rateLimitPerHour)
		),
		generationEnabled: base.generationEnabled !== false,
	};
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, value));
}

export async function loadChatConfig(): Promise<ChatConfig> {
	const file = await readJson<IntegrationsFile>(FILE, {});
	const config = coerce(file.chat);

	// Ambiente tem precedência: provisionar um deploy não deve exigir que
	// alguém abra a tela depois.
	if (process.env.ANTHROPIC_API_KEY) config.apiKey = process.env.ANTHROPIC_API_KEY;
	if (process.env.CHAT_MODEL) config.model = process.env.CHAT_MODEL;

	return config;
}

export async function saveChatConfig(patch: Partial<ChatConfig>): Promise<ChatConfig> {
	return withFileLock(FILE, async () => {
		const file = await readJson<IntegrationsFile>(FILE, {});
		const current = coerce(file.chat);
		const next = coerce({ ...current, ...patch });
		await writeJson(FILE, { ...file, chat: next });
		return next;
	});
}

export interface ChatConfigAdminView extends Omit<ChatConfig, 'apiKey'> {
	hasApiKey: boolean;
	/** Dica para o admin reconhecer a chave, nunca usá-la: `••••ab12`. */
	apiKeyHint: string;
	/** `true` se o modelo escolhido rejeita `temperature`. */
	samplingUnavailable: boolean;
	/** `true` quando o chat responderá só com trechos. */
	retrievalOnly: boolean;
}

export function toAdminView(config: ChatConfig): ChatConfigAdminView {
	const { apiKey, ...rest } = config;
	return {
		...rest,
		hasApiKey: apiKey !== '',
		apiKeyHint: apiKey === '' ? '' : `••••${apiKey.slice(-4)}`,
		samplingUnavailable: MODELS_WITHOUT_SAMPLING.has(config.model),
		retrievalOnly: apiKey === '' || !config.generationEnabled,
	};
}

export function validateChatConfig(config: ChatConfig): { ok: boolean; errors: string[] } {
	const errors: string[] = [];

	if (config.apiKey !== '' && !/^sk-[\w-]{10,}$/.test(config.apiKey)) {
		errors.push('A chave da API não tem o formato esperado (`sk-…`).');
	}
	if (!AVAILABLE_MODELS.some((entry) => entry.id === config.model)) {
		errors.push('Modelo desconhecido.');
	}

	return { ok: errors.length === 0, errors };
}
