import type { CursorPosition, SaveStatus } from './types';

interface StatusBarProps {
	cursor: CursorPosition;
	language: string;
	wordCount: number;
	charCount: number;
	saveStatus: SaveStatus;
	visible: boolean;
}

const statusLabel: Record<SaveStatus, string> = {
	idle: '—',
	unsaved: 'Não salvo',
	saving: 'Salvando…',
	saved: 'Salvo',
	error: 'Erro ao salvar',
};

export default function StatusBar({ cursor, language, wordCount, charCount, saveStatus, visible }: StatusBarProps) {
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
			<span className={`status-save status-save--${saveStatus}`}>{statusLabel[saveStatus]}</span>
		</footer>
	);
}
