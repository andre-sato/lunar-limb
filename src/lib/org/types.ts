/**
 * Enterprise / Multi-repository — modelo (P3.5).
 *
 * Uma organização mantém documentação espalhada por vários repositórios,
 * produtos e times. Esta camada dá um lugar de onde olhar todos.
 *
 * Dois limites ficam declarados aqui, no topo, porque escondê-los faria o painel
 * prometer mais do que entrega:
 *
 * 1. **Só repositórios em disco.** Um repositório registrado com URL remota é
 *    listado, e não é lido. Fazer o portal clonar e ler repositório remoto por
 *    conta própria seria buscar e executar conteúdo arbitrário da rede a cada
 *    coleta — quem clona é a pessoa que opera, e o portal lê o que já está lá.
 *
 * 2. **A profundidade da leitura varia.** O repositório onde o portal roda tem
 *    Digital Twin, contratos, lacunas e saúde completos. Os demais são lidos
 *    pelos arquivos: contagem de páginas, dono declarado, frescor pelo Git,
 *    links internos quebrados. O relatório diz qual leitura recebeu cada um, em
 *    vez de exibir números incomparáveis lado a lado como se fossem iguais.
 */

export interface RepositoryRegistration {
	id: string;
	/** Produto ao qual o repositório pertence. */
	product?: string;
	/** Time dono, casado com os times do `governance.yml` quando possível. */
	owner?: string;
	/** Caminho em disco, relativo à raiz do portal ou absoluto. */
	path?: string;
	/** Endereço remoto. Registrado para referência; nunca buscado pelo portal. */
	url?: string;
	/** Subdiretório da documentação dentro do repositório. */
	docs?: string;
	/**
	 * Papéis que podem ver este repositório no painel. Vazio significa todos os
	 * que já têm acesso a Settings.
	 */
	visibleTo?: string[];
}

export interface ProductRegistration {
	id: string;
	label: string;
	owner?: string;
}

export interface OrganizationConfig {
	id: string;
	label: string;
	products: ProductRegistration[];
	repositories: RepositoryRegistration[];
}

export const EMPTY_ORGANIZATION: OrganizationConfig = {
	id: 'local',
	label: 'Este repositório',
	products: [],
	repositories: [],
};

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

/** Quão fundo o portal conseguiu olhar num repositório. */
export type ScanDepth = 'full' | 'files' | 'unreachable';

export const SCAN_DEPTH_LABEL: Record<ScanDepth, string> = {
	full: 'completa',
	files: 'pelos arquivos',
	unreachable: 'não lido',
};

export interface RepositoryReport {
	id: string;
	product?: string;
	owner?: string;
	depth: ScanDepth;
	/** Páginas de documentação encontradas. */
	pages: number;
	/** Páginas com dono declarado no frontmatter. */
	owned: number;
	/** Links internos que não resolvem para nenhuma página do mesmo repositório. */
	brokenLinks: number;
	/** Referências para páginas de outro repositório registrado. */
	crossReferences: Array<{ from: string; to: string; repository: string; resolved: boolean }>;
	/**
	 * Nota de saúde, quando mensurável. `null` para repositórios lidos só pelos
	 * arquivos — inventar uma nota a partir de contagem de páginas produziria um
	 * número comparável com o do portal e sem nada por trás.
	 */
	health: number | null;
	/** Lacunas abertas, quando mensuráveis. */
	gaps: number | null;
	reason?: string;
}

export interface OrganizationReport {
	organization: string;
	repositories: RepositoryReport[];
	products: Array<{ id: string; label: string; repositories: string[]; health: number | null }>;
	totals: {
		repositories: number;
		pages: number;
		/** Cobertura de dono sobre as páginas de todos os repositórios lidos. */
		ownership: number | null;
	};
	/**
	 * Nota da organização: média das notas **mensuráveis**, ou `null`.
	 *
	 * Repositório lido só pelos arquivos fica fora da média. Contá-lo como zero
	 * faria registrar um repositório baixar a nota da organização, e o efeito
	 * disso é ninguém registrar repositório nenhum.
	 */
	health: number | null;
	limitations: string[];
	generatedAt: number;
}

export interface GlobalSearchHit {
	repository: string;
	path: string;
	title: string;
	/** Trecho ao redor do termo. */
	excerpt: string;
}
