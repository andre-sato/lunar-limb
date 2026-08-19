/**
 * Knowledge Graph — modelo (P3.4).
 *
 * A decisão mais importante desta camada é o que ela **não** faz: não constrói
 * um segundo grafo.
 *
 * O Digital Twin já indexa página, endpoint, schema, código, exemplo, termo de
 * glossário, teste e versão, com a distinção entre relação declarada e derivada.
 * Um grafo paralelo com as mesmas entidades criaria duas respostas para a mesma
 * pergunta — e, pela experiência das camadas anteriores, as duas divergiriam na
 * primeira semana.
 *
 * O que o Knowledge Graph acrescenta são as entidades que o Twin não conhece
 * porque elas não vêm do conteúdo nem do código: **time**, **release**,
 * **lacuna** e **contrato**. Elas vêm da governança, do histórico Git, do Gap
 * Mining e do Contract Testing, e são costuradas por cima do Twin.
 */

import type { TwinEdge, TwinNode, TwinNodeType, TwinRelation } from '../twin/types';

/** Os tipos que o Knowledge Graph acrescenta ao Twin. */
export type KnowledgeNodeType = TwinNodeType | 'team' | 'release' | 'gap' | 'contract';

export const KNOWLEDGE_NODE_LABEL: Record<string, string> = {
	page: 'Página',
	section: 'Seção',
	api: 'Especificação',
	endpoint: 'Endpoint',
	schema: 'Schema',
	code: 'Código',
	example: 'Exemplo',
	snippet: 'Bloco reutilizável',
	glossary: 'Termo',
	test: 'Teste',
	version: 'Versão',
	team: 'Time',
	release: 'Release',
	gap: 'Lacuna',
	contract: 'Contrato',
};

/** As relações que o Knowledge Graph acrescenta. */
export type KnowledgeRelation = TwinRelation | 'owned-by' | 'changed-in' | 'affected-by';

export const RELATION_LABEL: Record<string, string> = {
	references: 'referencia',
	documents: 'documenta',
	implements: 'implementa',
	uses: 'usa',
	'used-by': 'usada por',
	defines: 'define',
	'validated-by': 'validado por',
	'belongs-to': 'pertence a',
	contains: 'contém',
	'generated-from': 'gerado a partir de',
	supersedes: 'substitui',
	'owned-by': 'pertence ao time',
	'changed-in': 'mudou em',
	'affected-by': 'afetada por',
};

export interface KnowledgeNode extends Omit<TwinNode, 'type'> {
	type: KnowledgeNodeType;
}

export interface KnowledgeEdge extends Omit<TwinEdge, 'relation'> {
	relation: KnowledgeRelation;
}

export interface KnowledgeGraph {
	nodes: KnowledgeNode[];
	edges: KnowledgeEdge[];
}

// ---------------------------------------------------------------------------
// Frescor (§ Graph freshness)
// ---------------------------------------------------------------------------

export type GraphFreshness = 'fresh' | 'stale' | 'rebuilding' | 'failed';

export const FRESHNESS_LABEL: Record<GraphFreshness, string> = {
	fresh: 'Atualizado',
	stale: 'Desatualizado',
	rebuilding: 'Reconstruindo',
	failed: 'Falhou',
};

export interface GraphStatus {
	freshness: GraphFreshness;
	builtAt: number | null;
	/** Idade em segundos, ou `null` quando nunca foi construído. */
	ageSeconds: number | null;
	counts: {
		nodes: Record<string, number>;
		edges: Record<string, number>;
		total: { nodes: number; edges: number };
	};
	/**
	 * Camadas que não puderam ser lidas nesta construção.
	 *
	 * Elas aparecem em vez de sumirem: um grafo montado sem a governança responde
	 * "ninguém é dono disto" com a mesma confiança de um grafo completo, e essa é
	 * a resposta errada mais fácil de acreditar.
	 */
	degraded: string[];
	reason?: string;
}

// ---------------------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------------------

export interface QueryMatch {
	node: KnowledgeNode;
	/** Por que este nó casou: nome, caminho de origem, tipo. */
	matchedOn: string;
	/** Nós ligados diretamente, com a relação. */
	related: Array<{ node: KnowledgeNode; relation: KnowledgeRelation; direction: 'out' | 'in' }>;
}

export interface ImpactNode {
	node: KnowledgeNode;
	/** Saltos desde a origem. */
	distance: number;
	/** O caminho percorrido, em relações. */
	via: KnowledgeRelation[];
}

export interface GraphImpact {
	origin: KnowledgeNode | null;
	affected: ImpactNode[];
	/** Páginas atingidas, que é o que a documentação precisa saber. */
	pages: string[];
	/** Times que precisam saber, pela relação `owned-by`. */
	teams: string[];
	/** `true` quando a busca parou no limite de profundidade. */
	truncated: boolean;
}
