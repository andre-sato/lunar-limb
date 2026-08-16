import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { X, Puzzle, FileText } from 'lucide-react';
import { fetchReusable } from './api';
import type { ReusableItem } from './types';

interface InsertReusableModalProps {
	onClose: () => void;
	onSelect: (item: ReusableItem) => void;
	/** The currently open document's own id — filtered out so it can't reference itself. */
	excludeId?: string;
}

export default function InsertReusableModal({ onClose, onSelect, excludeId }: InsertReusableModalProps) {
	const [blocks, setBlocks] = useState<ReusableItem[]>([]);
	const [pages, setPages] = useState<ReusableItem[]>([]);
	const [query, setQuery] = useState('');
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		fetchReusable()
			.then((res) => {
				if (cancelled) return;
				setBlocks(res.blocks);
				setPages(res.pages);
			})
			.catch((err) => {
				if (!cancelled) setError(err instanceof Error ? err.message : 'Erro ao carregar conteúdo reutilizável.');
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const filteredBlocks = useMemo(() => filterItems(blocks, query, excludeId), [blocks, query, excludeId]);
	const filteredPages = useMemo(() => filterItems(pages, query, excludeId), [pages, query, excludeId]);

	return (
		<div className="modal-backdrop" role="presentation" onClick={onClose}>
			<div className="modal modal--wide" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
				<div className="modal-header">
					<h2>Inserir conteúdo reutilizável</h2>
					<button type="button" className="icon-btn" onClick={onClose} title="Fechar">
						<X size={16} />
					</button>
				</div>
				<div className="modal-body">
					<input
						type="text"
						autoFocus
						placeholder="Buscar por título ou id…"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
					/>

					{error && <p className="modal-error">{error}</p>}
					{loading && <p className="reusable-loading">Carregando…</p>}

					{!loading && !error && (
						<div className="reusable-picker">
							<ReusableGroup title="Blocos" icon={<Puzzle size={14} />} items={filteredBlocks} onSelect={onSelect} />
							<ReusableGroup title="Páginas" icon={<FileText size={14} />} items={filteredPages} onSelect={onSelect} />
							{filteredBlocks.length === 0 && filteredPages.length === 0 && (
								<p className="reusable-empty">Nada encontrado.</p>
							)}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

function filterItems(items: ReusableItem[], query: string, excludeId?: string): ReusableItem[] {
	const q = query.trim().toLowerCase();
	return items
		.filter((item) => item.id !== excludeId)
		.filter((item) => !q || item.id.toLowerCase().includes(q) || (item.title ?? '').toLowerCase().includes(q));
}

function ReusableGroup({
	title,
	icon,
	items,
	onSelect,
}: {
	title: string;
	icon: ReactNode;
	items: ReusableItem[];
	onSelect: (item: ReusableItem) => void;
}) {
	if (items.length === 0) return null;
	return (
		<div className="reusable-group">
			<p className="reusable-group-title">{title}</p>
			{items.map((item) => (
				<button key={`${item.type}:${item.id}`} type="button" className="reusable-item" onClick={() => onSelect(item)}>
					{icon}
					<span className="reusable-item-title">{item.title || item.id}</span>
					<span className="reusable-item-id">{item.id}</span>
				</button>
			))}
		</div>
	);
}
