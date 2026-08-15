import { useCallback, useRef } from 'react';
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
}: MarkdownEditorPaneProps) {
	const editorRef = useRef<MonacoEditorInstance | null>(null);

	const handleMount: OnMount = useCallback(
		(editorInstance, monaco: Monaco) => {
			editorRef.current = editorInstance;

			editorInstance.onDidChangeCursorPosition((e) => {
				onCursorChange({ line: e.position.lineNumber, column: e.position.column });
			});

			// eslint-disable-next-line no-bitwise
			editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
				onSaveShortcut();
			});
		},
		[onCursorChange, onSaveShortcut]
	);

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
