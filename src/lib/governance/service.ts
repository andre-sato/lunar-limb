/**
 * `GovernanceService` (P3.1 — § CLI, § Governance dashboard).
 *
 * A parte que toca disco. Ela lê as páginas, aplica as regras do
 * `governance.yml`, cruza com os vínculos do Documentation-to-Code Loop para
 * saber o que é API pública, e chama as funções puras de `review.ts`.
 *
 * Ela **não escreve nada**. Marcar uma página como revisada é uma afirmação de
 * uma pessoa e vive no frontmatter, versionado pelo Git — um registro paralelo
 * em `data/` divergiria do arquivo no primeiro `git checkout`.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { applyRules, isSecuritySensitive, loadGovernanceConfig } from './config';
import { parseGovernance } from './parse';
import { approvalRequirement, computeCompliance, reviewStatus } from './review';
import type { ApprovalRequirement, ComplianceReport, GovernanceConfig, PageGovernance, ReviewStatus } from './types';
import { documentationImpact } from '../codeloop/service';

const DOCS_ROOT = path.resolve(process.cwd(), 'src/content/docs');

async function walk(dir: string, base = ''): Promise<string[]> {
	const found: string[] = [];
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return found;
	}
	for (const entry of entries) {
		const relative = base ? `${base}/${entry.name}` : entry.name;
		if (entry.isDirectory()) found.push(...(await walk(path.join(dir, entry.name), relative)));
		else if (/\.mdx?$/.test(entry.name)) found.push(relative);
	}
	return found;
}

export interface GovernanceSnapshot {
	config: GovernanceConfig;
	pages: PageGovernance[];
	statuses: ReviewStatus[];
	approvals: ApprovalRequirement[];
	compliance: ComplianceReport;
	generatedAt: number;
}

export async function collectGovernance(options: { now?: number } = {}): Promise<GovernanceSnapshot> {
	const config = await loadGovernanceConfig();
	const files = await walk(DOCS_ROOT);

	// Páginas que documentam endpoint público, segundo os vínculos declarados. É
	// a mesma fonte que o Code Loop usa — deduzir de novo aqui criaria uma segunda
	// resposta para a mesma pergunta.
	const bindings = await documentationImpact.getBindings().catch(() => []);
	const publicApiPages = new Set(
		bindings.filter((binding) => binding.entityType === 'api' && binding.resolved).map((binding) => binding.documentationId)
	);

	const pages: PageGovernance[] = [];

	for (const relative of files) {
		const raw = await readFile(path.join(DOCS_ROOT, relative), 'utf-8').catch(() => '');
		pages.push(applyRules(parseGovernance(relative, raw), config));
	}

	const statuses = pages.map((page) =>
		reviewStatus({ page, config, intervalDays: page.reviewIntervalDays, now: options.now })
	);

	const approvals = pages
		.map((page) =>
			approvalRequirement({
				page,
				config,
				documentsPublicApi: publicApiPages.has(page.path),
				securitySensitive: isSecuritySensitive(page.path, config),
			})
		)
		.filter((entry): entry is ApprovalRequirement => entry !== null);

	return {
		config,
		pages,
		statuses,
		approvals,
		compliance: computeCompliance({ pages, statuses, approvals }),
		generatedAt: options.now ?? Date.now(),
	};
}

export interface GovernanceService {
	status(): Promise<GovernanceSnapshot>;
	owners(): Promise<Array<{ owner: string; label: string; pages: string[] }>>;
	overdue(): Promise<ReviewStatus[]>;
	forPage(pagePath: string): Promise<{ page: PageGovernance; status: ReviewStatus; approval: ApprovalRequirement | null } | null>;
}

export const governance: GovernanceService = {
	status: collectGovernance,

	async owners() {
		const snapshot = await collectGovernance();
		const byOwner = new Map<string, { label: string; pages: string[] }>();

		for (const page of snapshot.pages) {
			// Páginas sem dono ficam num balde explícito em vez de sumirem: a lista de
			// donos que esconde os órfãos é a que faz a cobertura parecer 100%.
			const key = page.owner ? `${page.owner.type}:${page.owner.id}` : 'sem dono';
			const label = page.owner?.label ?? page.owner?.id ?? 'Sem dono declarado';

			const entry = byOwner.get(key) ?? { label, pages: [] };
			entry.pages.push(page.path);
			byOwner.set(key, entry);
		}

		return [...byOwner.entries()]
			.map(([owner, entry]) => ({ owner, label: entry.label, pages: entry.pages.sort() }))
			.sort((a, b) => b.pages.length - a.pages.length);
	},

	/**
	 * Tudo que está pendente de revisão: o que venceu e o que nunca começou.
	 *
	 * As duas situações vêm na mesma lista porque a equipe age nas duas, mas cada
	 * item diz qual é a sua — e a contagem do painel as separa.
	 */
	async overdue() {
		const snapshot = await collectGovernance();
		return snapshot.statuses
			.filter((status) => status.expired || (status.neverReviewed && status.underRegime))
			.sort((a, b) => (a.daysUntilDue ?? 0) - (b.daysUntilDue ?? 0));
	},

	async forPage(pagePath) {
		const snapshot = await collectGovernance();
		const page = snapshot.pages.find((entry) => entry.path === pagePath);
		if (!page) return null;

		return {
			page,
			status: snapshot.statuses.find((entry) => entry.path === pagePath)!,
			approval: snapshot.approvals.find((entry) => entry.path === pagePath) ?? null,
		};
	},
};
