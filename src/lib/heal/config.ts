/**
 * Leitura do `selfhealing.yml` (P3.6 — §12, §15, §26).
 *
 * Um valor fora do intervalo é **corrigido para o limite**, não aceito: uma
 * configuração com `autonomy: 9` não deve virar autonomia irrestrita por
 * distração de quem digitou.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import {
	DEFAULT_AUTHORITY,
	DEFAULT_HEALING_POLICY,
	type AutonomyLevel,
	type Risk,
	type SelfHealingPolicy,
	type SourceKind,
} from './types';

const CONFIG_FILE = path.resolve(process.cwd(), 'selfhealing.yml');
const RISKS: readonly Risk[] = ['low', 'medium', 'high', 'critical'];

export async function loadHealingPolicy(): Promise<SelfHealingPolicy> {
	let parsed: Record<string, unknown> | null | undefined;

	try {
		parsed = yaml.load(await readFile(CONFIG_FILE, 'utf-8')) as Record<string, unknown>;
	} catch {
		return DEFAULT_HEALING_POLICY;
	}

	const block = (parsed?.selfHealing ?? parsed ?? {}) as Record<string, unknown>;

	const autonomy: AutonomyLevel =
		typeof block.autonomy === 'number' && block.autonomy >= 0 && block.autonomy <= 4
			? (Math.round(block.autonomy) as AutonomyLevel)
			: DEFAULT_HEALING_POLICY.autonomy;

	const byRisk = { ...DEFAULT_HEALING_POLICY.byRisk };
	for (const risk of RISKS) {
		const entry = block[risk] as { autoCreatePR?: unknown; requireApproval?: unknown } | undefined;
		if (!entry || typeof entry !== 'object') continue;

		byRisk[risk] = {
			autoCreatePR: entry.autoCreatePR === true,
			// Aprovação só é dispensada quando o arquivo diz `false` explicitamente.
			// Chave ausente mantém a exigência: o padrão seguro nunca vem de omissão.
			requireApproval: entry.requireApproval !== false,
		};
	}

	const failure = (block.onFailure ?? {}) as { action?: unknown };
	const authority = ((block.authority ?? {}) as { order?: unknown }).order;

	return {
		autonomy,
		byRisk,
		maxAttempts:
			typeof block.maxAttempts === 'number' && block.maxAttempts > 0
				? Math.min(Math.round(block.maxAttempts), 5)
				: DEFAULT_HEALING_POLICY.maxAttempts,
		onFailure: failure.action === 'ignore' ? 'ignore' : 'create-gap',
		authority: Array.isArray(authority)
			? (authority.filter((entry): entry is SourceKind => DEFAULT_AUTHORITY.includes(entry as SourceKind)) as SourceKind[])
			: DEFAULT_HEALING_POLICY.authority,
		minimumConfidence:
			typeof block.minimumConfidence === 'number' && block.minimumConfidence >= 0 && block.minimumConfidence <= 1
				? block.minimumConfidence
				: DEFAULT_HEALING_POLICY.minimumConfidence,
	};
}
