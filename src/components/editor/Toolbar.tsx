import {
	Columns2,
	PenLine,
	Eye,
	Maximize2,
	Minimize2,
	Sun,
	Moon,
	Save,
	Component,
	Scissors,
	Network,
	GitBranch,
	GitPullRequest,
	Search,
	SlidersHorizontal,
	Terminal,
} from 'lucide-react';
import type { SaveStatus, ThemeMode, ViewMode } from './types';

interface ToolbarProps {
	viewMode: ViewMode;
	onViewModeChange: (mode: ViewMode) => void;
	zen: boolean;
	onToggleZen: () => void;
	theme: ThemeMode;
	onToggleTheme: () => void;
	saveStatus: SaveStatus;
	onSave: () => void;
	activeTitle: string | null;
	hasActiveFile: boolean;
	onInsertReusable: () => void;
	onExtractReusable: () => void;
	/** Fase 4: abre o Content Graph (Ctrl/Cmd + Shift + G). */
	onOpenGraph: () => void;
	onOpenGit: () => void;
	/** Branch atual, mostrada ao lado do botão. */
	branch?: string;
	/** Fase 4: total de problemas de referência no projeto, para o badge. */
	problemCount?: number;
	/** Fase 5 */
	onInsertConditional: () => void;
	onOpenVariables: () => void;
	onOpenCommands: () => void;
	onOpenSearch: () => void;
	vimMode: boolean;
	onToggleVim: () => void;
}

const statusLabel: Record<SaveStatus, string> = {
	idle: '',
	unsaved: 'Não salvo',
	saving: 'Salvando…',
	saved: 'Salvo',
	error: 'Erro ao salvar',
};

export default function Toolbar({
	viewMode,
	onViewModeChange,
	zen,
	onToggleZen,
	theme,
	onToggleTheme,
	saveStatus,
	onSave,
	activeTitle,
	hasActiveFile,
	onInsertReusable,
	onExtractReusable,
	onOpenGraph,
	onOpenGit,
	branch,
	problemCount = 0,
	onInsertConditional,
	onOpenVariables,
	onOpenCommands,
	onOpenSearch,
	vimMode,
	onToggleVim,
}: ToolbarProps) {
	return (
		<header className="toolbar">
			<div className="toolbar-left">
				<span className="toolbar-brand">lunar-limb · editor</span>
				{activeTitle && <span className="toolbar-doc-title">{activeTitle}</span>}
			</div>

			<div className="toolbar-center">
				<div className="view-switch" role="group" aria-label="Modo de visualização">
					<button
						type="button"
						className={viewMode === 'editor' ? 'active' : ''}
						onClick={() => onViewModeChange('editor')}
						title="Apenas editor"
					>
						<PenLine size={15} />
					</button>
					<button
						type="button"
						className={viewMode === 'split' ? 'active' : ''}
						onClick={() => onViewModeChange('split')}
						title="Editor + Preview"
					>
						<Columns2 size={15} />
					</button>
					<button
						type="button"
						className={viewMode === 'preview' ? 'active' : ''}
						onClick={() => onViewModeChange('preview')}
						title="Apenas preview"
					>
						<Eye size={15} />
					</button>
				</div>
			</div>

			<div className="toolbar-right">
				{hasActiveFile && (
					<>
						<button type="button" className="icon-btn" onClick={onInsertReusable} title="Inserir conteúdo reutilizável">
							<Component size={16} />
						</button>
						<button type="button" className="icon-btn" onClick={onExtractReusable} title="Extrair seleção para conteúdo reutilizável">
							<Scissors size={16} />
						</button>
						<button
							type="button"
							className="icon-btn"
							onClick={onInsertConditional}
							title="Inserir bloco condicional (<If>)"
						>
							<GitBranch size={16} />
						</button>
					</>
				)}
				<button type="button" className="icon-btn" onClick={onOpenSearch} title="Buscar em todo o conteúdo (Ctrl/Cmd+Shift+F)">
					<Search size={16} />
				</button>
				<button
					type="button"
					className="icon-btn"
					onClick={onOpenVariables}
					title="Variáveis de conteúdo (Ctrl/Cmd+Shift+V)"
				>
					<SlidersHorizontal size={16} />
				</button>
				<button
					type="button"
					className="icon-btn"
					onClick={onOpenCommands}
					title="Command Palette (Ctrl/Cmd+Shift+P)"
				>
					<Terminal size={16} />
				</button>
				<button
					type="button"
					className={`icon-btn${problemCount > 0 ? ' icon-btn--badged' : ''}`}
					onClick={onOpenGraph}
					title="Content Graph (Ctrl/Cmd + Shift + G)"
				>
					<Network size={16} />
					{problemCount > 0 && <span className="icon-badge">{problemCount}</span>}
				</button>
				{hasActiveFile && (
					<span className={`save-status save-status--${saveStatus}`}>{statusLabel[saveStatus]}</span>
				)}
				<button
					type="button"
					className="icon-btn icon-btn--labelled"
					onClick={onOpenGit}
					title="Branch, alterações e pull request"
				>
					<GitPullRequest size={16} />
					{branch && <span className="toolbar-branch">{branch}</span>}
				</button>
				<button
					type="button"
					className="icon-btn"
					disabled={!hasActiveFile || saveStatus === 'saving'}
					onClick={onSave}
					title="Salvar e abrir a página (Cmd/Ctrl+S salva sem sair)"
				>
					<Save size={16} />
				</button>
				<button
					type="button"
					className={`icon-btn${vimMode ? ' icon-btn--on' : ''}`}
					onClick={onToggleVim}
					title={vimMode ? 'Desligar keybindings do Vim' : 'Ligar keybindings do Vim'}
				>
					<span className="vim-toggle-label">VIM</span>
				</button>
				<button type="button" className="icon-btn" onClick={onToggleTheme} title="Alternar tema">
					{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
				</button>
				<button type="button" className="icon-btn" onClick={onToggleZen} title="Modo Zen (F11)">
					{zen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
				</button>
			</div>
		</header>
	);
}
