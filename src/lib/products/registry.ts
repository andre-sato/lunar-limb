/**
 * Registro de produtos do portal (issue #18).
 *
 * A lista de produtos já existia em `organization.yml`, e era lida por um
 * consumidor só: o painel de Enterprise/Multi-repository, que agrupa notas de
 * saúde por produto. Este módulo abre a mesma lista para o **conteúdo** — o
 * seletor de produto, a filtragem da navegação e o changelog leem daqui.
 *
 * Por que não um `products.yml` novo: a organização já declara quais produtos
 * existem, com id, rótulo e time dono. Um segundo arquivo criaria dois espaços
 * de identificador que só divergem no dia em que alguém edita um e esquece o
 * outro — e o sintoma disso é uma página que some da navegação porque o produto
 * dela "não existe" em metade do sistema.
 */

import { loadOrganization } from '../org/config';
import type { ProductRegistration } from '../org/types';

export type { ProductRegistration };

/**
 * Mesmo alfabeto que `normalizeContext` aplica ao produto vindo do cookie e da
 * query (ver src/lib/adaptive/context.ts). Um id que não sobrevive à
 * normalização nunca casaria com a escolha do leitor, então ele é recusado aqui
 * — no registro, onde dá para corrigir — em vez de falhar silenciosamente na
 * comparação.
 */
const ID_PATTERN = /^[A-Za-z0-9._-]+$/;

function isUsableId(id: string): boolean {
	return id !== '' && id.length <= 40 && ID_PATTERN.test(id);
}

export interface ProductRegistry {
	products: ProductRegistration[];
	byId: Map<string, ProductRegistration>;
}

export const EMPTY_REGISTRY: ProductRegistry = { products: [], byId: new Map() };

/** Monta o registro a partir da lista já interpretada pelo `organization.yml`. */
export function buildRegistry(products: readonly ProductRegistration[]): ProductRegistry {
	const usable: ProductRegistration[] = [];
	const byId = new Map<string, ProductRegistration>();

	for (const product of products) {
		if (!isUsableId(product.id)) continue;
		// Id repetido fica com a primeira declaração: o painel de organização já
		// trata a lista como conjunto, e trocar o vencedor conforme a ordem de
		// leitura faria o mesmo arquivo produzir portais diferentes.
		if (byId.has(product.id)) continue;
		byId.set(product.id, product);
		usable.push(product);
	}

	return { products: usable, byId };
}

let cache: ProductRegistry | null = null;

/**
 * O registro, lido uma vez por processo.
 *
 * O cache existe porque a filtragem consulta o registro em toda página do build,
 * e reler o YAML a cada consulta seria I/O puro por um arquivo que não muda
 * durante um build.
 */
export async function loadProducts(options: { fresh?: boolean } = {}): Promise<ProductRegistry> {
	if (options.fresh) cache = null;
	if (cache) return cache;

	const organization = await loadOrganization();
	cache = buildRegistry(organization.products);
	return cache;
}

export function invalidateProductCache(): void {
	cache = null;
}

export function isKnownProduct(registry: ProductRegistry, id: string | undefined): boolean {
	return id !== undefined && registry.byId.has(id);
}

export function labelFor(registry: ProductRegistry, id: string): string {
	return registry.byId.get(id)?.label ?? id;
}
