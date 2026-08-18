/**
 * Telemetria de busca, assistente e MCP (§6, §7, §8, §27).
 *
 * A §27 pede minimização, e este projeto já tinha decidido antes: o arquivo de
 * qualidade do chatbot guarda contadores e votos, "nenhuma pergunta, nenhuma
 * resposta". O Gap Mining precisa do **texto** para agrupar dúvidas semelhantes —
 * é a matéria-prima da camada.
 *
 * A resolução mantém a decisão anterior e a torna explícita:
 *
 *  - O registro de texto continua atrás de `storeUnansweredQuestions` em
 *    `health.yml`, desligado por padrão.
 *  - Ligado, só entra pergunta que **não** foi respondida com fundamento. Pergunta
 *    respondida não é lacuna, e guardá-la seria só coletar.
 *  - Nada identifica quem perguntou: sem usuário, sem sessão, sem IP.
 *  - Credenciais são redigidas antes de gravar, e o texto é truncado.
 *  - Há um botão para apagar tudo, mantendo os contadores.
 *
 * Desligado, a camada continua funcionando com os sinais que não exigem texto —
 * endpoint sem página, contrato quebrado, voto negativo, proveniência inválida —
 * e o relatório diz que está trabalhando com menos.
 */

import { readJson, withFileLock, writeJson } from '../auth/store';
import { redactSecrets } from '../chat/sanitize';

const FILE = 'gap-telemetry.json';
const MAX_ENTRIES = 800;
const MAX_CHARS = 160;

export type SignalOrigin = 'search' | 'assistant' | 'mcp';

export interface QuerySignal {
	/** Texto normalizado. */
	question: string;
	origin: SignalOrigin;
	count: number;
	/** Quantas vezes terminou sem resposta com fundamento. */
	failures: number;
	firstSeen: string;
	lastSeen: string;
}

interface TelemetryFile {
	signals: QuerySignal[];
	/** Contadores por origem, mantidos mesmo quando o texto não é guardado. */
	counters: Record<SignalOrigin, { queries: number; failures: number }>;
}

const EMPTY: TelemetryFile = {
	signals: [],
	counters: { search: { queries: 0, failures: 0 }, assistant: { queries: 0, failures: 0 }, mcp: { queries: 0, failures: 0 } },
};

export function normalizeQuestion(text: string): string {
	return redactSecrets(text)
		.text.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^\p{L}\p{N}\s?]/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, MAX_CHARS);
}

export interface RecordSignalInput {
	question: string;
	origin: SignalOrigin;
	/** `true` quando a consulta não produziu resposta com fundamento. */
	failed: boolean;
	/** Vem da configuração. Sem ele, nenhum texto é gravado. */
	storeQuestions: boolean;
}

export async function recordQuerySignal(input: RecordSignalInput): Promise<void> {
	await withFileLock(FILE, async () => {
		const file = await readJson<TelemetryFile>(FILE, EMPTY);
		const counters = { ...EMPTY.counters, ...file.counters };
		const signals = Array.isArray(file.signals) ? file.signals : [];

		const counter = counters[input.origin] ?? { queries: 0, failures: 0 };
		counter.queries++;
		if (input.failed) counter.failures++;
		counters[input.origin] = counter;

		// O texto entra só quando o registro está ligado **e** a consulta falhou.
		if (input.storeQuestions && input.failed) {
			const question = normalizeQuestion(input.question);
			if (question.length >= 8) {
				const timestamp = new Date().toISOString();
				const existing = signals.find((signal) => signal.question === question && signal.origin === input.origin);

				if (existing) {
					existing.count++;
					existing.failures++;
					existing.lastSeen = timestamp;
				} else {
					signals.push({
						question,
						origin: input.origin,
						count: 1,
						failures: 1,
						firstSeen: timestamp,
						lastSeen: timestamp,
					});
				}
			}
		}

		// Teto por frequência: descartar por antiguidade jogaria fora a dúvida que
		// se repete desde o começo, que é justamente a que importa.
		const trimmed = [...signals].sort((a, b) => b.count - a.count).slice(0, MAX_ENTRIES);

		await writeJson(FILE, { signals: trimmed, counters });
	});
}

export interface TelemetrySnapshot {
	signals: QuerySignal[];
	counters: TelemetryFile['counters'];
	/** `true` quando não há texto guardado — a análise trabalha com menos. */
	limited: boolean;
}

export async function readTelemetry(): Promise<TelemetrySnapshot> {
	const file = await readJson<TelemetryFile>(FILE, EMPTY);
	const signals = Array.isArray(file.signals) ? file.signals : [];

	return {
		signals,
		counters: { ...EMPTY.counters, ...file.counters },
		limited: signals.length === 0,
	};
}

/** Apaga o texto guardado, preservando os contadores. */
export async function forgetSignals(): Promise<void> {
	await withFileLock(FILE, async () => {
		const file = await readJson<TelemetryFile>(FILE, EMPTY);
		await writeJson(FILE, { signals: [], counters: { ...EMPTY.counters, ...file.counters } });
	});
}
