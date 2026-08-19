/**
 * Histórico de healing (P3.6 — §17).
 *
 * Em `data/`, que é gitignored. O histórico registra o que foi detectado, o
 * diagnóstico, a proposta, as validações, quem revisou e o resultado — é o que
 * permite responder "por que esta página mudou" meses depois.
 */

import { readJson, withFileLock, writeJson } from '../auth/store';
import type { HealingRecord } from './types';

const FILE = 'healing.json';
const MAX_RECORDS = 300;

interface HealingFile {
	records: HealingRecord[];
}

export async function listRecords(): Promise<HealingRecord[]> {
	return (await readJson<HealingFile>(FILE, { records: [] })).records;
}

export async function readRecord(issueId: string): Promise<HealingRecord | undefined> {
	return (await listRecords()).find((record) => record.issueId === issueId);
}

/**
 * Grava um registro, substituindo o anterior do mesmo problema.
 *
 * A linha do tempo é acumulada pelo chamador, não aqui: quem sabe o que
 * aconteceu é quem executou a etapa, e reconstruir isso no armazenamento
 * inventaria eventos.
 */
export async function appendRecord(record: HealingRecord): Promise<void> {
	await withFileLock(FILE, async () => {
		const file = await readJson<HealingFile>(FILE, { records: [] });
		const others = file.records.filter((entry) => entry.issueId !== record.issueId);

		await writeJson(FILE, { records: [...others, record].slice(-MAX_RECORDS) } satisfies HealingFile);
	});
}

export async function forgetHealing(): Promise<void> {
	await withFileLock(FILE, async () => {
		await writeJson(FILE, { records: [] } satisfies HealingFile);
	});
}
