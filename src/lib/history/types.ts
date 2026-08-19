/**
 * Documentation Time Machine — modelo (P2.1).
 *
 * O princípio que a spec fixa logo na primeira linha: **o Git continua sendo a
 * fonte de verdade**. Esta camada é indexação sobre commits, branches, tags e
 * releases — ela não guarda uma cópia paralela do que a documentação era.
 *
 * A distinção não é acadêmica. Um índice histórico persistido divergiria do
 * repositório no primeiro `rebase`, e a partir daí duas respostas diferentes para
 * "como esta página estava em maio" — uma delas errada, e nenhuma marcada como
 * tal. Reconstruir do Git é mais lento e sempre certo.
 *
 * A única exceção já existia e é deliberada: os snapshots de saúde
 * (`health/snapshots.ts`). Health Score não se deriva do conteúdo — ele depende de
 * medições que rodaram naquele momento, com as ferramentas daquele momento.
 */

export interface HistoryEntry {
	/** SHA do commit. */
	commit: string;
	/** ISO 8601. */
	date: string;
	author: string;
	subject: string;
	/** `A`, `M`, `D` — o que aconteceu com a página neste commit. */
	change: 'added' | 'modified' | 'deleted' | 'renamed';
	/** Tags que apontam para este commit — releases, quando existirem. */
	tags: string[];
	/** Número do pull request, quando o assunto do commit o menciona. */
	pullRequest?: number;
	insertions: number;
	deletions: number;
}

export interface PageSnapshot {
	path: string;
	/** Conteúdo naquele momento. Ausente quando a página ainda não existia. */
	content?: string;
}

export interface SnapshotRef {
	/** `HEAD`, um SHA, uma tag, ou uma data ISO resolvida para o commit da época. */
	ref: string;
	/** A data efetiva do commit resolvido. */
	date?: string;
	/** Como a referência foi obtida — importa para o relatório não mentir. */
	resolvedFrom?: 'ref' | 'date' | 'tag';
}

export interface DocumentationSnapshot {
	id: string;
	timestamp: string;
	gitRef: string;
	pages: PageSnapshot[];
	/** Métricas reconstruídas naquele ponto. Ausentes quando não foi possível medir. */
	metrics?: SnapshotMetrics;
}

/**
 * O que se consegue medir num ponto do passado.
 *
 * Nem tudo é reconstruível com honestidade. Contagem de páginas e nota do linter
 * saem do conteúdo daquele commit — são exatas. O Health Score **não**: ele
 * dependia de testes, contratos e proveniência avaliados com as ferramentas
 * daquela época, e recalculá-lo hoje mediria o passado com a régua do presente.
 * Por isso ele vem do histórico de snapshots quando existe, e vem ausente quando
 * não existe.
 */
export interface SnapshotMetrics {
	pages: number;
	words: number;
	/** Nota média do linter, recalculada sobre o conteúdo daquele commit. */
	lintScore?: number;
	/** Termos no glossário naquele momento. */
	glossaryTerms?: number;
	/** Endpoints declarados nas especificações daquele momento. */
	endpoints?: number;
	/** Do histórico de saúde, quando há medição próxima àquela data. */
	health?: number;
	/** `true` quando o Health veio de uma medição real, não de estimativa. */
	healthMeasured: boolean;
}

export interface SnapshotComparison {
	from: SnapshotRef;
	to: SnapshotRef;
	metrics: Array<{ name: string; before: number | null; after: number | null; delta: number | null }>;
	/** Páginas criadas, removidas e alteradas entre os dois pontos. */
	pages: {
		added: string[];
		removed: string[];
		modified: string[];
	};
	commits: number;
}

// ---------------------------------------------------------------------------
// Semantic diff
// ---------------------------------------------------------------------------

export type SemanticChangeKind =
	/** Um número mudou: prazo, limite, quantidade. */
	| 'value'
	/** Campo obrigatório acrescentado ou removido. */
	| 'required-field'
	/** Endpoint citado passou a existir ou deixou de ser citado. */
	| 'endpoint'
	/** Mecanismo de autenticação documentado mudou. */
	| 'authentication'
	/** Código de status documentado mudou. */
	| 'status-code';

export const SEMANTIC_LABEL: Record<SemanticChangeKind, string> = {
	value: 'Valor',
	'required-field': 'Campo obrigatório',
	endpoint: 'Endpoint',
	authentication: 'Autenticação',
	'status-code': 'Código de status',
};

export interface SemanticChange {
	kind: SemanticChangeKind;
	/** O que mudou, em uma frase: "expiração da chave de API". */
	subject: string;
	before?: string;
	after?: string;
	/**
	 * Quão confiante é a leitura. Comparação de texto não é análise semântica de
	 * verdade, e um número aqui evita que o relatório soe mais certo do que é.
	 */
	confidence: number;
}

export interface DocumentationDiff {
	path: string;
	/** Diff unificado, para quem quer ver o texto. */
	textual: string;
	/** Mudanças de comportamento, para quem quer ver a consequência. */
	semantic: SemanticChange[];
}

// ---------------------------------------------------------------------------
// Impacto histórico
// ---------------------------------------------------------------------------

export interface HistoricalImpact {
	commit: string;
	subject: string;
	date: string;
	author: string;
	/** Arquivos de conteúdo tocados. */
	pages: string[];
	/** Especificações e código tocados no mesmo commit. */
	product: string[];
	/** Mudanças de comportamento apuradas sobre as páginas. */
	semantic: SemanticChange[];
	/** Páginas que mudaram por tabela, sem aparecer no commit. */
	indirect: string[];
}
