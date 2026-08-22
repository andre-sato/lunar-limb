/**
 * Leitura da governança declarada numa página (P3.1).
 *
 * Duas formas convivem de propósito. A longa é a que a spec escreve:
 *
 *     governance:
 *       owner:
 *         type: team
 *         id: payments
 *       review:
 *         interval: 90d
 *
 * A curta é a que já existe no portal desde antes desta camada — `owner: Time de
 * Documentação` como texto solto no frontmatter. Recusá-la transformaria dezenas
 * de páginas em "sem dono" no dia em que a governança entrasse, o que seria um
 * relatório falso sobre um portal que não mudou.
 */

import yaml from 'js-yaml';
import type { GovernanceActor, PageGovernance, ReviewState } from './types';

const STATES: readonly ReviewState[] = ['draft', 'in-review', 'approved', 'published', 'review-required'];

function frontmatterOf(raw: string): string | null {
	const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	return match ? match[1] : null;
}

/** `type: team` + `id: payments`, ou simplesmente uma string. */
export function parseActor(value: unknown, fallbackType: 'team' | 'user' = 'team'): GovernanceActor | undefined {
	if (typeof value === 'string' && value.trim() !== '') {
		const text = value.trim();
		// `@fulano` é pessoa; o resto é time. É convenção, e a alternativa seria
		// obrigar todo mundo a escrever a forma longa para dizer o óbvio.
		return text.startsWith('@')
			? { type: 'user', id: text.slice(1) }
			: { type: fallbackType, id: text };
	}

	if (!value || typeof value !== 'object') return undefined;

	const record = value as Record<string, unknown>;
	const id = record.id ?? record.name;
	if (typeof id !== 'string' || id.trim() === '') return undefined;

	const type = record.type === 'user' ? 'user' : 'team';
	return { type, id: id.trim() };
}

/** `90d`, `12w`, `6m`, ou um número puro de dias. */
export function parseInterval(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.round(value);
	if (typeof value !== 'string') return undefined;

	const match = value.trim().match(/^(\d+)\s*([dwmy])?$/i);
	if (!match) return undefined;

	const amount = Number(match[1]);
	if (amount <= 0) return undefined;

	switch ((match[2] ?? 'd').toLowerCase()) {
		case 'w':
			return amount * 7;
		case 'm':
			return amount * 30;
		case 'y':
			return amount * 365;
		default:
			return amount;
	}
}

interface RawGovernance {
	owner?: unknown;
	reviewer?: unknown;
	approver?: unknown;
	review?: { interval?: unknown; state?: unknown; at?: unknown; by?: unknown };
	state?: unknown;
	reviewedAt?: unknown;
	reviewedBy?: unknown;
}

export function parseGovernance(path: string, raw: string): PageGovernance {
	const body = frontmatterOf(raw);
	if (!body) return { path, inherited: {} };

	let parsed: Record<string, unknown> | null | undefined;
	try {
		parsed = yaml.load(body) as Record<string, unknown>;
	} catch {
		// Frontmatter ilegível: a página continua publicável, só fica sem governança
		// declarada. Derrubar a leitura inteira trocaria um defeito pequeno por um
		// grande.
		return { path, inherited: {} };
	}

	return governanceFromFrontmatter(path, parsed);
}

/**
 * A mesma leitura, a partir do frontmatter **já interpretado**.
 *
 * Existe para quem chega com o objeto na mão em vez do arquivo cru — o gerador
 * de OKF (issue #16) é o primeiro caso. A alternativa seria ele re-serializar o
 * frontmatter só para esta função tornar a interpretá-lo, e aí duas leituras de
 * governança conviveriam no repositório esperando para divergir.
 */
export function governanceFromFrontmatter(
	path: string,
	parsed: Record<string, unknown> | null | undefined
): PageGovernance {
	const page: PageGovernance = { path, inherited: {} };
	if (!parsed) return page;

	const block = (parsed.governance ?? {}) as RawGovernance;

	page.owner = parseActor(block.owner) ?? parseActor(parsed.owner);
	page.reviewer = parseActor(block.reviewer);
	page.approver = parseActor(block.approver);
	page.reviewIntervalDays = parseInterval(block.review?.interval);

	const state = block.review?.state ?? block.state;
	if (typeof state === 'string' && STATES.includes(state as ReviewState)) page.state = state as ReviewState;

	const reviewedAt = block.review?.at ?? block.reviewedAt ?? parsed.lastReviewed;
	if (typeof reviewedAt === 'string' && !Number.isNaN(Date.parse(reviewedAt))) page.reviewedAt = reviewedAt;
	if (reviewedAt instanceof Date) page.reviewedAt = reviewedAt.toISOString();

	const reviewedBy = block.review?.by ?? block.reviewedBy;
	if (typeof reviewedBy === 'string' && reviewedBy.trim() !== '') page.reviewedBy = reviewedBy.trim();

	return page;
}
