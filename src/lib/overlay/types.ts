/**
 * OpenAPI Overlay — modelo.
 *
 * A decisão que atravessa a camada inteira, e que decide onde cada arquivo
 * pode mexer: **o overlay é uma transformação de documento, aplicada antes do
 * `parseOpenApi`.**
 *
 *     Base OpenAPI → Overlay Engine → Effective OpenAPI → parseOpenApi → ApiModel
 *
 * Nada aqui produz um `ApiModel` próprio, e nada aqui sabe o que é um endpoint.
 * O motor manipula YAML genérico; quem entende de API continua sendo o parser
 * único (ADR-0004). Um segundo modelo derivado do overlay divergiria do primeiro
 * na primeira vez que alguém corrigisse um caso de borda em um dos dois.
 */

/** Uma ação do overlay: encontre `target`, e então atualize ou remova. */
export interface OverlayAction {
	/** Expressão JSONPath. Ver `jsonpath.ts` para o subconjunto suportado. */
	target: string;
	description?: string;
	/** Valor a mesclar no alvo. */
	update?: unknown;
	/** `true` remove o alvo. Prevalece sobre `update` (spec § 12). */
	remove?: boolean;
}

export interface OverlayInfo {
	title: string;
	version: string;
}

/** Metadados de governança que este projeto acrescenta, sob `x-lunar`. */
export interface OverlayGovernance {
	owner?: string;
	purpose?: string;
	environment?: string;
	status?: string;
	scope?: string;
}

export interface Overlay {
	/** Versão da Overlay Specification declarada pelo arquivo. */
	overlay: string;
	info: OverlayInfo;
	actions: OverlayAction[];
	/** Extensões `x-*` do documento, preservadas como vieram. */
	extensions: Record<string, unknown>;
	governance: OverlayGovernance;
	/** Caminho do arquivo, relativo à raiz do projeto. */
	source: string;
}

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

export type IssueSeverity = 'error' | 'warning';

export interface ValidationIssue {
	/** Id estável, como no linter: `OVL-001`. Referenciável em configuração. */
	code: string;
	message: string;
	severity: IssueSeverity;
	/** Onde no overlay, quando aplicável: `actions[2].target`. */
	at?: string;
}

export interface ValidationResult {
	valid: boolean;
	issues: ValidationIssue[];
}

// ---------------------------------------------------------------------------
// Aplicação
// ---------------------------------------------------------------------------

export type ActionKind = 'update' | 'remove';

export interface ActionOutcome {
	/** Índice da ação dentro do overlay, começando em 0. */
	index: number;
	overlay: string;
	target: string;
	kind: ActionKind;
	description?: string;
	/** Quantos nós a expressão encontrou. Zero é o caso que a spec § 25 cobre. */
	matched: number;
	/** Ponteiro JSON de cada nó atingido: `/paths/~1users/get`. */
	pointers: string[];
	/**
	 * Preenchido quando a ação não pôde ser aplicada — expressão fora do
	 * subconjunto suportado, por exemplo. Distinguir isto de "encontrou zero" é
	 * o que impede alguém caçar o bug errado.
	 */
	error?: string;
}

export interface ProvenanceEntry {
	/** Ponteiro JSON do nó alterado. */
	pointer: string;
	overlay: string;
	/** Índice da ação dentro daquele overlay. */
	action: number;
	kind: ActionKind;
	description?: string;
}

export interface ApplyResult {
	/** O documento efetivo. O original nunca é alterado (spec § 7). */
	document: unknown;
	outcomes: ActionOutcome[];
	provenance: ProvenanceEntry[];
	/** Ações cujo alvo não encontrou nada. */
	unmatched: ActionOutcome[];
	/** Ações que falharam por outro motivo. */
	failed: ActionOutcome[];
}

// ---------------------------------------------------------------------------
// Diferença e conflito
// ---------------------------------------------------------------------------

export type ChangeKind = 'removed' | 'added' | 'updated';

export interface SemanticChange {
	kind: ChangeKind;
	pointer: string;
	/** Descrição legível: `GET /users`, `info.title`. */
	label: string;
	before?: unknown;
	after?: unknown;
	/** `true` quando a mudança quebra quem consome a view. */
	breaking: boolean;
}

export interface OverlayDiff {
	changes: SemanticChange[];
	unmatched: ActionOutcome[];
	summary: { removed: number; added: number; updated: number; breaking: number };
}

export interface Conflict {
	pointer: string;
	label: string;
	first: { overlay: string; action: number; kind: ActionKind };
	second: { overlay: string; action: number; kind: ActionKind };
	/**
	 * `remove` seguido de `update` é o caso grave: a segunda ação escreve num nó
	 * que não existe mais, e o autor do segundo overlay não tem como saber.
	 */
	severity: IssueSeverity;
	explanation: string;
}

// ---------------------------------------------------------------------------
// Views e configuração
// ---------------------------------------------------------------------------

export interface ApiView {
	name: string;
	/** Overlays na ordem de aplicação. A ordem é significativa (spec § 13). */
	overlays: string[];
	description?: string;
}

export interface OverlayConfig {
	/** Especificação base. */
	specification: string;
	enabled: boolean;
	views: ApiView[];
	/** Diretório onde `api build` escreve as especificações efetivas. */
	outputDir: string;
	/** Alvo sem correspondência derruba a CI. */
	failOnUnmatchedTarget: boolean;
	/** Conflito entre overlays derruba a CI. */
	failOnConflict: boolean;
	/** Governança: exigir `x-lunar.owner` e `x-lunar.purpose` em cada overlay. */
	requireGovernance: boolean;
}

export const DEFAULT_CONFIG: OverlayConfig = {
	specification: 'src/schemas/portal-api.yaml',
	enabled: false,
	views: [],
	outputDir: '.generated/openapi',
	// Alvo que não casa é o defeito silencioso desta camada: o overlay "funciona",
	// e o endpoint que deveria sumir continua publicado. Bloqueia por padrão.
	failOnUnmatchedTarget: true,
	// Conflito também: dois overlays disputando o mesmo nó dão um resultado que
	// depende da ordem, e ordem não é uma decisão que alguém tomou de propósito.
	failOnConflict: true,
	requireGovernance: false,
};

/** A view implícita, sem overlay nenhum: a especificação como está no disco. */
export const BASE_VIEW = 'base';
