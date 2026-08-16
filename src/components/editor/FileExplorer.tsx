import { useState } from 'react';
import {
	ChevronRight,
	ChevronDown,
	Folder,
	FolderOpen,
	FileText,
	FilePlus,
	Trash2,
	RefreshCw,
} from 'lucide-react';
import type { GitState, TreeNode } from './types';

interface FileExplorerProps {
	title: string;
	tree: TreeNode[];
	activePath: string | null;
	onOpen: (path: string) => void;
	onDelete: (path: string) => void;
	onNewFile?: () => void;
	onRefresh: () => void;
	loading: boolean;
	/** Fase 5: estado no Git por caminho, relativo à raiz desta collection. */
	gitStatus?: Record<string, GitState>;
}

/** Letra exibida ao lado do arquivo, no estilo do VS Code. */
const GIT_BADGE: Record<GitState, { letter: string; label: string }> = {
	modified: { letter: 'M', label: 'Modificado no working tree' },
	added: { letter: 'A', label: 'Adicionado ao índice' },
	deleted: { letter: 'D', label: 'Excluído' },
	untracked: { letter: 'U', label: 'Ainda não versionado' },
	renamed: { letter: 'R', label: 'Renomeado' },
};

export default function FileExplorer({
	title,
	tree,
	activePath,
	onOpen,
	onDelete,
	onNewFile,
	onRefresh,
	loading,
	gitStatus,
}: FileExplorerProps) {
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

	function toggle(path: string) {
		setCollapsed((prev) => {
			const next = new Set(prev);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});
	}

	function renderNode(node: TreeNode, depth: number) {
		if (node.type === 'dir') {
			const isCollapsed = collapsed.has(node.path);
			return (
				<div key={node.path}>
					<button
						type="button"
						className="tree-row tree-row--dir"
						style={{ paddingLeft: 8 + depth * 14 }}
						onClick={() => toggle(node.path)}
					>
						{isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
						{isCollapsed ? <Folder size={15} /> : <FolderOpen size={15} />}
						<span className="tree-label">{node.name}</span>
					</button>
					{!isCollapsed && node.children && node.children.length > 0 && (
						<div>{node.children.map((child) => renderNode(child, depth + 1))}</div>
					)}
					{!isCollapsed && node.children && node.children.length === 0 && (
						<p className="tree-empty" style={{ paddingLeft: 8 + (depth + 1) * 14 }}>
							vazio
						</p>
					)}
				</div>
			);
		}

		const isActive = node.path === activePath;
		const git = gitStatus?.[node.path];
		return (
			<div
				key={node.path}
				className={`tree-row tree-row--file${isActive ? ' tree-row--active' : ''}${git ? ` tree-row--git-${git}` : ''}`}
				style={{ paddingLeft: 8 + depth * 14 }}
			>
				<button type="button" className="tree-row-open" onClick={() => onOpen(node.path)}>
					<FileText size={15} />
					<span className="tree-label">{node.title || node.name}</span>
				</button>
				{git && (
					<span className={`git-badge git-badge--${git}`} title={GIT_BADGE[git].label}>
						{GIT_BADGE[git].letter}
					</span>
				)}
				<button
					type="button"
					className="tree-row-action"
					title="Excluir arquivo"
					onClick={(e) => {
						e.stopPropagation();
						onDelete(node.path);
					}}
				>
					<Trash2 size={13} />
				</button>
			</div>
		);
	}

	return (
		<aside className="file-explorer">
			<div className="file-explorer-header">
				<span>{title}</span>
				<div className="file-explorer-actions">
					{onNewFile && (
						<button type="button" title="Nova página" onClick={onNewFile}>
							<FilePlus size={15} />
						</button>
					)}
					<button type="button" title="Atualizar" onClick={onRefresh}>
						<RefreshCw size={15} className={loading ? 'spin' : ''} />
					</button>
				</div>
			</div>
			<div className="file-explorer-tree">
				{tree.length === 0 && !loading ? (
					<p className="tree-empty" style={{ padding: '8px 12px' }}>
						Nenhum arquivo encontrado.
					</p>
				) : (
					tree.map((node) => renderNode(node, 0))
				)}
			</div>
		</aside>
	);
}
