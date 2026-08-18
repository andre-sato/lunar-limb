/**
 * Documentation Digital Twin — modelo (§3, §4, §5, §9).
 *
 * O Twin **não é uma nova fonte de verdade** (§2). A fonte continua sendo o Git:
 * Markdown, MDX, OpenAPI, AsyncAPI e o código. Esta camada é derivada — ela lê
 * essas fontes e monta uma representação de como elas se relacionam, e nada aqui
 * é editável nem persistido como verdade própria. Se o grafo discordar do
 * repositório, quem está errado é o grafo.
 *
 * A pergunta que ele existe para responder não é "quais são os backlinks", que o
 * Content Graph já responde. É:
 *
 *     O que do produto está documentado, o que da documentação não existe mais no
 *     produto, e o que quebra se isto mudar?
 */

export type TwinNodeType =
	| 'page'
	| 'section'
	| 'api'
	| 'endpoint'
	| 'schema'
	| 'code'
	| 'example'
	| 'snippet'
	| 'glossary'
	| 'test'
	| 'version';

export const TWIN_NODE_LABEL: Record<TwinNodeType, string> = {
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
};

export interface TwinNode {
	/** `endpoint:GET /auth/me`, `page:guides/auth`, `code:src/pages/api/auth/me.ts`. */
	id: string;
	type: TwinNodeType;
	name: string;
	/** Arquivo de origem no repositório, quando o nó tem um. */
	source?: string;
	version?: string;
	metadata?: Record<string, unknown>;
}

export type TwinRelation =
	| 'references'
	| 'documents'
	| 'implements'
	| 'uses'
	| 'used-by'
	| 'defines'
	| 'validated-by'
	| 'belongs-to'
	| 'contains'
	| 'generated-from'
	| 'supersedes';

export interface TwinEdge {
	from: string;
	to: string;
	relation: TwinRelation;
	/**
	 * Como esta aresta foi obtida. `declared` veio de alguém escrever a relação
	 * (um `<TryIt/>`, uma anotação de proveniência, uma tag de conteúdo);
	 * `derived` foi inferida por convenção (roteamento por arquivo, caminho
	 * literal no texto).
	 *
	 * A distinção existe porque as duas erram de formas diferentes, e um relatório
	 * que as mistura não permite julgar o quanto confiar nele.
	 */
	origin: 'declared' | 'derived';
}

export interface TwinGraph {
	nodes: TwinNode[];
	edges: TwinEdge[];
	generatedAt: number;
}

// ---------------------------------------------------------------------------
// Cobertura (§8, §9)
// ---------------------------------------------------------------------------

export interface CoverageSlice {
	documented: number;
	total: number;
	/** 0–100, ou `null` quando não há o que medir. */
	percentage: number | null;
}

export interface TwinConfig {
	/** Prefixos de caminho que não são API de produto. */
	internal: string[];
	/** Mínimo de cobertura de endpoints para o portão de CI. */
	minimumCoverage: number;
}

export const DEFAULT_TWIN_CONFIG: TwinConfig = { internal: [], minimumCoverage: 90 };

export interface CoverageReport {
	endpoints: CoverageSlice;
	schemas: CoverageSlice;
	/** Endpoints documentados que também trazem exemplo. */
	examples: CoverageSlice;
	/** Domínios do produto — por tag da especificação. */
	features: CoverageSlice;
	/** Cobertura por domínio, do pior para o melhor. */
	byDomain: Array<{ domain: string; documented: number; total: number; percentage: number }>;
	/** Média das fatias mensuráveis. */
	overall: number | null;
	/**
	 * Endpoints internos do portal, fora da conta.
	 *
	 * Eles continuam no grafo e continuam listáveis: o que muda é não pesarem num
	 * indicador que existe para falar da documentação **do produto**.
	 */
	internal: number;
}

export interface UndocumentedItem {
	node: TwinNode;
	/** O que existe: implementação, especificação, SDK. */
	evidence: string[];
	/** Sugestão de onde documentar. */
	suggestion?: string;
}

export interface StaleDocumentationItem {
	node: TwinNode;
	/** A referência que não encontra correspondente no produto. */
	reference: string;
	/**
	 * Sempre "potencialmente": a página pode documentar comportamento histórico,
	 * versão anterior, conceito ou funcionalidade planejada (§11). Chamar isso de
	 * erro automático transformaria documentação legítima em alarme.
	 */
	reason: string;
}

export interface TwinSummary {
	nodes: Record<string, number>;
	edges: number;
	coverage: CoverageReport;
	undocumented: UndocumentedItem[];
	stale: StaleDocumentationItem[];
	/** Endpoints com versão implementada e não documentada (§12). */
	versionGaps: Array<{ endpoint: string; version: string; issue: string }>;
	generatedAt: number;
}

// ---------------------------------------------------------------------------
// Identidade
// ---------------------------------------------------------------------------

export const twinId = {
	page: (path: string) => `page:${path.replace(/\.mdx?$/, '')}`,
	snippet: (id: string) => `snippet:${id}`,
	api: (file: string) => `api:${file}`,
	endpoint: (key: string) => `endpoint:${key}`,
	schema: (name: string) => `schema:${name}`,
	code: (file: string) => `code:${file}`,
	example: (key: string) => `example:${key}`,
	glossary: (id: string) => `glossary:${id}`,
	test: (id: string) => `test:${id}`,
	version: (id: string) => `version:${id}`,
};

export function percentage(documented: number, total: number): number | null {
	if (total === 0) return null;
	return Math.round((documented / total) * 100);
}

export function slice(documented: number, total: number): CoverageSlice {
	return { documented, total, percentage: percentage(documented, total) };
}
