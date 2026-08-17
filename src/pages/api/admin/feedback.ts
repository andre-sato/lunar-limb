import type { APIRoute } from 'astro';
import { aggregateFeedback, listFeedback } from '../../../lib/feedback/store';
import { jsonResponse, requireAuthUser } from '../../../lib/auth/api';

export const prerender = false;

const RANGES: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90, all: 0 };

export const GET: APIRoute = async ({ url, locals }) => {
	const actor = requireAuthUser(locals);
	if (!actor) return jsonResponse({ error: 'unauthorized' }, 401);

	const rangeKey = url.searchParams.get('range') ?? '30d';
	const days = RANGES[rangeKey] ?? RANGES['30d'];
	const since = days > 0 ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : undefined;

	const entries = await listFeedback();
	return jsonResponse({ range: rangeKey, summary: aggregateFeedback(entries, since) }, 200);
};
