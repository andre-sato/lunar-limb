/**
 * Configuração do assistente de documentação.
 *
 * A credencial do modelo **não mora aqui**. Ela vem do ambiente
 * (`ANTHROPIC_API_KEY`), pelo mesmo motivo do Algolia e do GitHub: um segredo
 * gravado em arquivo de configuração acaba num backup, num log ou numa resposta
 * de API. O que este arquivo guarda é o que pode ser lido por quem administra —
 * modelo escolhido, limites, se está ligado.
 *
 * Sem credencial no ambiente, o assistente responde com os trechos da
 * documentação. Não é modo degradado: é a configuração padrão do portal, e a
 * única que não pode inventar nada.
 */

import { readJson, withFileLock, writeJson } from '../auth/store';

const FILE = 'integrations.json';

export interface ChatConfig {
	/** `false` esconde a busca conversacional do portal. */
	enabled: boolean;
	/** Trechos devolvidos por consulta. */
	maxExcerpts: number;
	/** Relevância mínima, 0–1. Abaixo disso a consulta não devolve nada. */
	minScore: number;
	/** Caracteres por trecho exibido. */
	excerptChars: number;
	/** Consultas por usuário por hora. */
	rateLimitPerHour: number;
	/**
	 * Modelo usado quando há credencial no ambiente. Sem credencial, o campo
	 * fica guardado e sem efeito — trocar de modelo não liga o assistente.
	 */
	model: string;
	/** `false` mantém a busca e desliga a redação, mesmo com credencial. */
	generation: boolean;
}

export const DEFAULT_CHAT_CONFIG: ChatConfig = {
	enabled: true,
	maxExcerpts: 5,
	minScore: 0.2,
	excerptChars: 700,
	rateLimitPerHour: 120,
	model: 'claude-opus-5',
	generation: true,
};

interface IntegrationsFile {
	chat?: Partial<ChatConfig>;
	[key: string]: unknown;
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, value));
}

function coerce(raw: Partial<ChatConfig> | undefined): ChatConfig {
	const base = { ...DEFAULT_CHAT_CONFIG, ...(raw ?? {}) };

	return {
		enabled: base.enabled !== false,
		maxExcerpts: Math.round(clamp(base.maxExcerpts, 1, 20, DEFAULT_CHAT_CONFIG.maxExcerpts)),
		minScore: clamp(base.minScore, 0, 1, DEFAULT_CHAT_CONFIG.minScore),
		excerptChars: Math.round(clamp(base.excerptChars, 200, 4000, DEFAULT_CHAT_CONFIG.excerptChars)),
		rateLimitPerHour: Math.round(
			clamp(base.rateLimitPerHour, 1, 5000, DEFAULT_CHAT_CONFIG.rateLimitPerHour)
		),
		model: typeof base.model === 'string' && base.model.trim() !== '' ? base.model.trim() : DEFAULT_CHAT_CONFIG.model,
		generation: base.generation !== false,
	};
}

export async function loadChatConfig(): Promise<ChatConfig> {
	const file = await readJson<IntegrationsFile>(FILE, {});
	return coerce(file.chat);
}

export async function saveChatConfig(patch: Partial<ChatConfig>): Promise<ChatConfig> {
	return withFileLock(FILE, async () => {
		const file = await readJson<IntegrationsFile>(FILE, {});
		const next = coerce({ ...coerce(file.chat), ...patch });
		await writeJson(FILE, { ...file, chat: next });
		return next;
	});
}

/**
 * A credencial do provedor, lida do ambiente.
 *
 * Exportada como função e não como constante para o valor ser lido no momento
 * do uso: um servidor que ganha a variável sem reiniciar passa a redigir.
 */
export function providerApiKey(): string {
	return (process.env.ANTHROPIC_API_KEY ?? '').trim();
}

/** `true` quando o assistente pode redigir: credencial no ambiente e geração ligada. */
export function canGenerate(config: ChatConfig): boolean {
	return config.generation && providerApiKey() !== '';
}
