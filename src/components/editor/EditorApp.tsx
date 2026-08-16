import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FileExplorer from './FileExplorer';
import MarkdownEditorPane, { type MarkdownEditorHandle, type ReferenceMarker } from './MarkdownEditorPane';
import PreviewPane from './PreviewPane';
import Toolbar from './Toolbar';
import StatusBar from './StatusBar';
import NewFileModal from './NewFileModal';
import FrontmatterPanel from './FrontmatterPanel';
import InsertReusableModal from './InsertReusableModal';
import ExtractReusableModal from './ExtractReusableModal';
import DeleteWarningModal from './DeleteWarningModal';
import ReferencePanel from './ReferencePanel';
import ProblemsPanel from './ProblemsPanel';
import ContentGraphModal from './ContentGraphModal';
import { createFile, deleteFile, fetchFile, fetchGraph, fetchPreview, fetchReferences, fetchTree, saveFile } from './api';
import { useDebouncedCallback } from './useDebouncedCallback';
import { useReferences } from './useReferences';
import { ensureMdxImport, referenceTag } from './insert-helpers';
import { extractReferences, nodeKey, refOf, typeForRoot } from '../../lib/editor/graph-model';
import type {
	ContentRoot,
	CursorPosition,
	ImpactAnalysis,
	ReusableItem,
	SaveStatus,
	ThemeMode,
	TreeNode,
	ViewMode,
} from './types';

const THEME_KEY = 'lunar-limb-editor:theme';

function getInitialTheme(): ThemeMode {
	try {
		const stored = window.localStorage.getItem(THEME_KEY);
		if (stored === 'light' || stored === 'dark') return stored;
	} catch {
		// localStorage can throw in locked-down environments — fall back silently.
	}
	return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function stripFrontmatter(raw: string): string {
	return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

function pathToId(relPath: string): string {
	return relPath.replace(/\.(md|mdx)$/i, '');
}

interface DeleteWarningState {
	path: string;
	root: ContentRoot;
	impact: ImpactAnalysis;
}

export default function EditorApp() {
	const [tree, setTree] = useState<TreeNode[]>([]);
	const [treeLoading, setTreeLoading] = useState(true);
	const [treeError, setTreeError] = useState<string | null>(null);

	const [snippetTree, setSnippetTree] = useState<TreeNode[]>([]);
	const [snippetTreeLoading, setSnippetTreeLoading] = useState(true);

	const [activePath, setActivePath] = useState<string | null>(null);
	const [activeRoot, setActiveRoot] = useState<ContentRoot>('docs');
	const [content, setContent] = useState('');
	const [dirty, setDirty] = useState(false);
	const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
	const [fileLoading, setFileLoading] = useState(false);
	const [fileError, setFileError] = useState<string | null>(null);
	const [referenceRefreshToken, setReferenceRefreshToken] = useState(0);

	const [previewHtml, setPreviewHtml] = useState('');
	const [previewWarning, setPreviewWarning] = useState<string | undefined>(undefined);
	const [previewErrorLine, setPreviewErrorLine] = useState<number | undefined>(undefined);
	const [previewLoading, setPreviewLoading] = useState(false);
	const [docTitle, setDocTitle] = useState<string | undefined>(undefined);

	const [viewMode, setViewMode] = useState<ViewMode>('split');
	const [zen, setZen] = useState(false);
	const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme());
	const [cursor, setCursor] = useState<CursorPosition>({ line: 1, column: 1 });
	const [showNewFileModal, setShowNewFileModal] = useState(false);
	const [showInsertModal, setShowInsertModal] = useState(false);
	const [showExtractModal, setShowExtractModal] = useState(false);
	const [extractSelection, setExtractSelection] = useState<{ text: string; startOffset: number; endOffset: number } | null>(
		null
	);
	const [deleteWarning, setDeleteWarning] = useState<DeleteWarningState | null>(null);
	const [showGraphModal, setShowGraphModal] = useState(false);
	const [globalProblemCount, setGlobalProblemCount] = useState(0);

	const editorHandleRef = useRef<MarkdownEditorHandle>(null);

	// ---- Fase 4: grafo bidirecional do arquivo aberto ---------------------

	const references = useReferences(activePath, activeRoot, referenceRefreshToken);

	const revealLine = useCallback((line: number) => {
		editorHandleRef.current?.revealLine(line);
	}, []);

	/**
	 * As decorações do Monaco vêm do *buffer atual*, não da resposta da API:
	 * enquanto o autor digita, as linhas mudam antes de o arquivo ser salvo, e
	 * a marca precisa acompanhar. A resolução (existe ou não) vem do grafo.
	 */
	const referenceMarkers = useMemo<ReferenceMarker[]>(() => {
		// Só marcamos como quebrada uma referência que o grafo *confirmou* estar
		// quebrada. Uma tag recém-digitada ainda não está no índice (o grafo é
		// construído a partir do arquivo salvo) e não deve piscar em vermelho.
		const brokenIds = new Set(references.uses.filter((ref) => !ref.resolved).map((ref) => `${ref.type}:${ref.id}`));
		return extractReferences(content).map((ref) => ({
			line: ref.location.line,
			id: ref.id,
			type: ref.type,
			resolved: !brokenIds.has(`${ref.type}:${ref.id}`),
		}));
	}, [content, references.uses]);

	// ---- Tree loading -------------------------------------------------

	const refreshTree = useCallback(async () => {
		setTreeLoading(true);
		setTreeError(null);
		try {
			setTree(await fetchTree('docs'));
		} catch (err) {
			setTreeError(err instanceof Error ? err.message : 'Erro ao carregar arquivos.');
		} finally {
			setTreeLoading(false);
		}
	}, []);

	const refreshSnippetTree = useCallback(async () => {
		setSnippetTreeLoading(true);
		try {
			setSnippetTree(await fetchTree('snippets'));
		} catch {
			// Non-critical for the main workflow — the tree simply stays as-is.
		} finally {
			setSnippetTreeLoading(false);
		}
	}, []);

	useEffect(() => {
		void refreshTree();
		void refreshSnippetTree();
	}, [refreshTree, refreshSnippetTree]);

	// ---- Preview --------------------------------------------------------

	const requestPreview = useCallback(async (value: string, path: string | null) => {
		setPreviewLoading(true);
		try {
			const res = await fetchPreview(value, path ?? undefined);
			setPreviewHtml(res.html);
			setPreviewWarning(res.warning);
			setPreviewErrorLine(res.errorLine);
			const title = res.frontmatter?.title;
			setDocTitle(typeof title === 'string' ? title : undefined);
		} catch (err) {
			setPreviewWarning(err instanceof Error ? err.message : 'Erro ao gerar preview.');
			setPreviewErrorLine(undefined);
		} finally {
			setPreviewLoading(false);
		}
	}, []);

	const debouncedPreview = useDebouncedCallback((value: string) => {
		void requestPreview(value, activePath);
	}, 400);

	// ---- Save -------------------------------------------------------------

	const performSave = useCallback(async (value: string, path: string, root: ContentRoot) => {
		setSaveStatus('saving');
		try {
			await saveFile(path, value, root);
			setDirty(false);
			setSaveStatus('saved');
			setReferenceRefreshToken((t) => t + 1);
		} catch {
			setSaveStatus('error');
		}
	}, []);

	const debouncedSave = useDebouncedCallback((value: string) => {
		if (!activePath) return;
		void performSave(value, activePath, activeRoot);
	}, 1000);

	const handleManualSave = useCallback(() => {
		if (!activePath) return;
		debouncedSave.flush(content);
	}, [activePath, content, debouncedSave]);

	// ---- Open / create / delete --------------------------------------------

	const openFile = useCallback(
		async (path: string, root: ContentRoot = 'docs') => {
			if (dirty) {
				const ok = window.confirm(
					'Esta página tem alterações não salvas. Descartar as alterações e abrir outro arquivo?'
				);
				if (!ok) return;
			}
			setFileLoading(true);
			setFileError(null);
			try {
				const doc = await fetchFile(path, root);
				setActivePath(doc.path);
				setActiveRoot(root);
				setContent(doc.content);
				setDirty(false);
				setSaveStatus('saved');
				const title = doc.frontmatter?.title;
				setDocTitle(typeof title === 'string' ? title : undefined);
				void requestPreview(doc.content, root === 'docs' ? doc.path : null);

				const url = new URL(window.location.href);
				url.searchParams.set('path', doc.path);
				if (root === 'snippets') url.searchParams.set('root', root);
				else url.searchParams.delete('root');
				window.history.replaceState({}, '', url);
			} catch (err) {
				setFileError(err instanceof Error ? err.message : 'Erro ao abrir arquivo.');
			} finally {
				setFileLoading(false);
			}
		},
		[dirty, requestPreview]
	);

	// A navegação por id da Fase 3 virou navegação por caminho: o grafo já
	// devolve o arquivo exato de cada ponta da aresta (ver ReferencePanel), então
	// não é mais preciso adivinhar a extensão varrendo a árvore.

	// Deep-link support: /editor?path=guides/getting-started.md[&root=snippets]
	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const initialPath = params.get('path');
		const initialRoot = params.get('root') === 'snippets' ? 'snippets' : 'docs';
		if (initialPath) void openFile(initialPath, initialRoot);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const handleCreate = useCallback(
		async (path: string, initialContent: string) => {
			await createFile(path, initialContent, 'docs');
			await refreshTree();
			setShowNewFileModal(false);
			await openFile(path, 'docs');
		},
		[refreshTree, openFile]
	);

	const performDelete = useCallback(
		async (path: string, root: ContentRoot) => {
			try {
				await deleteFile(path, root);
				if (activePath === path && activeRoot === root) {
					setActivePath(null);
					setContent('');
					setDirty(false);
					setSaveStatus('idle');
					setPreviewHtml('');
					setDocTitle(undefined);
				}
				await refreshTree();
				await refreshSnippetTree();
				// Apagar um arquivo muda o grafo inteiro (pode criar referências
				// quebradas em outras páginas) — força o recarregamento do índice.
				setReferenceRefreshToken((t) => t + 1);
			} catch (err) {
				window.alert(err instanceof Error ? err.message : 'Erro ao excluir arquivo.');
			}
		},
		[activePath, activeRoot, refreshTree, refreshSnippetTree]
	);

	const requestDelete = useCallback(
		async (path: string, root: ContentRoot) => {
			try {
				const refs = await fetchReferences(path, root);
				if (refs.impact.total > 0) {
					setDeleteWarning({ path, root, impact: refs.impact });
					return;
				}
			} catch {
				// If the reference check itself fails, fall back to the plain confirm below
				// rather than silently blocking deletion.
			}
			const ok = window.confirm(`Excluir "${path}"? Esta ação não pode ser desfeita.`);
			if (!ok) return;
			await performDelete(path, root);
		},
		[performDelete]
	);

	// ---- Editing --------------------------------------------------------

	const handleContentChange = useCallback(
		(value: string) => {
			setContent(value);
			setDirty(true);
			setSaveStatus('unsaved');
			debouncedSave.run(value);
			debouncedPreview.run(value);
		},
		[debouncedSave, debouncedPreview]
	);

	// ---- Content reuse: insert / extract -----------------------------------

	const isMdx = activePath?.toLowerCase().endsWith('.mdx') ?? false;

	const handleOpenInsertModal = useCallback(() => {
		if (!activePath) return;
		if (!isMdx) {
			window.alert(
				'Conteúdo reutilizável (<ContentBlock>/<IncludePage>) só funciona em arquivos .mdx — crie ou converta esta página para .mdx antes de inserir.'
			);
			return;
		}
		setShowInsertModal(true);
	}, [activePath, isMdx]);

	const handleInsertReusable = useCallback(
		(item: ReusableItem) => {
			if (!activePath) return;
			const componentName = item.type === 'block' ? 'ContentBlock' : 'IncludePage';
			const tag = referenceTag(componentName, item.id);
			const hadImport = new RegExp(`import\\s+${componentName}\\s+from`).test(content);
			const withImport = ensureMdxImport(content, activePath, componentName);

			let finalContent: string;
			if (hadImport) {
				const lines = withImport.split('\n');
				const at = Math.min(Math.max(cursor.line, 1), lines.length);
				lines.splice(at, 0, '', tag, '');
				finalContent = lines.join('\n');
			} else {
				finalContent = `${withImport.replace(/\n+$/, '')}\n\n${tag}\n`;
			}

			handleContentChange(finalContent);
			setShowInsertModal(false);
		},
		[activePath, content, cursor.line, handleContentChange]
	);

	const handleOpenExtractModal = useCallback(() => {
		if (!activePath) return;
		if (!isMdx) {
			window.alert('Para extrair conteúdo reutilizável, esta página precisa ser .mdx (para receber a referência de volta).');
			return;
		}
		const selection = editorHandleRef.current?.getSelection();
		if (!selection) {
			window.alert('Selecione o trecho que deseja extrair antes de usar este comando.');
			return;
		}
		setExtractSelection(selection);
		setShowExtractModal(true);
	}, [activePath, isMdx]);

	const handleExtract = useCallback(
		async (id: string, title: string) => {
			if (!activePath || !extractSelection) return;

			const snippetPath = `${id}.md`;
			const fmTitle = JSON.stringify(title || id);
			const snippetContent = `---\ntitle: ${fmTitle}\n---\n\n${extractSelection.text.trim()}\n`;
			await createFile(snippetPath, snippetContent, 'snippets');
			await refreshSnippetTree();

			const tag = referenceTag('ContentBlock', id);
			const withImport = ensureMdxImport(content, activePath, 'ContentBlock');
			const importDelta = withImport.length - content.length;
			const newStart = extractSelection.startOffset + importDelta;
			const newEnd = extractSelection.endOffset + importDelta;
			const finalContent = withImport.slice(0, newStart) + tag + withImport.slice(newEnd);

			handleContentChange(finalContent);
			setShowExtractModal(false);
			setExtractSelection(null);
		},
		[activePath, content, extractSelection, handleContentChange, refreshSnippetTree]
	);

	// ---- Theme / Zen ------------------------------------------------------

	const toggleTheme = useCallback(() => {
		setTheme((prev) => {
			const next = prev === 'dark' ? 'light' : 'dark';
			try {
				window.localStorage.setItem(THEME_KEY, next);
			} catch {
				// ignore
			}
			return next;
		});
	}, []);

	const toggleZen = useCallback(() => setZen((z) => !z), []);

	useEffect(() => {
		function onKeydown(e: KeyboardEvent) {
			if (e.key === 'F11') {
				e.preventDefault();
				toggleZen();
			}
		}
		window.addEventListener('keydown', onKeydown);
		return () => window.removeEventListener('keydown', onKeydown);
	}, [toggleZen]);

	useEffect(() => {
		function onBeforeUnload(e: BeforeUnloadEvent) {
			if (dirty) {
				e.preventDefault();
				e.returnValue = '';
			}
		}
		window.addEventListener('beforeunload', onBeforeUnload);
		return () => window.removeEventListener('beforeunload', onBeforeUnload);
	}, [dirty]);

	// ---- Derived values ---------------------------------------------------

	const bodyOnly = useMemo(() => stripFrontmatter(content), [content]);
	const wordCount = useMemo(() => (bodyOnly.trim() ? bodyOnly.trim().split(/\s+/).length : 0), [bodyOnly]);
	const charCount = content.length;
	const languageLabel = isMdx ? 'MDX' : 'Markdown';
	const activeId = activePath ? pathToId(activePath) : null;
	const activeKey = activePath ? nodeKey(activeRoot, activePath) : null;
	const activeRef = activeId ? refOf(typeForRoot(activeRoot), activeId) : undefined;

	// Contador global de problemas no badge da toolbar — atualizado a cada save.
	useEffect(() => {
		let cancelled = false;
		fetchGraph()
			.then((res) => {
				if (!cancelled) setGlobalProblemCount(res.problems.filter((p) => p.severity === 'error').length);
			})
			.catch(() => {
				// O badge é informativo; falhar aqui não deve atrapalhar a edição.
			});
		return () => {
			cancelled = true;
		};
	}, [referenceRefreshToken]);

	// Ctrl/Cmd + Shift + G abre o grafo.
	useEffect(() => {
		function onKeydown(e: KeyboardEvent) {
			if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'g') {
				e.preventDefault();
				setShowGraphModal(true);
			}
		}
		window.addEventListener('keydown', onKeydown);
		return () => window.removeEventListener('keydown', onKeydown);
	}, []);

	return (
		<div className={`app-shell theme-${theme}${zen ? ' zen' : ''}`}>
			<Toolbar
				viewMode={viewMode}
				onViewModeChange={setViewMode}
				zen={zen}
				onToggleZen={toggleZen}
				theme={theme}
				onToggleTheme={toggleTheme}
				saveStatus={saveStatus}
				onSave={handleManualSave}
				activeTitle={docTitle ?? activePath}
				hasActiveFile={Boolean(activePath)}
				onInsertReusable={handleOpenInsertModal}
				onExtractReusable={handleOpenExtractModal}
				onOpenGraph={() => setShowGraphModal(true)}
				problemCount={globalProblemCount}
			/>

			<div className="app-body">
				{!zen && (
					<div className="file-explorer-stack">
						<FileExplorer
							title="Documentação"
							tree={tree}
							activePath={activeRoot === 'docs' ? activePath : null}
							onOpen={(path) => void openFile(path, 'docs')}
							onDelete={(path) => void requestDelete(path, 'docs')}
							onNewFile={() => setShowNewFileModal(true)}
							onRefresh={() => void refreshTree()}
							loading={treeLoading}
						/>
						<FileExplorer
							title="Conteúdo reutilizável"
							tree={snippetTree}
							activePath={activeRoot === 'snippets' ? activePath : null}
							onOpen={(path) => void openFile(path, 'snippets')}
							onDelete={(path) => void requestDelete(path, 'snippets')}
							onRefresh={() => void refreshSnippetTree()}
							loading={snippetTreeLoading}
						/>
					</div>
				)}

				<main className={`workspace workspace--${viewMode}`}>
					{treeError && <div className="banner banner--error">{treeError}</div>}
					{fileError && <div className="banner banner--error">{fileError}</div>}

					{!activePath ? (
						<div className="empty-state">
							{fileLoading ? 'Carregando…' : 'Selecione um arquivo na barra lateral ou crie uma nova página.'}
						</div>
					) : (
						<>
							{(viewMode === 'editor' || viewMode === 'split') && (
								<div className="pane pane-editor">
									<FrontmatterPanel content={content} onChange={handleContentChange} />
									<ReferencePanel
										path={activePath}
										node={references.node}
										uses={references.uses}
										usedBy={references.usedBy}
										impact={references.impact}
										loading={references.loading}
										error={references.error}
										onNavigate={(path, root) => void openFile(path, root)}
										onRevealLine={revealLine}
										onOpenGraph={() => setShowGraphModal(true)}
									/>
									<div className="editor-scroll-area">
										<MarkdownEditorPane
											ref={editorHandleRef}
											value={content}
											language={isMdx ? 'mdx' : 'markdown'}
											theme={theme}
											onChange={handleContentChange}
											onCursorChange={setCursor}
											onSaveShortcut={handleManualSave}
											wordWrap
											minimap={false}
											errorLine={previewErrorLine}
											errorMessage={previewWarning}
											referenceMarkers={referenceMarkers}
										/>
									</div>
									<ProblemsPanel problems={references.problems} onRevealLine={revealLine} />
								</div>
							)}
							{(viewMode === 'preview' || viewMode === 'split') && (
								<div className="pane pane-preview">
									<PreviewPane html={previewHtml} title={docTitle} loading={previewLoading} warning={previewWarning} />
								</div>
							)}
						</>
					)}
				</main>
			</div>

			<StatusBar
				cursor={cursor}
				language={languageLabel}
				wordCount={wordCount}
				charCount={charCount}
				saveStatus={saveStatus}
				visible={Boolean(activePath)}
				problemCount={references.problems.filter((p) => p.severity === 'error').length}
				usedByCount={references.usedBy.length}
				onOpenGraph={() => setShowGraphModal(true)}
			/>

			{showNewFileModal && <NewFileModal onClose={() => setShowNewFileModal(false)} onCreate={handleCreate} />}

			{showInsertModal && (
				<InsertReusableModal
					onClose={() => setShowInsertModal(false)}
					onSelect={handleInsertReusable}
					excludeId={activeId ?? undefined}
					sourceKey={activeKey ?? undefined}
					sourceRoot={activeRoot}
				/>
			)}

			{showExtractModal && extractSelection && (
				<ExtractReusableModal
					selectionPreview={extractSelection.text}
					onClose={() => {
						setShowExtractModal(false);
						setExtractSelection(null);
					}}
					onExtract={handleExtract}
				/>
			)}

			{deleteWarning && (
				<DeleteWarningModal
					path={deleteWarning.path}
					impact={deleteWarning.impact}
					onCancel={() => setDeleteWarning(null)}
					onNavigate={(path, root) => {
						setDeleteWarning(null);
						void openFile(path, root);
					}}
					onConfirm={() => {
						void performDelete(deleteWarning.path, deleteWarning.root);
						setDeleteWarning(null);
					}}
				/>
			)}

			{showGraphModal && (
				<ContentGraphModal
					onClose={() => setShowGraphModal(false)}
					onNavigate={(path, root) => void openFile(path, root)}
					activeRef={activeRef}
				/>
			)}
		</div>
	);
}
