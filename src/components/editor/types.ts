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
}

export interface ContentReference {
	source: string;
	target: string;
	type: 'block' | 'page';
}

export interface ActiveDocument {
	path: string;
	root: ContentRoot;
}
