import { AlertCircle, Network } from 'lucide-react';
import type { CursorPosition, SaveStatus } from './types';

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

			{problemCount > 0 && (
				<span className="status-problems" title="Problemas de referência neste arquivo">
					<AlertCircle size={12} /> {problemCount}
				</span>
			)}

			<span className={`status-save status-save--${saveStatus}`}>{statusLabel[saveStatus]}</span>
		</footer>
	);
}
