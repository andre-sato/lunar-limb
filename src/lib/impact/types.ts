/**
 * Documentation Impact Engine — modelo (§2, §4, §5).
 *
 * O Content Graph responde "quem usa o quê". O Impact Engine responde a pergunta
 * seguinte, que é a operacional:
 *
 *     "Se eu mudar isso, o que preciso revisar?"
 *
 * A diferença não é técnica, é de uso. Uma lista de backlinks é informação; um
 * relatório de impacto é uma decisão — o que revisar, em que ordem, e o que pode
 * esperar. Por isso tudo aqui é classificado e ordenado, e nada aparece sem
 * dizer **por que** apareceu.
 */

// ---------------------------------------------------------------------------
// Grafo de impacto (§4)
// ---------------------------------------------------------------------------

/**
 * `sdk` entra aqui, e não num engine próprio.
 *
 * A spec de SDK Engineering é explícita: o SDK é mais um artefato do mesmo
 * mecanismo de impacto, ao lado de páginas, testes e blocos reutilizáveis. Um
 * segundo engine daria duas respostas para "o que quebra se isto mudar".
 */
export type ImpactNodeType = 'page' | 'section' | 'api' | 'schema' | 'glossary' | 'snippet' | 'version' | 'sdk';

export interface ImpactNode {
	/** Identidade dentro do grafo de impacto: `page:guides/authentication`. */
	id: string;
	type: ImpactNodeType;
	/** Caminho do arquivo, quando o nó tem arquivo. */
	path: string;
	title?: string;
	version?: string;
}

export type ImpactEdgeType = 'references' | 'uses' | 'documents' | 'defines' | 'implements' | 'contains';

export interface ImpactEdge {
	source: string;
	target: string;
	type: ImpactEdgeType;
}

export interface ImpactGraph {
	nodes: ImpactNode[];
	edges: ImpactEdge[];
}

// ---------------------------------------------------------------------------
// Mudanças que iniciam a análise (§3)
// ---------------------------------------------------------------------------

export type ChangeKind =
	/** Página de documentação editada. */
	| 'page'
	/** Bloco reutilizável editado. */
	| 'snippet'
	/** Especificação OpenAPI alterada. */
	| 'api'
	/** Especificação AsyncAPI alterada. */
	| 'events'
	/** Termo do glossário alterado. */
	| 'glossary'
	/** Registro de versões alterado. */
	| 'version'
	/** Qualquer outro arquivo — configuração, componente, estilo. */
	| 'other';

export interface Change {
	kind: ChangeKind;
	/** Caminho no repositório. */
	path: string;
	status: 'added' | 'modified' | 'removed';
	/** Conteúdo antes, quando existe e foi possível recuperar. */
	before?: string;
	/** Conteúdo depois, quando o arquivo ainda existe. */
	after?: string;
}

// ---------------------------------------------------------------------------
// Classificação (§5)
// ---------------------------------------------------------------------------

/**
 * Quatro níveis, e a fronteira que importa é entre `critical` e o resto:
 *
 *     critical  a mudança pode **invalidar** a documentação (endpoint removido)
 *     high      provavelmente exige revisão
 *     medium    potencialmente relevante
 *     low       sem impacto funcional significativo
 *
 * Classificar tudo como crítico é o mesmo que não classificar nada: a equipe
 * aprende a ignorar a cor. Por isso `critical` fica reservado ao que torna o
 * texto publicado **falso**, não ao que apenas dá trabalho.
 */
export type ImpactSeverity = 'critical' | 'high' | 'medium' | 'low';

export const SEVERITY_ORDER: Record<ImpactSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export const SEVERITY_MARK: Record<ImpactSeverity, string> = {
	critical: '🔴',
	high: '🟠',
	medium: '🟡',
	low: '🟢',
};

export const SEVERITY_LABEL: Record<ImpactSeverity, string> = {
	critical: 'crítico',
	high: 'alto',
	medium: 'médio',
	low: 'baixo',
};

export interface ImpactItem {
	/** O que precisa ser revisado. */
	node: ImpactNode;
	severity: ImpactSeverity;
	/** Por que este item apareceu, em uma frase legível. */
	reason: string;
	/** Origem da conclusão: o arquivo alterado que levou até aqui. */
	origin: string;
	/**
	 * Caminho no grafo entre a origem e este item. Um salto é dependência direta;
	 * mais de um é indireta, e o relatório precisa mostrar por onde passou —
	 * "revise esta página" sem o caminho é um palpite pedindo confiança.
	 */
	via: string[];
	/** `true` quando o item muda de conteúdo sem aparecer no diff. */
	hidden: boolean;
}

// ---------------------------------------------------------------------------
// Checklist (§11) e score (§12)
// ---------------------------------------------------------------------------

export interface ChecklistItem {
	label: string;
	severity: ImpactSeverity;
	/** Caminho ou URL para onde a pessoa deve ir. */
	target?: string;
}

export type ReviewScope = 'trivial' | 'small' | 'medium' | 'large';

export const REVIEW_SCOPE_LABEL: Record<ReviewScope, string> = {
	trivial: 'Trivial',
	small: 'Pequeno',
	medium: 'Médio',
	large: 'Grande',
};

export interface ImpactScore {
	/** 0–100. Quanto maior, mais atenção a mudança exige. */
	value: number;
	/** Cada fator com o que contribuiu — um número sem decomposição não se audita. */
	factors: Array<{ name: string; points: number; detail: string }>;
}

export interface ApiChangeSummary {
	/** Mudanças que quebram quem já consome a API. */
	breaking: string[];
	/** Mudanças compatíveis. */
	compatible: string[];
}

export interface ImpactReport {
	changes: Change[];
	items: ImpactItem[];
	checklist: ChecklistItem[];
	score: ImpactScore;
	scope: ReviewScope;
	api: ApiChangeSummary;
	/** Termos do glossário tocados pela mudança. */
	glossaryTerms: string[];
	/** Contagem por severidade, para o resumo de uma linha. */
	counts: Record<ImpactSeverity, number>;
	/** Severidade mais alta encontrada; `low` quando não há item. */
	highest: ImpactSeverity;
	generatedAt: number;
}

export function countBySeverity(items: readonly ImpactItem[]): Record<ImpactSeverity, number> {
	const counts: Record<ImpactSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
	for (const item of items) counts[item.severity]++;
	return counts;
}

export function highestSeverity(items: readonly ImpactItem[]): ImpactSeverity {
	return items.reduce<ImpactSeverity>(
		(highest, item) => (SEVERITY_ORDER[item.severity] < SEVERITY_ORDER[highest] ? item.severity : highest),
		'low'
	);
}
