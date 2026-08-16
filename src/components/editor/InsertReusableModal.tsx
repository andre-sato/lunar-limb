import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { X, Puzzle, FileText, AlertTriangle } from 'lucide-react';
import { fetchGraph, fetchReusable } from './api';
import { refOf, stripExtension, typeForRoot, wouldCreateCycle } from '../../lib/editor/graph-model';
import type { ContentGraph, ContentRoot, ReusableItem } from './types';

interface InsertReusableModalProps {
	onClose: () => void;
	onSelect: (item: ReusableItem) => void;
	/** The currently open document's own id — filtered out so it can't reference itself. */
	excludeId?: string;
	/** Chave do documento aberto ("docs:guides/a.mdx"), usada para a checagem de ciclo. */
	sourceKey?: string;
	sourceRoot?: ContentRoot;
}

interface Candidate {
	item: ReusableItem;
	/** Cadeia do ciclo que a inserção criaria, ou null quando é seguro. */
	cycle: string[] | null;
}

export default function InsertReusableModal({
	onClose,
	onSelect,
	excludeId,
	sourceKey,
	sourceRoot = 'docs',
}: InsertReusableModalProps) {
	const [blocks, setBlocks] = useState<ReusableItem[]>([]);
	const [pages, setPages] = useState<ReusableItem[]>([]);
	const [graph, setGraph] = useState<ContentGraph | null>(null);
	const [query, setQuery] = useState('');
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		// O grafo vem junto da lista para que a checagem de ciclo (Fase 4)
		// aconteça *antes* da inserção, e não só quando o preview quebrar.
		Promise.all([fetchReusable(), fetchGraph()])
			.then(([reusable, graphRes]) => {
				if (cancelled) return;
				setBlocks(reusable.blocks);
				setPages(reusable.pages);
				setGraph(graphRes.graph);
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

	const sourceRef = useMemo(() => {
		if (!sourceKey) return null;
		const idx = sourceKey.indexOf(':');
		const path = idx === -1 ? sourceKey : sourceKey.slice(idx + 1);
		return refOf(typeForRoot(sourceRoot), stripExtension(path));
	}, [sourceKey, sourceRoot]);

	const candidateBlocks = useMemo(
		() => toCandidates(blocks, query, excludeId, graph, sourceRef),
		[blocks, query, excludeId, graph, sourceRef]
	);
	const candidatePages = useMemo(
		() => toCandidates(pages, query, excludeId, graph, sourceRef),
		[pages, query, excludeId, graph, sourceRef]
	);

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
							<ReusableGroup
								title="Blocos"
								icon={<Puzzle size={14} />}
								candidates={candidateBlocks}
								onSelect={onSelect}
							/>
							<ReusableGroup
								title="Páginas"
								icon={<FileText size={14} />}
								candidates={candidatePages}
								onSelect={onSelect}
							/>
							{candidateBlocks.length === 0 && candidatePages.length === 0 && (
								<p className="reusable-empty">Nada encontrado.</p>
							)}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

function toCandidates(
	items: ReusableItem[],
	query: string,
	excludeId: string | undefined,
	graph: ContentGraph | null,
	sourceRef: string | null
): Candidate[] {
	const q = query.trim().toLowerCase();
	return items
		.filter((item) => item.id !== excludeId)
		.filter((item) => !q || item.id.toLowerCase().includes(q) || (item.title ?? '').toLowerCase().includes(q))
		.map((item) => ({
			item,
			cycle: graph && sourceRef ? wouldCreateCycle(graph, sourceRef, refOf(item.type, item.id)) : null,
		}));
}

function ReusableGroup({
	title,
	icon,
	candidates,
	onSelect,
}: {
	title: string;
	icon: ReactNode;
	candidates: Candidate[];
	onSelect: (item: ReusableItem) => void;
}) {
	if (candidates.length === 0) return null;
	return (
		<div className="reusable-group">
			<p className="reusable-group-title">{title}</p>
			{candidates.map(({ item, cycle }) => (
				<button
					key={`${item.type}:${item.id}`}
					type="button"
					className={`reusable-item${cycle ? ' reusable-item--blocked' : ''}`}
					disabled={Boolean(cycle)}
					title={
						cycle
							? `Inserir isto criaria uma referência circular: ${cycle.join(' → ')}`
							: 'Inserir referência a este conteúdo'
					}
					onClick={() => !cycle && onSelect(item)}
				>
					{cycle ? <AlertTriangle size={14} /> : icon}
					<span className="reusable-item-title">{item.title || item.id}</span>
					{typeof item.usedByCount === 'number' && item.usedByCount > 0 && (
						<span className="reusable-item-uses">
							{item.usedByCount} uso{item.usedByCount > 1 ? 's' : ''}
						</span>
					)}
					<span className="reusable-item-id">{item.id}</span>
				</button>
			))}
		</div>
	);
}
