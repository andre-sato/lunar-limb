/**
 * Leitura dos conjuntos de avaliação (P3.3 — § Evaluation datasets).
 *
 * Arquivos YAML em `evals/`, versionados pelo Git. Um conjunto de avaliação é um
 * acordo sobre o que o assistente precisa acertar — e acordo que vive só no
 * banco de alguém não sobrevive à troca de time, nem aparece em revisão de
 * pull request.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import type { DatasetKind, EvaluationCase } from './types';

const EVALS_ROOT = path.resolve(process.cwd(), 'evals');
const KINDS: readonly DatasetKind[] = ['golden', 'regression', 'adversarial', 'real'];

function asStrings(value: unknown): string[] {
	if (typeof value === 'string') return [value];
	if (!Array.isArray(value)) return [];
	return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '').map((entry) => entry.trim());
}

interface RawCase {
	id?: unknown;
	question?: unknown;
	expected?: { mustContain?: unknown; mustNotContain?: unknown };
	mustContain?: unknown;
	mustNotContain?: unknown;
	sources?: unknown;
	minimumScore?: unknown;
	expectRefusal?: unknown;
}

interface RawDataset {
	dataset?: unknown;
	kind?: unknown;
	cases?: unknown;
	/** Um arquivo com um caso só, como a spec escreve. */
	question?: unknown;
}

export function parseDataset(fileName: string, raw: string): EvaluationCase[] {
	let parsed: RawDataset | null | undefined;
	try {
		parsed = yaml.load(raw) as RawDataset;
	} catch {
		return [];
	}
	if (!parsed) return [];

	const dataset = typeof parsed.dataset === 'string' ? parsed.dataset : fileName.replace(/\.ya?ml$/, '');
	const kind = KINDS.includes(parsed.kind as DatasetKind) ? (parsed.kind as DatasetKind) : inferKind(dataset);

	// A spec escreve um caso solto no arquivo; a forma com `cases:` é a que
	// escala. Aceitar só uma delas faria o exemplo da própria spec não rodar.
	const rawCases = Array.isArray(parsed.cases) ? parsed.cases : parsed.question !== undefined ? [parsed] : [];

	const cases: EvaluationCase[] = [];

	rawCases.forEach((entry, index) => {
		const record = (entry ?? {}) as RawCase;
		const question = typeof record.question === 'string' ? record.question.trim() : '';
		if (question === '') return;

		const expected = record.expected ?? {};

		cases.push({
			id: typeof record.id === 'string' && record.id.trim() !== '' ? record.id.trim() : `${dataset}:${index + 1}`,
			dataset,
			kind,
			question,
			mustContain: asStrings(expected.mustContain ?? record.mustContain),
			mustNotContain: asStrings(expected.mustNotContain ?? record.mustNotContain),
			sources: asStrings(record.sources),
			minimumScore:
				typeof record.minimumScore === 'number' && Number.isFinite(record.minimumScore)
					? Math.max(0, Math.min(10, record.minimumScore))
					: 7,
			expectRefusal: record.expectRefusal === true,
		});
	});

	return cases;
}

function inferKind(dataset: string): DatasetKind {
	const name = dataset.toLowerCase();
	if (name.includes('advers')) return 'adversarial';
	if (name.includes('regress')) return 'regression';
	if (name.includes('real')) return 'real';
	return 'golden';
}

export async function loadDatasets(filter?: string): Promise<EvaluationCase[]> {
	let entries: string[];
	try {
		entries = (await readdir(EVALS_ROOT)).filter((name) => /\.ya?ml$/.test(name));
	} catch {
		return [];
	}

	const cases: EvaluationCase[] = [];

	for (const name of entries) {
		const raw = await readFile(path.join(EVALS_ROOT, name), 'utf-8').catch(() => '');
		if (raw === '') continue;
		cases.push(...parseDataset(name, raw));
	}

	if (!filter) return cases;
	return cases.filter((entry) => entry.dataset === filter || entry.kind === filter);
}
