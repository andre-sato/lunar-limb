import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Puzzle, Search, Terminal } from 'lucide-react';
import type { ContentRoot, EditorCommand, TreeNode } from './types';

export type PaletteMode = 'commands' | 'files';

interface CommandPaletteProps {
	mode: PaletteMode;
	commands: EditorCommand[];
	docsTree: TreeNode[];
	snippetTree: TreeNode[];
	onClose: () => void;
	onOpenFile: (path: string, root: ContentRoot) => void;
}

interface FileEntry {
	path: string;
	root: ContentRoot;
	title?: string;
}

/**
 * Fase 5 — Command Palette (§38 da especificação).
 *
 * Dois modos no mesmo componente, como no VS Code:
 *  - `files` (Ctrl/Cmd + P): abrir arquivo por nome;
 *  - `commands` (Ctrl/Cmd + Shift + P): executar um comando.
 *
 * Digitar `>` no modo arquivo salta para comandos, e apagar tudo volta — é o
 * gesto que quem usa VS Code já tem no dedo.
 */
export default function CommandPalette({
	mode: initialMode,
	commands,
	docsTree,
	snippetTree,
	onClose,
	onOpenFile,
}: CommandPaletteProps) {
	const [query, setQuery] = useState(initialMode === 'commands' ? '>' : '');
	const [selected, setSelected] = useState(0);
	const listRef = useRef<HTMLDivElement>(null);

	const mode: PaletteMode = query.startsWith('>') ? 'commands' : 'files';
	const term = (mode === 'commands' ? query.slice(1) : query).trim().toLowerCase();

	const files = useMemo(() => {
		const entries: FileEntry[] = [];
		function walk(nodes: TreeNode[], root: ContentRoot) {
			for (const node of nodes) {
				if (node.type === 'file') entries.push({ path: node.path, root, title: node.title });
				else if (node.children) walk(node.children, root);
			}
		}
		walk(docsTree, 'docs');
		walk(snippetTree, 'snippets');
		return entries;
	}, [docsTree, snippetTree]);

	const results = useMemo(() => {
		if (mode === 'commands') {
			return commands.filter((c) => !term || c.label.toLowerCase().includes(term) || c.group.toLowerCase().includes(term));
		}
		return files.filter(
			(f) => !term || f.path.toLowerCase().includes(term) || (f.title ?? '').toLowerCase().includes(term)
		);
	}, [mode, term, commands, files]);

	// Trocar de modo ou de termo reposiciona a seleção no topo.
	useEffect(() => {
		setSelected(0);
	}, [query, mode]);

	useEffect(() => {
		const active = listRef.current?.querySelector('[data-selected="true"]');
		active?.scrollIntoView({ block: 'nearest' });
	}, [selected]);

	function choose(index: number) {
		const item = results[index];
		if (!item) return;

		if (mode === 'commands') {
			const command = item as EditorCommand;
			if (command.enabled === false) return;
			onClose();
			command.run();
		} else {
			const file = item as FileEntry;
			onClose();
			onOpenFile(file.path, file.root);
		}
	}

	function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			setSelected((i) => (results.length === 0 ? 0 : (i + 1) % results.length));
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			setSelected((i) => (results.length === 0 ? 0 : (i - 1 + results.length) % results.length));
		} else if (e.key === 'Enter') {
			e.preventDefault();
			choose(selected);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			onClose();
		}
	}

	return (
		<div className="modal-backdrop modal-backdrop--top" role="presentation" onClick={onClose}>
			<div className="palette" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
				<div className="palette-input">
					{mode === 'commands' ? <Terminal size={15} /> : <Search size={15} />}
					<input
						type="text"
						autoFocus
						value={query}
						placeholder={mode === 'commands' ? 'Digite um comando…' : 'Abrir arquivo por nome… (use > para comandos)'}
						onChange={(e) => setQuery(e.target.value)}
						onKeyDown={onKeyDown}
					/>
				</div>

				<div className="palette-list" ref={listRef}>
					{results.length === 0 && <p className="palette-empty">Nada encontrado.</p>}

					{mode === 'commands'
						? (results as EditorCommand[]).map((command, index) => (
								<button
									key={command.id}
									type="button"
									data-selected={index === selected}
									className={`palette-item${command.enabled === false ? ' palette-item--disabled' : ''}`}
									onMouseEnter={() => setSelected(index)}
									onClick={() => choose(index)}
									disabled={command.enabled === false}
								>
									<span className="palette-group">{command.group}</span>
									<span className="palette-label">{command.label}</span>
									{command.shortcut && <kbd className="palette-shortcut">{command.shortcut}</kbd>}
								</button>
							))
						: (results as FileEntry[]).map((file, index) => (
								<button
									key={`${file.root}:${file.path}`}
									type="button"
									data-selected={index === selected}
									className="palette-item"
									onMouseEnter={() => setSelected(index)}
									onClick={() => choose(index)}
								>
									{file.root === 'snippets' ? <Puzzle size={13} /> : <FileText size={13} />}
									<span className="palette-label">{file.title || file.path}</span>
									<span className="palette-path">{file.path}</span>
								</button>
							))}
				</div>
			</div>
		</div>
	);
}
