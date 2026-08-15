import { Columns2, PenLine, Eye, Maximize2, Minimize2, Sun, Moon, Save } from 'lucide-react';
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
					<span className={`save-status save-status--${saveStatus}`}>{statusLabel[saveStatus]}</span>
				)}
				<button
					type="button"
					className="icon-btn"
					disabled={!hasActiveFile || saveStatus === 'saving'}
					onClick={onSave}
					title="Salvar (Cmd/Ctrl+S)"
				>
					<Save size={16} />
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
