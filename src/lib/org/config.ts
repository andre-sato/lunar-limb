/**
 * Leitura do `organization.yml` (P3.5).
 *
 * Sem o arquivo, a organização é este repositório sozinho — e o relatório diz
 * isso, em vez de mostrar um painel vazio que parece uma frota sem dados.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { EMPTY_ORGANIZATION, type OrganizationConfig, type ProductRegistration, type RepositoryRegistration } from './types';

const CONFIG_FILE = path.resolve(process.cwd(), 'organization.yml');

function strings(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const list = value.filter((entry): entry is string => typeof entry === 'string');
	return list.length > 0 ? list : undefined;
}

export async function loadOrganization(): Promise<OrganizationConfig> {
	let parsed: Record<string, unknown> | null | undefined;

	try {
		parsed = yaml.load(await readFile(CONFIG_FILE, 'utf-8')) as Record<string, unknown>;
	} catch {
		return EMPTY_ORGANIZATION;
	}

	const block = (parsed?.organization ?? parsed ?? {}) as Record<string, unknown>;

	const products: ProductRegistration[] = Array.isArray(block.products)
		? block.products
				.map((entry) => {
					const record = (entry ?? {}) as Record<string, unknown>;
					const id = typeof record.id === 'string' ? record.id : null;
					if (!id) return null;
					const product: ProductRegistration = { id, label: typeof record.label === 'string' ? record.label : id };
					if (typeof record.owner === 'string') product.owner = record.owner;
					return product;
				})
				.filter((entry): entry is ProductRegistration => entry !== null)
		: [];

	const repositories: RepositoryRegistration[] = Array.isArray(block.repositories)
		? block.repositories
				.map((entry) => {
					const record = (entry ?? {}) as Record<string, unknown>;
					const id = typeof record.id === 'string' ? record.id : null;
					if (!id) return null;

					const registration: RepositoryRegistration = { id };
					if (typeof record.product === 'string') registration.product = record.product;
					if (typeof record.owner === 'string') registration.owner = record.owner;
					if (typeof record.path === 'string') registration.path = record.path;
					if (typeof record.url === 'string') registration.url = record.url;
					if (typeof record.docs === 'string') registration.docs = record.docs;
					registration.visibleTo = strings(record.visibleTo);
					return registration;
				})
				.filter((entry): entry is RepositoryRegistration => entry !== null)
		: [];

	return {
		id: typeof block.id === 'string' ? block.id : EMPTY_ORGANIZATION.id,
		label: typeof block.label === 'string' ? block.label : EMPTY_ORGANIZATION.label,
		products,
		repositories,
	};
}

/**
 * Os repositórios que um papel pode ver.
 *
 * O filtro acontece **antes** de qualquer leitura, e não na exibição: um
 * repositório invisível para o papel não deve nem ter os arquivos lidos, senão a
 * contagem agregada denunciaria a existência dele.
 */
export function visibleRepositories(
	config: OrganizationConfig,
	role: string | undefined
): RepositoryRegistration[] {
	return config.repositories.filter(
		(repository) => !repository.visibleTo || repository.visibleTo.length === 0 || (role !== undefined && repository.visibleTo.includes(role))
	);
}
