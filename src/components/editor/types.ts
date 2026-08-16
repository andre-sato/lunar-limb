export interface TreeNode {
	name: string;
	path: string;
	type: 'dir' | 'file';
	ext?: string;
	title?: string;
	children?: TreeNode[];
}

export type ViewMode = 'split' | 'editor' | 'preview';
export type SaveStatus = 'idle' | 'unsaved' | 'saving' | 'saved' | 'error';
export type ThemeMode = 'light' | 'dark';

export interface OpenDocument {
	path: string;
	content: string;
	mtimeMs: number;
}

export interface CursorPosition {
	line: number;
	column: number;
}

export type ContentRoot = 'docs' | 'snippets';

export interface ReusableItem {
	id: string;
	type: 'block' | 'page';
	path: string;
	title?: string;
	description?: string;
	/** Fase 4: quantas páginas usam este conteúdo. */
	usedByCount?: number;
}

export interface ActiveDocument {
	path: string;
	root: ContentRoot;
}

// ---------------------------------------------------------------------------
// Fase 4 — Content Graph
//
// Os tipos do grafo vivem em src/lib/editor/graph-model.ts, que é código puro
// (sem node:fs) justamente para poder ser importado também aqui no cliente —
// assim o editor roda os mesmos algoritmos (ciclo, impacto) sem uma ida extra
// ao servidor.
// ---------------------------------------------------------------------------

export type {
	ContentEdge,
	ContentGraph,
	ContentNode,
	ContentProblem,
	ImpactAnalysis,
	ProblemKind,
	ProblemSeverity,
	ReusableType,
	SourceLocation,
} from '../../lib/editor/graph-model';

/** Formato antigo (Fase 3) — ainda usado internamente por alguns helpers. */
export interface ContentReference {
	source: string;
	target: string;
	type: 'block' | 'page';
}

/** Uma ponta de aresta já resolvida para exibição (título, caminho, linha). */
export interface ReferenceDetail {
	id: string;
	type: 'block' | 'page';
	path?: string;
	root?: ContentRoot;
	title?: string;
	resolved: boolean;
	location: { line: number; column: number };
}

// ---------------------------------------------------------------------------
// Fase 5
// ---------------------------------------------------------------------------

export type { Condition, VariableDefinition, VariableMap, VariableValue } from '../../lib/content/variables';
export type { SearchHit } from '../../lib/editor/search';
export type { GitState, GitStatusMap } from '../../lib/editor/git-status';

/** Um comando da Command Palette. */
export interface EditorCommand {
	id: string;
	label: string;
	/** Agrupa visualmente na paleta ("Arquivo", "Inserir", "Ver"…). */
	group: string;
	/** Atalho exibido à direita, apenas informativo. */
	shortcut?: string;
	/** Quando false, o comando aparece esmaecido e não executa. */
	enabled?: boolean;
	run: () => void;
}
