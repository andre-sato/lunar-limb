/**
 * Documentation Agent Orchestrator — modelo (§10, §11, §23, §24, §33).
 *
 * O objetivo declarado da spec, e vale repetir porque muda tudo: **não é criar
 * outro chatbot**. Um agente genérico produz "aqui está uma documentação sobre
 * autenticação" e não garante nada — nem que a implementação foi consultada, nem
 * que a API está correta, nem que os exemplos funcionam.
 *
 * Esta camada coordena agentes especializados que usam as ferramentas que já
 * existem no portal, e produz mudanças **verificáveis**: cada afirmação com fonte,
 * cada alteração passando pelo linter, pelos testes de documentação, pelos testes
 * de contrato e pela auditoria de proveniência antes de virar um pull request que
 * uma pessoa aprova.
 *
 * Duas regras estruturais que aparecem em quase todo arquivo desta pasta:
 *
 *  1. **Nada é publicado automaticamente.** Nem com todos os testes verdes.
 *  2. **Conteúdo recuperado é dado, nunca instrução.** A documentação pode ser
 *     escrita por qualquer pessoa com acesso ao editor.
 */

export type AgentName = 'researcher' | 'writer' | 'reviewer' | 'tester' | 'auditor';

export const AGENT_LABEL: Record<AgentName, string> = {
	researcher: 'Pesquisa',
	writer: 'Redação',
	reviewer: 'Revisão',
	tester: 'Testes',
	auditor: 'Auditoria',
};

export type TaskType = 'create' | 'update' | 'review' | 'repair' | 'investigate';

export interface TaskContext {
	/** Nós do Digital Twin que a tarefa toca. */
	productNodes?: string[];
	/** Lacuna do Gap Mining que originou a tarefa (§34). */
	gapId?: string;
}

export interface TaskConstraints {
	/** Caminhos que o Writer pode tocar. Vazio significa "os do alvo". */
	allowedPaths?: string[];
	/** Nunca ultrapassa o teto da política, mesmo que a tarefa peça mais. */
	maxFiles?: number;
}

export interface DocumentationTask {
	id: string;
	type: TaskType;
	/** Caminho da página, quando a tarefa tem alvo. */
	target?: string;
	instruction: string;
	context?: TaskContext;
	constraints?: TaskConstraints;
}

// ---------------------------------------------------------------------------
// Evidência (§14)
// ---------------------------------------------------------------------------

export interface Evidence {
	/** A afirmação, em uma frase. */
	fact: string;
	/** De onde ela veio: arquivo, ponteiro de especificação, id de teste. */
	source: string;
	/**
	 * 0–1. **Não é verdade absoluta** (§23): é o quanto a fonte sustenta o fato.
	 * Um ponteiro de OpenAPI resolvido vale 1; uma inferência de texto, bem menos.
	 */
	confidence: number;
	/** Trecho literal que sustenta a afirmação, quando existe. */
	quote?: string;
}

export interface ResearchResult {
	facts: Evidence[];
	sources: string[];
	/** O que a pesquisa **não** conseguiu responder (§15). */
	unknowns: string[];
	/** Fontes que discordam entre si (§16). */
	conflicts: Array<{ subject: string; positions: Array<{ source: string; value: string }> }>;
	confidence: number;
}

// ---------------------------------------------------------------------------
// Execução (§11)
// ---------------------------------------------------------------------------

export type StepStatus = 'queued' | 'running' | 'completed' | 'failed' | 'blocked' | 'skipped';

export interface AgentError {
	code: string;
	message: string;
	/** `true` quando repetir pode resolver — falha de rede, por exemplo. */
	retryable: boolean;
}

export interface AgentStep {
	agent: AgentName | 'orchestrator';
	/** Nome legível da etapa: "Pesquisa", "Testes de contrato". */
	label: string;
	status: StepStatus;
	startedAt?: string;
	finishedAt?: string;
	/** Confiança da etapa (§23). */
	confidence?: number;
	output?: unknown;
	errors?: AgentError[];
	/** Ferramentas efetivamente usadas — o log de auditoria depende disto (§30). */
	tools?: string[];
}

export type RunStatus =
	| 'queued'
	| 'running'
	| 'awaiting-approval'
	| 'approved'
	| 'rejected'
	| 'blocked'
	| 'failed'
	| 'cancelled'
	| 'completed';

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
	queued: 'Na fila',
	running: 'Executando',
	'awaiting-approval': 'Aguardando aprovação',
	approved: 'Aprovado',
	rejected: 'Rejeitado',
	blocked: 'Bloqueado',
	failed: 'Falhou',
	cancelled: 'Cancelado',
	completed: 'Concluído',
};

export interface FileChange {
	path: string;
	/** `create` ou `update`. Remoção exige autorização explícita (§25). */
	kind: 'create' | 'update';
	before?: string;
	after: string;
	/** Diff unificado, para a apresentação (§21). */
	diff: string;
}

export interface AgentRun {
	id: string;
	task: DocumentationTask;
	status: RunStatus;
	/** Nível de autonomia efetivo desta execução (§24). */
	autonomy: AutonomyLevel;
	steps: AgentStep[];
	research?: ResearchResult;
	changes: FileChange[];
	/** Confiança por etapa, para a tabela do §23. */
	confidence: Partial<Record<AgentName, number>>;
	/** Por que parou, quando parou antes do fim. */
	blockedReason?: string;
	retries: number;
	createdBy: string;
	createdAt: string;
	updatedAt: string;
	/** Corpo do pull request, quando chegou lá (§41). */
	pullRequestBody?: string;
}

// ---------------------------------------------------------------------------
// Autonomia (§24)
// ---------------------------------------------------------------------------

/**
 * Quanto o sistema pode fazer sozinho.
 *
 *     0  sugerir       devolve recomendação, não escreve nada
 *     1  rascunhar     escreve no workspace isolado
 *     2  validar       rascunha e roda toda a validação  ← padrão
 *     3  pull request  abre o PR depois de validar
 *
 * O padrão é **2**, como a spec pede. E mesmo no nível 3 a aprovação humana
 * continua obrigatória (§22): o que o nível 3 automatiza é a abertura do PR
 * **depois** de alguém aprovar, não a decisão de publicar.
 */
export type AutonomyLevel = 0 | 1 | 2 | 3;

export const AUTONOMY_LABEL: Record<AutonomyLevel, string> = {
	0: 'Sugerir',
	1: 'Rascunhar',
	2: 'Validar',
	3: 'Pull request',
};

export const DEFAULT_AUTONOMY: AutonomyLevel = 2;

export interface OrchestratorConfig {
	autonomy: AutonomyLevel;
	/** Teto de repetições por execução (§32). */
	maxRetries: number;
	/** Teto de arquivos que uma execução pode tocar. */
	maxFiles: number;
	/** Bloquear quando a saúde da documentação piorar (§35). */
	blockOnHealthRegression: boolean;
}

export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
	autonomy: DEFAULT_AUTONOMY,
	// Duas tentativas, como o exemplo da spec. Sem teto, um Writer que não
	// consegue satisfazer o Tester gira para sempre — e cada volta custa uma
	// chamada de modelo.
	maxRetries: 2,
	maxFiles: 10,
	blockOnHealthRegression: true,
};
