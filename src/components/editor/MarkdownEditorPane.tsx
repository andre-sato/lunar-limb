import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import Editor, { type Monaco, type OnMount } from '@monaco-editor/react';
import type { CursorPosition, ThemeMode } from './types';

type MonacoEditorInstance = Parameters<OnMount>[0];

export interface EditorSelection {
	text: string;
	startOffset: number;
	endOffset: number;
}

export interface MarkdownEditorHandle {
	/** Current selection as text + character offsets into the full document string, or null if nothing is selected. */
	getSelection: () => EditorSelection | null;
	focus: () => void;
}

interface MarkdownEditorPaneProps {
	value: string;
	language: 'markdown' | 'mdx';
	theme: ThemeMode;
	onChange: (value: string) => void;
	onCursorChange: (pos: CursorPosition) => void;
	onSaveShortcut: () => void;
	wordWrap: boolean;
	minimap: boolean;
	/** 1-based line number of a Markdown/MDX parse error, if any, shown as a Monaco marker. */
	errorLine?: number;
	errorMessage?: string;
}

function MarkdownEditorPaneInner(
	{
		value,
		language,
		theme,
		onChange,
		onCursorChange,
		onSaveShortcut,
		wordWrap,
		minimap,
		errorLine,
		errorMessage,
	}: MarkdownEditorPaneProps,
	ref: Ref<MarkdownEditorHandle>
) {
	const editorRef = useRef<MonacoEditorInstance | null>(null);
	const monacoRef = useRef<Monaco | null>(null);

	const handleMount: OnMount = useCallback(
		(editorInstance, monacoInstance) => {
			editorRef.current = editorInstance;
			monacoRef.current = monacoInstance;

			editorInstance.onDidChangeCursorPosition((e) => {
				onCursorChange({ line: e.position.lineNumber, column: e.position.column });
			});

			// eslint-disable-next-line no-bitwise
			editorInstance.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS, () => {
				onSaveShortcut();
			});
		},
		[onCursorChange, onSaveShortcut]
	);

	useImperativeHandle(
		ref,
		() => ({
			getSelection() {
				const ed = editorRef.current;
				if (!ed) return null;
				const selection = ed.getSelection();
				const model = ed.getModel();
				if (!selection || !model || selection.isEmpty()) return null;
				return {
					text: model.getValueInRange(selection),
					startOffset: model.getOffsetAt(selection.getStartPosition()),
					endOffset: model.getOffsetAt(selection.getEndPosition()),
				};
			},
			focus() {
				editorRef.current?.focus();
			},
		}),
		[]
	);

	// Surface Markdown/MDX parse errors from the preview as an inline marker,
	// the same way a linter would.
	useEffect(() => {
		const ed = editorRef.current;
		const monacoInstance = monacoRef.current;
		if (!ed || !monacoInstance) return;
		const model = ed.getModel();
		if (!model) return;

		if (errorLine && errorLine >= 1 && errorLine <= model.getLineCount()) {
			monacoInstance.editor.setModelMarkers(model, 'editor-preview', [
				{
					startLineNumber: errorLine,
					startColumn: 1,
					endLineNumber: errorLine,
					endColumn: model.getLineMaxColumn(errorLine),
					message: errorMessage || 'Erro ao renderizar o conteúdo.',
					severity: monacoInstance.MarkerSeverity.Error,
				},
			]);
		} else {
			monacoInstance.editor.setModelMarkers(model, 'editor-preview', []);
		}
	}, [errorLine, errorMessage]);

	// Monaco has no dedicated MDX grammar; "markdown" gives correct
	// highlighting/wrap behavior for the JSX-in-Markdown body too.
	const monacoLanguage = language === 'mdx' ? 'markdown' : 'markdown';

	return (
		<Editor
			height="100%"
			theme={theme === 'dark' ? 'vs-dark' : 'vs'}
			language={monacoLanguage}
			value={value}
			onChange={(v) => onChange(v ?? '')}
			onMount={handleMount}
			options={{
				wordWrap: wordWrap ? 'on' : 'off',
				minimap: { enabled: minimap },
				fontSize: 14,
				lineNumbers: 'on',
				renderWhitespace: 'selection',
				automaticLayout: true,
				scrollBeyondLastLine: false,
				tabSize: 2,
				bracketPairColorization: { enabled: true },
			}}
		/>
	);
}

const MarkdownEditorPane = forwardRef(MarkdownEditorPaneInner);
export default MarkdownEditorPane;
