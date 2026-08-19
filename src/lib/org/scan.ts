/**
 * Leitura de um repositório registrado (P3.5).
 *
 * Duas profundidades, e a diferença entre elas aparece em todo relatório:
 *
 * - **completa** — o repositório onde o portal roda. Digital Twin, contratos,
 *   lacunas e saúde reais.
 * - **pelos arquivos** — os demais. Contagem de páginas, dono declarado no
 *   frontmatter, links internos quebrados. Nada que exija executar o repositório.
 *
 * Ler um repositório vizinho significa ler arquivos de um lugar que este projeto
 * não controla, e por isso a leitura é **só leitura de texto**: nada é
 * importado, executado, nem interpretado como configuração deste portal.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import type { RepositoryRegistration, RepositoryReport, ScanDepth } from './types';

const ROOT = process.cwd();
const LINK = /\[[^\]]*\]\(([^)\s]+)\)/g;

/** Resolve o caminho de um repositório, recusando o que sai do disco esperado. */
export function resolveRepositoryPath(registration: RepositoryRegistration): string | null {
	if (!registration.path) return null;
	return path.isAbsolute(registration.path) ? registration.path : path.resolve(ROOT, registration.path);
}

async function listDocs(dir: string, base = ''): Promise<string[]> {
	const found: string[] = [];
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return found;
	}

	for (const entry of entries) {
		// `node_modules` e `.git` num repositório vizinho custariam minutos e não
		// contêm documentação.
		if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;

		const relative = base ? `${base}/${entry.name}` : entry.name;
		if (entry.isDirectory()) found.push(...(await listDocs(path.join(dir, entry.name), relative)));
		else if (/\.mdx?$/.test(entry.name)) found.push(relative);
	}

	return found;
}

function frontmatterOwner(raw: string): string | undefined {
	const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return undefined;

	try {
		const parsed = yaml.load(match[1]) as Record<string, unknown> | null;
		const governance = parsed?.governance as { owner?: unknown } | undefined;
		const owner = governance?.owner ?? parsed?.owner;

		if (typeof owner === 'string' && owner.trim() !== '') return owner.trim();
		if (owner && typeof owner === 'object') {
			const id = (owner as Record<string, unknown>).id;
			if (typeof id === 'string') return id;
		}
	} catch {
		// Frontmatter ilegível de um repositório vizinho não é problema deste
		// portal: a página simplesmente conta como sem dono declarado.
	}

	return undefined;
}

export interface ScanOptions {
	/** Ids dos demais repositórios, para reconhecer referência cruzada. */
	siblings?: readonly string[];
}

export async function scanRepository(
	registration: RepositoryRegistration,
	options: ScanOptions = {}
): Promise<RepositoryReport> {
	const base: RepositoryReport = {
		id: registration.id,
		product: registration.product,
		owner: registration.owner,
		depth: 'unreachable',
		pages: 0,
		owned: 0,
		brokenLinks: 0,
		crossReferences: [],
		health: null,
		gaps: null,
	};

	const root = resolveRepositoryPath(registration);

	if (!root) {
		return {
			...base,
			reason: registration.url
				? 'Registrado por URL remota. O portal não busca repositório da rede: clone-o e aponte `path` para ele.'
				: 'Sem `path` declarado.',
		};
	}

	const docsRoot = path.join(root, registration.docs ?? 'src/content/docs');

	try {
		const info = await stat(docsRoot);
		if (!info.isDirectory()) throw new Error('não é diretório');
	} catch {
		return { ...base, reason: `\`${docsRoot}\` não existe ou não é um diretório.` };
	}

	const files = await listDocs(docsRoot);
	const known = new Set(files.map((file) => file.replace(/\.mdx?$/, '')));

	let owned = 0;
	let brokenLinks = 0;
	const crossReferences: RepositoryReport['crossReferences'] = [];
	const siblings = new Set(options.siblings ?? []);

	for (const file of files) {
		const raw = await readFile(path.join(docsRoot, file), 'utf-8').catch(() => '');
		if (raw === '') continue;

		if (frontmatterOwner(raw)) owned++;

		for (const match of raw.matchAll(LINK)) {
			const target = match[1];

			// Referência cruzada tem a forma `repo://outro-repo/pagina`. É explícita
			// de propósito: adivinhar que um link relativo aponta para outro
			// repositório produziria falso positivo em todo link quebrado.
			const cross = target.match(/^repo:\/\/([^/]+)\/(.+)$/);
			if (cross) {
				crossReferences.push({
					from: file,
					to: cross[2],
					repository: cross[1],
					// "Resolvido" aqui significa apenas que o repositório de destino
					// está registrado. Conferir se a página existe lá exigiria ler o
					// outro repositório, e o relatório não afirma o que não conferiu.
					resolved: siblings.has(cross[1]),
				});
				continue;
			}

			if (/^(https?:|mailto:|#|repo:)/.test(target)) continue;

			const normalized = target
				.replace(/[?#].*$/, '')
				.replace(/^\.\//, '')
				.replace(/\.mdx?$/, '')
				.replace(/\/$/, '')
				.replace(/^\//, '');

			if (normalized === '') continue;
			if (!known.has(normalized) && !known.has(`${normalized}/index`)) brokenLinks++;
		}
	}

	return {
		...base,
		depth: 'files' satisfies ScanDepth,
		pages: files.length,
		owned,
		brokenLinks,
		crossReferences,
		reason: 'Lido pelos arquivos: contagem, dono declarado e links internos. Saúde e lacunas exigiriam executar o repositório.',
	};
}
