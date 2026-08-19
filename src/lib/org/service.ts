/**
 * `OrganizationService` (P3.5 — § CLI, § Organization dashboard).
 *
 * Agrega o que dá para agregar sem mentir. O repositório onde o portal roda é
 * lido por inteiro — saúde, lacunas, governança; os vizinhos, pelos arquivos.
 * O relatório declara qual leitura cada um recebeu, porque exibir "94" ao lado
 * de "—" e chamar as duas colunas de saúde faria a segunda parecer um zero.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { loadOrganization, visibleRepositories } from './config';
import { resolveRepositoryPath, scanRepository } from './scan';
import { documentationHealth } from '../health/service';
import { analyzeDocumentationGaps } from '../gaps/service';
import { collectGovernance } from '../governance/service';
import type { GlobalSearchHit, OrganizationReport, RepositoryReport } from './types';

const ROOT = process.cwd();
const LOCAL_DOCS = 'src/content/docs';

/** O repositório onde o portal roda, lido por inteiro. */
async function scanLocal(id: string, product?: string, owner?: string): Promise<RepositoryReport> {
	const [health, gaps, governance] = await Promise.all([
		documentationHealth.getOverview().catch(() => null),
		analyzeDocumentationGaps({ limit: 30 }).catch(() => null),
		collectGovernance().catch(() => null),
	]);

	return {
		id,
		product,
		owner,
		depth: 'full',
		pages: governance?.pages.length ?? 0,
		owned: governance?.compliance.ownership.covered ?? 0,
		brokenLinks: 0,
		crossReferences: [],
		health: health?.overall ?? null,
		gaps: gaps?.gaps.length ?? null,
		reason: 'Repositório onde o portal roda: Digital Twin, contratos, lacunas e saúde reais.',
	};
}

export async function collectOrganization(options: { role?: string } = {}): Promise<OrganizationReport> {
	const config = await loadOrganization();
	const registrations = visibleRepositories(config, options.role);

	const siblings = registrations.map((entry) => entry.id);
	const reports: RepositoryReport[] = [];

	if (registrations.length === 0) {
		reports.push(await scanLocal('local'));
	} else {
		for (const registration of registrations) {
			const resolved = resolveRepositoryPath(registration);
			const isLocal = resolved !== null && path.resolve(resolved) === path.resolve(ROOT);

			reports.push(
				isLocal
					? await scanLocal(registration.id, registration.product, registration.owner)
					: await scanRepository(registration, { siblings })
			);
		}
	}

	const readable = reports.filter((report) => report.depth !== 'unreachable');
	const pages = readable.reduce((sum, report) => sum + report.pages, 0);
	const owned = readable.reduce((sum, report) => sum + report.owned, 0);

	const measurable = reports.map((report) => report.health).filter((value): value is number => value !== null);

	const products = config.products.map((product) => {
		const members = reports.filter((report) => report.product === product.id);
		const scores = members.map((report) => report.health).filter((value): value is number => value !== null);

		return {
			id: product.id,
			label: product.label,
			repositories: members.map((report) => report.id),
			health: scores.length === 0 ? null : Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length),
		};
	});

	const limitations: string[] = [];

	if (config.repositories.length === 0) {
		limitations.push('Nenhum repositório registrado: a organização é este repositório sozinho. Crie `organization.yml` para registrar outros.');
	}

	const filesOnly = reports.filter((report) => report.depth === 'files').length;
	if (filesOnly > 0) {
		limitations.push(
			`${filesOnly} repositório(s) lido(s) apenas pelos arquivos: saúde e lacunas ficam sem medição e fora das médias.`
		);
	}

	const unreachable = reports.filter((report) => report.depth === 'unreachable').length;
	if (unreachable > 0) limitations.push(`${unreachable} repositório(s) registrado(s) e não lido(s).`);

	const unresolvedCross = reports.flatMap((report) => report.crossReferences).filter((reference) => !reference.resolved).length;
	if (unresolvedCross > 0) {
		limitations.push(`${unresolvedCross} referência(s) cruzada(s) apontam para repositório que não está registrado.`);
	}

	return {
		organization: config.label,
		repositories: reports,
		products,
		totals: {
			repositories: reports.length,
			pages,
			ownership: pages === 0 ? null : Math.round((owned / pages) * 100),
		},
		health: measurable.length === 0 ? null : Math.round(measurable.reduce((sum, value) => sum + value, 0) / measurable.length),
		limitations,
		generatedAt: Date.now(),
	};
}

// ---------------------------------------------------------------------------
// Busca global
// ---------------------------------------------------------------------------

async function searchDirectory(repository: string, docsRoot: string, needle: string, limit: number): Promise<GlobalSearchHit[]> {
	const hits: GlobalSearchHit[] = [];

	async function walk(dir: string, base = ''): Promise<void> {
		if (hits.length >= limit) return;

		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			if (hits.length >= limit) return;
			if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;

			const relative = base ? `${base}/${entry.name}` : entry.name;

			if (entry.isDirectory()) {
				await walk(path.join(dir, entry.name), relative);
				continue;
			}
			if (!/\.mdx?$/.test(entry.name)) continue;

			const raw = await readFile(path.join(dir, entry.name), 'utf-8').catch(() => '');
			const at = raw.toLowerCase().indexOf(needle);
			if (at < 0) continue;

			hits.push({
				repository,
				path: relative,
				title: raw.match(/^title:\s*(.+)$/m)?.[1]?.trim() ?? relative,
				excerpt: raw.slice(Math.max(0, at - 60), at + 120).replace(/\s+/g, ' ').trim(),
			});
		}
	}

	await walk(docsRoot);
	return hits;
}

/**
 * Busca em todos os repositórios legíveis.
 *
 * É busca literal, não a busca do portal. A busca do portal tem índice, BM25 e
 * recorte por trecho, e ela só conhece este repositório — estendê-la a
 * repositórios vizinhos exigiria indexá-los, o que é o oposto de "ler sem
 * executar". O que existe aqui é grep honesto, e o nome no relatório diz isso.
 */
export async function searchOrganization(
	text: string,
	options: { role?: string; limit?: number } = {}
): Promise<GlobalSearchHit[]> {
	const needle = text.trim().toLowerCase();
	if (needle === '') return [];

	const config = await loadOrganization();
	const registrations = visibleRepositories(config, options.role);
	const limit = options.limit ?? 30;

	if (registrations.length === 0) {
		return searchDirectory('local', path.resolve(ROOT, LOCAL_DOCS), needle, limit);
	}

	const hits: GlobalSearchHit[] = [];

	for (const registration of registrations) {
		if (hits.length >= limit) break;

		const root = resolveRepositoryPath(registration);
		if (!root) continue;

		hits.push(
			...(await searchDirectory(
				registration.id,
				path.join(root, registration.docs ?? LOCAL_DOCS),
				needle,
				limit - hits.length
			))
		);
	}

	return hits;
}

export const organization = {
	status: collectOrganization,
	search: searchOrganization,
	config: loadOrganization,
};
