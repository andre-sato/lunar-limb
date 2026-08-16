import { useCallback, useEffect, useRef } from 'react';
import Editor, { type Monaco, type OnMount } from '@monaco-editor/react';
import type { CursorPosition, ThemeMode } from './types';

type MonacoEditorInstance = Parameters<OnMount>[0];

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

export default function MarkdownEditorPane({
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
}: MarkdownEditorPaneProps) {
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

	// Surface Markdown/MDX parse errors from the preview as an inline marker,
	// the same way a linter would — this is the "Problems panel" equivalent
	// called for in the spec, scoped to what we can actually detect today.
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
