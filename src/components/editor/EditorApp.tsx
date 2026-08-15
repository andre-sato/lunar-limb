import { useCallback, useEffect, useMemo, useState } from 'react';
import FileExplorer from './FileExplorer';
import MarkdownEditorPane from './MarkdownEditorPane';
import PreviewPane from './PreviewPane';
import Toolbar from './Toolbar';
import StatusBar from './StatusBar';
import NewFileModal from './NewFileModal';
import { createFile, deleteFile, fetchFile, fetchPreview, fetchTree, saveFile } from './api';
import { useDebouncedCallback } from './useDebouncedCallback';
import type { CursorPosition, SaveStatus, ThemeMode, TreeNode, ViewMode } from './types';

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

export default function EditorApp() {
	const [tree, setTree] = useState<TreeNode[]>([]);
	const [treeLoading, setTreeLoading] = useState(true);
	const [treeError, setTreeError] = useState<string | null>(null);

	const [activePath, setActivePath] = useState<string | null>(null);
	const [content, setContent] = useState('');
	const [dirty, setDirty] = useState(false);
	const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
	const [fileLoading, setFileLoading] = useState(false);
	const [fileError, setFileError] = useState<string | null>(null);

	const [previewHtml, setPreviewHtml] = useState('');
	const [previewWarning, setPreviewWarning] = useState<string | undefined>(undefined);
	const [previewLoading, setPreviewLoading] = useState(false);
	const [docTitle, setDocTitle] = useState<string | undefined>(undefined);

	const [viewMode, setViewMode] = useState<ViewMode>('split');
	const [zen, setZen] = useState(false);
	const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme());
	const [cursor, setCursor] = useState<CursorPosition>({ line: 1, column: 1 });
	const [showNewFileModal, setShowNewFileModal] = useState(false);

	// ---- Tree loading -------------------------------------------------

	const refreshTree = useCallback(async () => {
		setTreeLoading(true);
		setTreeError(null);
		try {
			const nodes = await fetchTree();
			setTree(nodes);
		} catch (err) {
			setTreeError(err instanceof Error ? err.message : 'Erro ao carregar arquivos.');
		} finally {
			setTreeLoading(false);
		}
	}, []);

	useEffect(() => {
		void refreshTree();
	}, [refreshTree]);

	// ---- Preview --------------------------------------------------------

	const requestPreview = useCallback(async (value: string) => {
		setPreviewLoading(true);
		try {
			const res = await fetchPreview(value);
			setPreviewHtml(res.html);
			setPreviewWarning(res.warning);
			const title = res.frontmatter?.title;
			setDocTitle(typeof title === 'string' ? title : undefined);
		} catch (err) {
			setPreviewWarning(err instanceof Error ? err.message : 'Erro ao gerar preview.');
		} finally {
			setPreviewLoading(false);
		}
	}, []);

	const debouncedPreview = useDebouncedCallback((value: string) => {
		void requestPreview(value);
	}, 400);

	// ---- Save -------------------------------------------------------------

	const performSave = useCallback(async (value: string, path: string) => {
		setSaveStatus('saving');
		try {
			await saveFile(path, value);
			setDirty(false);
			setSaveStatus('saved');
		} catch {
			setSaveStatus('error');
		}
	}, []);

	const debouncedSave = useDebouncedCallback((value: string) => {
		if (!activePath) return;
		void performSave(value, activePath);
	}, 1000);

	const handleManualSave = useCallback(() => {
		if (!activePath) return;
		debouncedSave.flush(content);
	}, [activePath, content, debouncedSave]);

	// ---- Open / create / delete --------------------------------------------

	const openFile = useCallback(
		async (path: string) => {
			if (dirty) {
				const ok = window.confirm(
					'Esta página tem alterações não salvas. Descartar as alterações e abrir outro arquivo?'
				);
				if (!ok) return;
			}
			setFileLoading(true);
			setFileError(null);
			try {
				const doc = await fetchFile(path);
				setActivePath(doc.path);
				setContent(doc.content);
				setDirty(false);
				setSaveStatus('saved');
				const title = doc.frontmatter?.title;
				setDocTitle(typeof title === 'string' ? title : undefined);
				void requestPreview(doc.content);

				const url = new URL(window.location.href);
				url.searchParams.set('path', doc.path);
				window.history.replaceState({}, '', url);
			} catch (err) {
				setFileError(err instanceof Error ? err.message : 'Erro ao abrir arquivo.');
			} finally {
				setFileLoading(false);
			}
		},
		[dirty, requestPreview]
	);

	// Deep-link support: /editor?path=guides/getting-started.md
	useEffect(() => {
		const initialPath = new URLSearchParams(window.location.search).get('path');
		if (initialPath) void openFile(initialPath);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const handleCreate = useCallback(
		async (path: string, initialContent: string) => {
			await createFile(path, initialContent);
			await refreshTree();
			setShowNewFileModal(false);
			await openFile(path);
		},
		[refreshTree, openFile]
	);

	const handleDelete = useCallback(
		async (path: string) => {
			const ok = window.confirm(`Excluir "${path}"? Esta ação não pode ser desfeita.`);
			if (!ok) return;
			try {
				await deleteFile(path);
				if (activePath === path) {
					setActivePath(null);
					setContent('');
					setDirty(false);
					setSaveStatus('idle');
					setPreviewHtml('');
					setDocTitle(undefined);
				}
				await refreshTree();
			} catch (err) {
				window.alert(err instanceof Error ? err.message : 'Erro ao excluir arquivo.');
			}
		},
		[activePath, refreshTree]
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
	const isMdx = activePath?.endsWith('.mdx') ?? false;
	const languageLabel = isMdx ? 'MDX' : 'Markdown';

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
			/>

			<div className="app-body">
				{!zen && (
					<FileExplorer
						tree={tree}
						activePath={activePath}
						onOpen={(path) => void openFile(path)}
						onDelete={(path) => void handleDelete(path)}
						onNewFile={() => setShowNewFileModal(true)}
						onRefresh={() => void refreshTree()}
						loading={treeLoading}
					/>
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
									<MarkdownEditorPane
										value={content}
										language={isMdx ? 'mdx' : 'markdown'}
										theme={theme}
										onChange={handleContentChange}
										onCursorChange={setCursor}
										onSaveShortcut={handleManualSave}
										wordWrap
										minimap={false}
									/>
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
			/>

			{showNewFileModal && <NewFileModal onClose={() => setShowNewFileModal(false)} onCreate={handleCreate} />}
		</div>
	);
}
