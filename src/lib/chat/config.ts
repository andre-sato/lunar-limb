/**
 * Configuração da busca na documentação.
 *
 * Sem provedor, sem modelo, sem chave de API — e por isso sem nada a esconder:
 * toda a configuração pode ser devolvida à tela de administração como está.
 * Enquanto havia um modelo, este arquivo carregava uma credencial e o cuidado
 * inteiro de nunca deixá-la sair por uma rota; a simplificação apagou essa
 * classe de risco em vez de mitigá-la.
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
}

export const DEFAULT_CHAT_CONFIG: ChatConfig = {
	enabled: true,
	maxExcerpts: 5,
	minScore: 0.2,
	excerptChars: 700,
	rateLimitPerHour: 120,
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
