import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
	type Ref,
	type RefObject,
} from 'react';
import Editor, { type Monaco, type OnMount } from '@monaco-editor/react';
import type { CursorPosition, ThemeMode } from './types';
import type { LintFinding, Severity } from '../../lib/linter/types';

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
	/** Fase 4: leva o cursor até uma linha (navegação vinda do painel de referências). */
	revealLine: (line: number) => void;
}

/** Fase 4: uma tag de conteúdo reutilizável encontrada no documento aberto. */
export interface ReferenceMarker {
	line: number;
	id: string;
	type: 'block' | 'page';
	resolved: boolean;
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
	/** Fase 4: linhas com <ContentBlock>/<IncludePage>, decoradas para distinguir conteúdo reutilizado do local. */
	referenceMarkers?: ReferenceMarker[];
	/** Findings do linter, desenhados como marcadores sublinhados (§42). */
	lintFindings?: LintFinding[];
	/** Fase 5: liga as keybindings do Vim. */
	vimMode?: boolean;
	/** Fase 5: onde a barra de status do Vim é desenhada. */
	vimStatusRef?: RefObject<HTMLDivElement | null>;
}

/** Envolve a seleção (ou insere no cursor) com um par de marcadores Markdown. */
function wrapSelection(editor: MonacoEditorInstance, before: string, after: string, placeholder: string): void {
	const selection = editor.getSelection();
	const model = editor.getModel();
	if (!selection || !model) return;

	const selected = model.getValueInRange(selection);
	const text = selected || placeholder;
	editor.executeEdits('format', [{ range: selection, text: `${before}${text}${after}` }]);

	// Sem seleção prévia, deixa o cursor dentro dos marcadores, pronto para digitar.
	if (!selected) {
		const position = editor.getPosition();
		if (position) {
			editor.setPosition({ lineNumber: position.lineNumber, column: position.column - after.length });
		}
	}
	editor.focus();
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
		referenceMarkers,
		lintFindings,
		vimMode = false,
		vimStatusRef,
	}: MarkdownEditorPaneProps,
	ref: Ref<MarkdownEditorHandle>
) {
	const editorRef = useRef<MonacoEditorInstance | null>(null);
	const monacoRef = useRef<Monaco | null>(null);
	const decorationsRef = useRef<string[]>([]);
	// Os efeitos abaixo dependem da instância do Monaco, que só existe depois do
	// mount; este contador é o que os faz rodar de novo assim que ela aparece.
	const [mounted, setMounted] = useState(0);

	const handleMount: OnMount = useCallback(
		(editorInstance, monacoInstance) => {
			editorRef.current = editorInstance;
			monacoRef.current = monacoInstance;
			setMounted((n) => n + 1);

			editorInstance.onDidChangeCursorPosition((e) => {
				onCursorChange({ line: e.position.lineNumber, column: e.position.column });
			});

			/* eslint-disable no-bitwise */
			const { CtrlCmd } = monacoInstance.KeyMod;
			const { KeyS, KeyB, KeyI, KeyK } = monacoInstance.KeyCode;

			editorInstance.addCommand(CtrlCmd | KeyS, () => {
				onSaveShortcut();
			});

			// Fase 5 — atalhos de formatação Markdown (§7 da especificação).
			editorInstance.addCommand(CtrlCmd | KeyB, () => wrapSelection(editorInstance, '**', '**', 'negrito'));
			editorInstance.addCommand(CtrlCmd | KeyI, () => wrapSelection(editorInstance, '_', '_', 'itálico'));
			editorInstance.addCommand(CtrlCmd | KeyK, () => wrapSelection(editorInstance, '[', '](url)', 'texto do link'));
			/* eslint-enable no-bitwise */
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
			revealLine(line: number) {
				const ed = editorRef.current;
				const model = ed?.getModel();
				if (!ed || !model) return;
				const target = Math.min(Math.max(line, 1), model.getLineCount());
				ed.revealLineInCenter(target);
				ed.setPosition({ lineNumber: target, column: 1 });
				ed.focus();
			},
		}),
		[]
	);

	// Fase 4 — decoração das linhas que trazem conteúdo de outro arquivo.
	// Sem isso, `<ContentBlock id="x" />` é só mais uma linha de texto; com a
	// faixa lateral, o autor vê de relance o que é local e o que é reutilizado
	// (§26 da especificação).
	useEffect(() => {
		const ed = editorRef.current;
		const monacoInstance = monacoRef.current;
		if (!ed || !monacoInstance) return;
		const model = ed.getModel();
		if (!model) return;

		const decorations = (referenceMarkers ?? [])
			.filter((marker) => marker.line >= 1 && marker.line <= model.getLineCount())
			.map((marker) => ({
				range: new monacoInstance.Range(marker.line, 1, marker.line, 1),
				options: {
					isWholeLine: true,
					className: marker.resolved ? 'reusable-line' : 'reusable-line reusable-line--broken',
					linesDecorationsClassName: marker.resolved
						? 'reusable-line-glyph'
						: 'reusable-line-glyph reusable-line-glyph--broken',
					hoverMessage: {
						value: marker.resolved
							? `**Conteúdo reutilizável** \`${marker.id}\`\n\nOrigem: ${
									marker.type === 'block' ? 'bloco em src/content/snippets' : 'página em src/content/docs'
								}. Editar aqui não altera o original — use o painel de referências para abrir a fonte.`
							: `**Referência não encontrada:** \`${marker.id}\``,
					},
				},
			}));

		decorationsRef.current = ed.deltaDecorations(decorationsRef.current, decorations);
	}, [referenceMarkers, mounted]);

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
	}, [errorLine, errorMessage, mounted]);

	/**
	 * Marcadores do linter (§42).
	 *
	 * Vão num "owner" próprio (`linter`), separado do `editor-preview`: assim
	 * um erro de renderização e um aviso editorial coexistem sem que a
	 * atualização de um apague o outro.
	 */
	useEffect(() => {
		const ed = editorRef.current;
		const monacoInstance = monacoRef.current;
		if (!ed || !monacoInstance) return;
		const model = ed.getModel();
		if (!model) return;

		const severityMap: Record<Severity, number> = {
			error: monacoInstance.MarkerSeverity.Error,
			warning: monacoInstance.MarkerSeverity.Warning,
			suggestion: monacoInstance.MarkerSeverity.Info,
			info: monacoInstance.MarkerSeverity.Hint,
		};

		const markers = (lintFindings ?? [])
			.filter((finding) => finding.severity !== 'info')
			.filter((finding) => finding.location.startLine <= model.getLineCount())
			.map((finding) => {
				const line = finding.location.startLine;
				const maxColumn = model.getLineMaxColumn(line);
				return {
					startLineNumber: line,
					startColumn: Math.min(finding.location.startColumn, maxColumn),
					endLineNumber: Math.min(finding.location.endLine ?? line, model.getLineCount()),
					endColumn: Math.min(finding.location.endColumn ?? maxColumn, maxColumn),
					// O id da regra vai no marcador para o autor conseguir
					// silenciá-la sem precisar procurar qual era.
					message: finding.suggestion
						? `${finding.message}

${finding.suggestion}

${finding.ruleId}`
						: `${finding.message}

${finding.ruleId}`,
					severity: severityMap[finding.severity],
					source: 'linter',
				};
			});

		monacoInstance.editor.setModelMarkers(model, 'linter', markers);
	}, [lintFindings, mounted]);

	// Fase 5 — Vim keybindings. `monaco-vim` é carregado sob demanda: quem não
	// usa Vim não paga o download, e ele só existe no browser (usa o DOM direto).
	useEffect(() => {
		const editorInstance = editorRef.current;
		const statusNode = vimStatusRef?.current;
		if (!editorInstance || !vimMode) return;

		let disposed = false;
		let vim: { dispose: () => void } | null = null;

		void import('monaco-vim')
			.then(({ initVimMode }) => {
				if (disposed) return;
				vim = initVimMode(editorInstance, statusNode ?? undefined);
			})
			.catch(() => {
				// Falhar ao carregar o modo Vim não pode derrubar o editor inteiro.
			});

		return () => {
			disposed = true;
			vim?.dispose();
		};
	}, [vimMode, mounted, vimStatusRef]);

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
