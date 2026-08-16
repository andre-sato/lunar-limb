import { AlertCircle, GitBranch, Network } from 'lucide-react';
import type { CursorPosition, GitState, SaveStatus } from './types';

const GIT_LABEL: Record<GitState, string> = {
	modified: 'modificado',
	added: 'adicionado',
	deleted: 'excluído',
	untracked: 'não versionado',
	renamed: 'renomeado',
};

interface StatusBarProps {
	cursor: CursorPosition;
	language: string;
	wordCount: number;
	charCount: number;
	saveStatus: SaveStatus;
	visible: boolean;
	/** Fase 4: quantos problemas de grafo (erros) o arquivo aberto tem. */
	problemCount?: number;
	/** Fase 4: quantas páginas usam este arquivo. */
	usedByCount?: number;
	onOpenGraph?: () => void;
	/** Fase 5: branch atual, quando há repositório Git. */
	gitBranch?: string;
	/** Fase 5: estado do arquivo aberto no working tree. */
	gitState?: GitState;
	vimMode?: boolean;
}

const statusLabel: Record<SaveStatus, string> = {
	idle: '—',
	unsaved: 'Não salvo',
	saving: 'Salvando…',
	saved: 'Salvo',
	error: 'Erro ao salvar',
};

export default function StatusBar({
	cursor,
	language,
	wordCount,
	charCount,
	saveStatus,
	visible,
	problemCount = 0,
	usedByCount = 0,
	onOpenGraph,
	gitBranch,
	gitState,
	vimMode = false,
}: StatusBarProps) {
	if (!visible) return null;
	return (
		<footer className="status-bar">
			<span>
				Ln {cursor.line}, Col {cursor.column}
			</span>
			<span>{language}</span>
			<span>UTF-8</span>
			<span>{wordCount} palavras</span>
			<span>{charCount} caracteres</span>

			{onOpenGraph && (
				<button type="button" className="status-graph-btn" onClick={onOpenGraph} title="Abrir Content Graph">
					<Network size={12} />
					{usedByCount > 0 ? `usado por ${usedByCount}` : 'grafo'}
				</button>
			)}

			{gitBranch && (
				<span className="status-git" title="Branch atual">
					<GitBranch size={12} /> {gitBranch}
					{gitState && <em> · {GIT_LABEL[gitState]}</em>}
				</span>
			)}

			{vimMode && <span className="status-vim">VIM</span>}

			{problemCount > 0 && (
				<span className="status-problems" title="Problemas de referência neste arquivo">
					<AlertCircle size={12} /> {problemCount}
				</span>
			)}

			<span className={`status-save status-save--${saveStatus}`}>{statusLabel[saveStatus]}</span>
		</footer>
	);
}
