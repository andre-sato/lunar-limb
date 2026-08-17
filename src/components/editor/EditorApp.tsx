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
import LintPanel from './LintPanel';
import { useLint } from './useLint';
import type { LintFinding } from '../../lib/linter/types';
import ContentGraphModal from './ContentGraphModal';
import CommandPalette, { type PaletteMode } from './CommandPalette';
import SearchModal from './SearchModal';
import VariablesModal from './VariablesModal';
import {
	createFile,
	deleteFile,
	fetchFile,
	fetchGitStatus,
	fetchGraph,
	fetchPreview,
	fetchReferences,
	fetchTree,
	saveFile,
	type MirrorReport,
} from './api';
import { useDebouncedCallback } from './useDebouncedCallback';
import { useReferences } from './useReferences';
import { conditionalBlock, detachReferenceAt, ensureMdxImport, referenceTag } from './insert-helpers';
import { extractReferences, nodeKey, refOf, typeForRoot } from '../../lib/editor/graph-model';
import { hasPublicPage, pageUrlFor } from '../../lib/editor/page-url';
import { splitContent } from './frontmatter';
import type {
	ContentRoot,
	CursorPosition,
	EditorCommand,
	GitStatusMap,
	ImpactAnalysis,
	ReusableItem,
	SaveStatus,
	ThemeMode,
	TreeNode,
	ViewMode,
} from './types';

const THEME_KEY = 'lunar-limb-editor:theme';
const VIM_KEY = 'lunar-limb-editor:vim';

function getInitialVim(): boolean {
	try {
		return window.localStorage.getItem(VIM_KEY) === '1';
	} catch {
		return false;
	}
}

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

/** Resume o espelhamento de idiomas em uma frase, ou `null` se não houve. */
function describeMirrors(mirrors: MirrorReport | null | undefined): string | null {
	if (!mirrors) return null;

	const parts: string[] = [];
	if (mirrors.created.length > 0) {
		parts.push(`Criadas as entradas em ${mirrors.created.join(' e ')} (tradução pendente).`);
	}
	if (mirrors.skipped.length > 0) {
		parts.push(`Já existia: ${mirrors.skipped.join(', ')}.`);
	}
	// Falha é o caso que mais precisa aparecer: a página existe em português e
	// não nos outros idiomas, e ninguém descobriria isso sem o aviso.
	for (const failure of mirrors.failed) {
		parts.push(`Não foi possível criar ${failure.path}: ${failure.reason}`);
	}

	return parts.length > 0 ? parts.join(' ') : null;
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
	const [notice, setNotice] = useState<string | null>(null);
	/** Resultado do espelhamento nos outros idiomas, após criar uma página. */
	const [mirrorNotice, setMirrorNotice] = useState<string | null>(null);
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

	// ---- Fase 5 -----------------------------------------------------------
	const [paletteMode, setPaletteMode] = useState<PaletteMode | null>(null);
	const [showSearch, setShowSearch] = useState(false);
	const [showVariables, setShowVariables] = useState(false);
	const [vimMode, setVimMode] = useState<boolean>(() => getInitialVim());
	const [gitStatus, setGitStatus] = useState<GitStatusMap | null>(null);
	const [previewHiddenReason, setPreviewHiddenReason] = useState<'visible-false' | 'condition-off' | null>(null);
	const [unknownFlags, setUnknownFlags] = useState<string[]>([]);

	const editorHandleRef = useRef<MarkdownEditorHandle>(null);
	const vimStatusRef = useRef<HTMLDivElement>(null);

	// ---- Fase 4: grafo bidirecional do arquivo aberto ---------------------

	const references = useReferences(activePath, activeRoot, referenceRefreshToken);
	const lint = useLint(activePath, content);

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

	const refreshGitStatus = useCallback(async () => {
		try {
			setGitStatus(await fetchGitStatus());
		} catch {
			// Git awareness é enfeite: sem repositório, o editor segue igual.
		}
	}, []);

	useEffect(() => {
		void refreshTree();
		void refreshSnippetTree();
		void refreshGitStatus();
	}, [refreshTree, refreshSnippetTree, refreshGitStatus]);

	// ---- Preview --------------------------------------------------------

	const requestPreview = useCallback(async (value: string, path: string | null, root: ContentRoot) => {
		setPreviewLoading(true);
		try {
			const res = await fetchPreview(value, path, root);
			setPreviewHtml(res.html);
			setPreviewWarning(res.warning);
			setPreviewErrorLine(res.errorLine);
			setPreviewHiddenReason(res.hiddenReason ?? null);
			setUnknownFlags([...new Set((res.conditionalIssues ?? []).map((issue) => issue.flag))]);
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
		void requestPreview(value, activePath, activeRoot);
	}, 400);

	// ---- Save -------------------------------------------------------------

	const performSave = useCallback(async (value: string, path: string, root: ContentRoot): Promise<boolean> => {
		setSaveStatus('saving');
		try {
			await saveFile(path, value, root);
			setDirty(false);
			setSaveStatus('saved');
			setReferenceRefreshToken((t) => t + 1);
			void refreshGitStatus();
			return true;
		} catch {
			setSaveStatus('error');
			return false;
		}
	}, [refreshGitStatus]);

	const debouncedSave = useDebouncedCallback((value: string) => {
		if (!activePath) return;
		void performSave(value, activePath, activeRoot);
	}, 1000);

	const handleManualSave = useCallback(() => {
		if (!activePath) return;
		debouncedSave.flush(content);
	}, [activePath, content, debouncedSave]);

	/**
	 * Salvar e sair, o comportamento do botão de disquete.
	 *
	 * O atalho Ctrl+S e o comando da paleta continuam salvando sem sair: quem
	 * escreve aperta Ctrl+S por reflexo no meio do texto, e navegar para fora
	 * nesse momento interromperia a edição.
	 *
	 * A navegação só acontece depois da confirmação do servidor. Sair com o
	 * salvamento em voo poderia perder a escrita, e o `dirty` já foi zerado —
	 * o aviso de alterações não salvas não protegeria.
	 */
	const handleSaveAndOpen = useCallback(async () => {
		if (!activePath) return;

		debouncedSave.cancel();
		const saved = await performSave(content, activePath, activeRoot);
		if (!saved) return;

		if (!hasPublicPage(activeRoot)) {
			// Bloco reutilizável não tem página própria: salva e fica onde está,
			// em vez de adivinhar qual das páginas que o consomem abrir.
			setNotice('Bloco salvo. Blocos reutilizáveis não têm página própria — abra uma das páginas que o usam.');
			return;
		}

		const { frontmatter } = splitContent(content);
		window.location.href = pageUrlFor(activePath, frontmatter);
	}, [activePath, activeRoot, content, debouncedSave, performSave]);

	// ---- Open / create / delete --------------------------------------------

	const openFile = useCallback(
		async (path: string, root: ContentRoot = 'docs', revealAtLine?: number) => {
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
				void requestPreview(doc.content, doc.path, root);

				// Vindo da busca global: o Monaco só tem o conteúdo novo depois do
				// próximo render, por isso o reveal fica para o fim da fila.
				if (revealAtLine) {
					window.setTimeout(() => editorHandleRef.current?.revealLine(revealAtLine), 0);
				}

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
			const result = await createFile(path, initialContent, 'docs');
			await refreshTree();
			setShowNewFileModal(false);
			await openFile(path, 'docs');

			// O espelhamento é silencioso demais para ficar sem aviso: quem cria
			// a página precisa saber que outras duas apareceram na árvore.
			setMirrorNotice(describeMirrors(result.mirrors));
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
				void refreshGitStatus();
			} catch (err) {
				window.alert(err instanceof Error ? err.message : 'Erro ao excluir arquivo.');
			}
		},
		[activePath, activeRoot, refreshTree, refreshSnippetTree, refreshGitStatus]
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

	/**
	 * Aplica uma correção do linter no buffer (§43).
	 *
	 * Só chega aqui quem tem `fix`, e `fix` só existe em regras cuja correção é
	 * mecânica — trocar "allow" por "allows", remover um espaço duplicado. As
	 * sugestões subjetivas ("prefira a voz ativa") não têm botão: a §43 é
	 * explícita em não alterar o texto automaticamente nesses casos.
	 *
	 * A substituição usa o buffer atual, não o texto que o servidor analisou:
	 * se o autor editou desde então, o intervalo pode ter deixado de casar, e
	 * nesse caso a correção é abandonada em vez de corromper a linha.
	 */
	const applyLintFix = useCallback(
		(finding: LintFinding) => {
			if (!finding.fix) return;

			const lines = content.split('\n');
			const index = finding.location.startLine - 1;
			const line = lines[index];
			if (line === undefined) return;

			const start = finding.location.startColumn - 1;
			const end = (finding.location.endColumn ?? finding.location.startColumn) - 1;
			if (start < 0 || end > line.length || end < start) return;

			let replacement = finding.fix.replacement;
			// Remoção total deixaria espaço duplo onde havia " palavra ".
			if (replacement === '') {
				const before = line.slice(0, start);
				const after = line.slice(end);
				lines[index] = (before + after).replace(/ {2,}/g, ' ').replace(/\s+([,.;:!?])/g, '$1');
			} else {
				lines[index] = line.slice(0, start) + replacement + line.slice(end);
			}

			handleContentChange(lines.join('\n'));
		},
		[content, handleContentChange]
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

			// .mdx desde a Fase 5: um snippet extraído pode precisar, ele mesmo, de
			// <ContentBlock> ou <If> depois — criar em .md obrigaria a renomear na mão.
			const snippetPath = `${id}.mdx`;
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

	// ---- Fase 5: Detach ---------------------------------------------------

	/**
	 * Transforma uma referência de volta em texto local (§28 da especificação).
	 * Explicitamente acionado pelo autor, com confirmação: depois disso a página
	 * deixa de acompanhar mudanças no conteúdo canônico.
	 */
	const handleDetach = useCallback(async () => {
		if (!activePath) return;

		const refs = extractReferences(content);
		if (refs.length === 0) {
			window.alert('Esta página não tem nenhuma referência a conteúdo reutilizável.');
			return;
		}

		// A referência da linha do cursor, ou a primeira, se o cursor não estiver em uma.
		const target = refs.find((ref) => ref.location.line === cursor.line) ?? refs[0];

		const ok = window.confirm(
			`Converter "${target.id}" em texto local?\n\n` +
				'O conteúdo é copiado para dentro desta página. Mudanças futuras no ' +
				'conteúdo original deixam de chegar aqui.'
		);
		if (!ok) return;

		try {
			const sourceRoot: ContentRoot = target.type === 'block' ? 'snippets' : 'docs';
			// O id não carrega a extensão; tenta as duas, como o resolver do preview.
			let body: string | null = null;
			for (const candidate of [`${target.id}.md`, `${target.id}.mdx`]) {
				try {
					const doc = await fetchFile(candidate, sourceRoot);
					body = doc.body;
					break;
				} catch {
					// tenta a outra extensão
				}
			}

			if (body === null) {
				window.alert(`Não encontrei o conteúdo original de "${target.id}".`);
				return;
			}

			handleContentChange(detachReferenceAt(content, target.location.offset, target.raw.length, body));
		} catch (err) {
			window.alert(err instanceof Error ? err.message : 'Erro ao destacar o conteúdo.');
		}
	}, [activePath, content, cursor.line, handleContentChange]);

	// ---- Fase 5: condicionais ----------------------------------------------

	const handleInsertConditional = useCallback(() => {
		if (!activePath) return;
		if (!isMdx) {
			window.alert('Condicionais (<If>) só funcionam em arquivos .mdx.');
			return;
		}

		const flag = window.prompt('Nome da variável que controla este trecho:', 'beta');
		if (!flag || flag.trim() === '') return;

		const selection = editorHandleRef.current?.getSelection();
		const block = conditionalBlock(flag.trim(), selection?.text ?? '');
		const withImport = ensureMdxImport(content, activePath, 'If');
		const importDelta = withImport.length - content.length;

		let finalContent: string;
		if (selection) {
			// Envolve a seleção, ajustando os offsets pelo import recém-inserido.
			finalContent =
				withImport.slice(0, selection.startOffset + importDelta) +
				block +
				withImport.slice(selection.endOffset + importDelta);
		} else {
			const lines = withImport.split('\n');
			const at = Math.min(Math.max(cursor.line, 1), lines.length);
			lines.splice(at, 0, '', block, '');
			finalContent = lines.join('\n');
		}

		handleContentChange(finalContent);
	}, [activePath, content, cursor.line, handleContentChange, isMdx]);

	const handleVariablesSaved = useCallback(() => {
		// As condicionais são reavaliadas no servidor: basta pedir o preview de novo.
		if (activePath) void requestPreview(content, activePath, activeRoot);
	}, [activePath, activeRoot, content, requestPreview]);

	// ---- Theme / Zen ------------------------------------------------------

	const toggleVim = useCallback(() => {
		setVimMode((prev) => {
			const next = !prev;
			try {
				window.localStorage.setItem(VIM_KEY, next ? '1' : '0');
			} catch {
				// ignore
			}
			return next;
		});
	}, []);

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

	// Atalhos globais da Fase 5. Ficam em um único listener em `capture` porque o
	// Monaco engole boa parte das combinações antes de elas chegarem ao window.
	useEffect(() => {
		function onKeydown(e: KeyboardEvent) {
			const mod = e.ctrlKey || e.metaKey;
			const key = e.key.toLowerCase();

			if (e.key === 'F11') {
				e.preventDefault();
				toggleZen();
				return;
			}
			if (!mod) return;

			if (e.shiftKey && key === 'z') {
				e.preventDefault();
				toggleZen();
			} else if (e.shiftKey && key === 'p') {
				e.preventDefault();
				setPaletteMode('commands');
			} else if (!e.shiftKey && key === 'p') {
				e.preventDefault();
				setPaletteMode('files');
			} else if (e.shiftKey && key === 'f') {
				e.preventDefault();
				setShowSearch(true);
			} else if (e.shiftKey && key === 'v') {
				e.preventDefault();
				setShowVariables(true);
			}
		}
		window.addEventListener('keydown', onKeydown, true);
		return () => window.removeEventListener('keydown', onKeydown, true);
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
		window.addEventListener('keydown', onKeydown, true);
		return () => window.removeEventListener('keydown', onKeydown, true);
	}, []);

	// ---- Fase 5: comandos da paleta ---------------------------------------

	const commands = useMemo<EditorCommand[]>(() => {
		const hasFile = Boolean(activePath);
		return [
			{ id: 'file.new', label: 'Criar página', group: 'Arquivo', run: () => setShowNewFileModal(true) },
			{
				id: 'file.save',
				label: 'Salvar',
				group: 'Arquivo',
				shortcut: 'Ctrl+S',
				enabled: hasFile,
				run: handleManualSave,
			},
			{ id: 'file.open', label: 'Abrir arquivo', group: 'Arquivo', shortcut: 'Ctrl+P', run: () => setPaletteMode('files') },
			{
				id: 'search.content',
				label: 'Buscar em todo o conteúdo',
				group: 'Buscar',
				shortcut: 'Ctrl+Shift+F',
				run: () => setShowSearch(true),
			},
			{
				id: 'insert.reusable',
				label: 'Inserir conteúdo reutilizável',
				group: 'Inserir',
				enabled: hasFile,
				run: handleOpenInsertModal,
			},
			{
				id: 'insert.conditional',
				label: 'Inserir bloco condicional',
				group: 'Inserir',
				enabled: hasFile,
				run: handleInsertConditional,
			},
			{
				id: 'content.extract',
				label: 'Extrair seleção para conteúdo reutilizável',
				group: 'Conteúdo',
				enabled: hasFile,
				run: handleOpenExtractModal,
			},
			{
				id: 'content.detach',
				label: 'Destacar referência (virar texto local)',
				group: 'Conteúdo',
				enabled: hasFile,
				run: () => void handleDetach(),
			},
			{
				id: 'content.variables',
				label: 'Gerenciar variáveis de conteúdo',
				group: 'Conteúdo',
				shortcut: 'Ctrl+Shift+V',
				run: () => setShowVariables(true),
			},
			{
				id: 'graph.show',
				label: 'Mostrar Content Graph (referências e backlinks)',
				group: 'Conteúdo',
				shortcut: 'Ctrl+Shift+G',
				run: () => setShowGraphModal(true),
			},
			{ id: 'view.split', label: 'Ver: editor + preview', group: 'Ver', run: () => setViewMode('split') },
			{ id: 'view.editor', label: 'Ver: apenas editor', group: 'Ver', run: () => setViewMode('editor') },
			{ id: 'view.preview', label: 'Ver: apenas preview', group: 'Ver', run: () => setViewMode('preview') },
			{ id: 'view.zen', label: 'Alternar modo Zen', group: 'Ver', shortcut: 'F11', run: toggleZen },
			{ id: 'view.theme', label: 'Alternar tema claro/escuro', group: 'Ver', run: toggleTheme },
			{
				id: 'view.vim',
				label: vimMode ? 'Desligar keybindings do Vim' : 'Ligar keybindings do Vim',
				group: 'Ver',
				run: toggleVim,
			},
		];
	}, [
		activePath,
		handleDetach,
		handleInsertConditional,
		handleManualSave,
		handleOpenExtractModal,
		handleOpenInsertModal,
		toggleTheme,
		toggleVim,
		toggleZen,
		vimMode,
	]);

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
				onSave={() => void handleSaveAndOpen()}
				activeTitle={docTitle ?? activePath}
				hasActiveFile={Boolean(activePath)}
				onInsertReusable={handleOpenInsertModal}
				onExtractReusable={handleOpenExtractModal}
				onOpenGraph={() => setShowGraphModal(true)}
				problemCount={globalProblemCount}
				onInsertConditional={handleInsertConditional}
				onOpenVariables={() => setShowVariables(true)}
				onOpenCommands={() => setPaletteMode('commands')}
				onOpenSearch={() => setShowSearch(true)}
				vimMode={vimMode}
				onToggleVim={toggleVim}
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
							gitStatus={gitStatus?.docs}
						/>
						<FileExplorer
							title="Conteúdo reutilizável"
							tree={snippetTree}
							activePath={activeRoot === 'snippets' ? activePath : null}
							onOpen={(path) => void openFile(path, 'snippets')}
							onDelete={(path) => void requestDelete(path, 'snippets')}
							onRefresh={() => void refreshSnippetTree()}
							loading={snippetTreeLoading}
							gitStatus={gitStatus?.snippets}
						/>
					</div>
				)}

				<main className={`workspace workspace--${viewMode}`}>
					{treeError && <div className="banner banner--error">{treeError}</div>}
					{fileError && <div className="banner banner--error">{fileError}</div>}
					{notice && <div className="banner banner--info">{notice}</div>}
					{mirrorNotice && <div className="banner banner--info">{mirrorNotice}</div>}

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
											lintFindings={lint.result?.findings}
											vimMode={vimMode}
											vimStatusRef={vimStatusRef}
										/>
									</div>
									{vimMode && <div className="vim-status" ref={vimStatusRef} />}
									<ProblemsPanel problems={references.problems} onRevealLine={revealLine} />
								<LintPanel
									result={lint.result}
									running={lint.running}
									error={lint.error}
									onRevealLine={revealLine}
									onApplyFix={applyLintFix}
								/>
								</div>
							)}
							{(viewMode === 'preview' || viewMode === 'split') && (
								<div className="pane pane-preview">
									<PreviewPane
										html={previewHtml}
										title={docTitle}
										loading={previewLoading}
										warning={previewWarning}
										hiddenReason={previewHiddenReason}
										unknownFlags={unknownFlags}
										onOpenVariables={() => setShowVariables(true)}
									/>
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
				gitBranch={gitStatus?.available ? gitStatus.branch : undefined}
				gitState={activePath ? gitStatus?.[activeRoot]?.[activePath] : undefined}
				vimMode={vimMode}
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

			{paletteMode && (
				<CommandPalette
					mode={paletteMode}
					commands={commands}
					docsTree={tree}
					snippetTree={snippetTree}
					onClose={() => setPaletteMode(null)}
					onOpenFile={(path, root) => void openFile(path, root)}
				/>
			)}

			{showSearch && (
				<SearchModal
					onClose={() => setShowSearch(false)}
					onOpenHit={(path, root, line) => void openFile(path, root, line)}
				/>
			)}

			{showVariables && <VariablesModal onClose={() => setShowVariables(false)} onSaved={handleVariablesSaved} />}
		</div>
	);
}
