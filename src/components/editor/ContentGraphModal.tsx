import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
	AlertCircle,
	AlertTriangle,
	ArrowDownLeft,
	ArrowUpRight,
	ChevronDown,
	ChevronRight,
	FileText,
	Info,
	Puzzle,
	RefreshCw,
	X,
} from 'lucide-react';
import { fetchGraph } from './api';
import {
	analyzeImpact,
	buildAdjacency,
	buildReverseAdjacency,
	findNodeByRef,
	nodeRef,
} from '../../lib/editor/graph-model';
import type { ContentGraph, ContentNode, ContentProblem, ContentRoot, ProblemSeverity } from './types';

interface ContentGraphModalProps {
	onClose: () => void;
	onNavigate: (path: string, root: ContentRoot) => void;
	/** Ref do arquivo aberto ("block:x"/"page:x"), destacado na lista. */
	activeRef?: string;
}

const SEVERITY_ICON: Record<ProblemSeverity, typeof AlertCircle> = {
	error: AlertCircle,
	warning: AlertTriangle,
	info: Info,
};

/**
 * Fase 4 — visão global do Content Graph (§21/§22 da especificação).
 *
 * O grafo chega pronto do servidor, mas as consultas (quem usa o quê, impacto
 * transitivo) rodam aqui no cliente com as mesmas funções puras de
 * graph-model.ts que o servidor usa — uma implementação só, dois lugares.
 */
export default function ContentGraphModal({ onClose, onNavigate, activeRef }: ContentGraphModalProps) {
	const [graph, setGraph] = useState<ContentGraph | null>(null);
	const [problems, setProblems] = useState<ContentProblem[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [query, setQuery] = useState('');
	const [tab, setTab] = useState<'graph' | 'problems'>('graph');

	async function load(fresh = false) {
		setLoading(true);
		try {
			const res = await fetchGraph({ fresh });
			setGraph(res.graph);
			setProblems(res.problems);
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Erro ao carregar o grafo.');
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		void load();
	}, []);

	const errorCount = problems.filter((p) => p.severity === 'error').length;

	return (
		<div className="modal-backdrop" role="presentation" onClick={onClose}>
			<div className="modal modal--graph" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
				<div className="modal-header">
					<h2>Content Graph</h2>
					<div className="graph-header-actions">
						<button type="button" className="icon-btn" onClick={() => void load(true)} title="Recarregar">
							<RefreshCw size={14} className={loading ? 'spin' : undefined} />
						</button>
						<button type="button" className="icon-btn" onClick={onClose} title="Fechar">
							<X size={16} />
						</button>
					</div>
				</div>

				<div className="graph-tabs" role="tablist">
					<button
						type="button"
						role="tab"
						aria-selected={tab === 'graph'}
						className={tab === 'graph' ? 'active' : ''}
						onClick={() => setTab('graph')}
					>
						Conteúdo
						{graph && <span className="graph-tab-count">{graph.nodes.length}</span>}
					</button>
					<button
						type="button"
						role="tab"
						aria-selected={tab === 'problems'}
						className={`${tab === 'problems' ? 'active' : ''}${errorCount > 0 ? ' has-error' : ''}`}
						onClick={() => setTab('problems')}
					>
						Problemas
						{problems.length > 0 && <span className="graph-tab-count">{problems.length}</span>}
					</button>
				</div>

				<div className="modal-body">
					{error && <p className="modal-error">{error}</p>}
					{loading && !graph && <p className="reusable-loading">Carregando grafo…</p>}

					{graph && tab === 'graph' && (
						<>
							<input
								type="text"
								autoFocus
								placeholder="Filtrar por id ou título…"
								value={query}
								onChange={(e) => setQuery(e.target.value)}
							/>
							<GraphStats graph={graph} />
							<GraphList
								graph={graph}
								query={query}
								activeRef={activeRef}
								onNavigate={(path, root) => {
									onNavigate(path, root);
									onClose();
								}}
							/>
						</>
					)}

					{graph && tab === 'problems' && (
						<ProblemList
							problems={problems}
							onNavigate={(path, root) => {
								onNavigate(path, root);
								onClose();
							}}
						/>
					)}
				</div>
			</div>
		</div>
	);
}

function GraphStats({ graph }: { graph: ContentGraph }) {
	const blocks = graph.nodes.filter((node) => node.type === 'block').length;
	return (
		<p className="graph-stats">
			{graph.nodes.length} nós ({blocks} blocos) · {graph.edges.length} referências
		</p>
	);
}

function GraphList({
	graph,
	query,
	activeRef,
	onNavigate,
}: {
	graph: ContentGraph;
	query: string;
	activeRef?: string;
	onNavigate: (path: string, root: ContentRoot) => void;
}) {
	const adjacency = useMemo(() => buildAdjacency(graph), [graph]);
	const reverse = useMemo(() => buildReverseAdjacency(graph), [graph]);

	const q = query.trim().toLowerCase();

	// Só interessa quem participa do grafo: blocos reutilizáveis (mesmo os sem
	// uso, que são justamente o achado interessante) e páginas com arestas.
	const rows = graph.nodes
		.filter((node) => {
			const ref = nodeRef(node);
			const participates =
				node.type === 'block' || (adjacency.get(ref)?.length ?? 0) > 0 || (reverse.get(ref)?.length ?? 0) > 0;
			if (!participates) return false;
			if (!q) return true;
			return node.id.toLowerCase().includes(q) || (node.title ?? '').toLowerCase().includes(q);
		})
		.sort((a, b) => {
			const usedA = reverse.get(nodeRef(a))?.length ?? 0;
			const usedB = reverse.get(nodeRef(b))?.length ?? 0;
			if (usedA !== usedB) return usedB - usedA;
			return a.id.localeCompare(b.id);
		});

	if (rows.length === 0) return <p className="reusable-empty">Nada encontrado.</p>;

	return (
		<div className="graph-list">
			{rows.map((node) => (
				<GraphRow
					key={node.key}
					node={node}
					graph={graph}
					adjacency={adjacency}
					reverse={reverse}
					active={activeRef === nodeRef(node)}
					onNavigate={onNavigate}
				/>
			))}
		</div>
	);
}

function GraphRow({
	node,
	graph,
	adjacency,
	reverse,
	active,
	onNavigate,
}: {
	node: ContentNode;
	graph: ContentGraph;
	adjacency: Map<string, string[]>;
	reverse: Map<string, string[]>;
	active: boolean;
	onNavigate: (path: string, root: ContentRoot) => void;
}) {
	const [open, setOpen] = useState(false);
	const ref = nodeRef(node);
	const usesRefs = adjacency.get(ref) ?? [];
	const usedByRefs = reverse.get(ref) ?? [];
	const impact = useMemo(() => (open ? analyzeImpact(graph, ref) : null), [open, graph, ref]);

	return (
		<div className={`graph-row${active ? ' graph-row--active' : ''}`}>
			<div className="graph-row-head">
				<button type="button" className="graph-row-toggle" onClick={() => setOpen((v) => !v)}>
					{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
					{node.type === 'block' ? <Puzzle size={13} /> : <FileText size={13} />}
					<span className="graph-row-title">{node.title || node.id}</span>
					<span className="reusable-item-id">{node.id}</span>
				</button>
				<span className={`graph-badge${usedByRefs.length === 0 && node.type === 'block' ? ' graph-badge--orphan' : ''}`}>
					{usedByRefs.length === 0 && node.type === 'block'
						? 'sem uso'
						: `${usedByRefs.length} uso${usedByRefs.length === 1 ? '' : 's'}`}
				</span>
				<button type="button" className="reference-line-btn" onClick={() => onNavigate(node.path, node.root)}>
					abrir
				</button>
			</div>

			{open && (
				<div className="graph-row-body">
					<RefGroup
						label="usa"
						icon={<ArrowUpRight size={11} />}
						refs={usesRefs}
						graph={graph}
						onNavigate={onNavigate}
					/>
					<RefGroup
						label="usado por"
						icon={<ArrowDownLeft size={11} />}
						refs={usedByRefs}
						graph={graph}
						onNavigate={onNavigate}
					/>
					{impact && impact.indirect.length > 0 && (
						<p className="graph-impact">
							Impacto total ao editar: {impact.total} páginas ({impact.indirect.length} indireta
							{impact.indirect.length > 1 ? 's' : ''}).
						</p>
					)}
				</div>
			)}
		</div>
	);
}

function RefGroup({
	label,
	icon,
	refs,
	graph,
	onNavigate,
}: {
	label: string;
	icon: ReactNode;
	refs: string[];
	graph: ContentGraph;
	onNavigate: (path: string, root: ContentRoot) => void;
}) {
	if (refs.length === 0) return null;
	return (
		<p className="graph-ref-group">
			<span className="graph-ref-label">
				{icon} {label}
			</span>
			{refs.map((ref) => {
				const target = findNodeByRef(graph, ref);
				return (
					<button
						key={ref}
						type="button"
						className="reference-item reference-item--inline"
						disabled={!target}
						onClick={() => target && onNavigate(target.path, target.root)}
					>
						{target?.title || ref}
					</button>
				);
			})}
		</p>
	);
}

function ProblemList({
	problems,
	onNavigate,
}: {
	problems: ContentProblem[];
	onNavigate: (path: string, root: ContentRoot) => void;
}) {
	if (problems.length === 0) {
		return <p className="reusable-empty">Nenhum problema encontrado no grafo de conteúdo.</p>;
	}

	const order: ProblemSeverity[] = ['error', 'warning', 'info'];
	const sorted = [...problems].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));

	return (
		<ul className="problems-list problems-list--modal">
			{sorted.map((problem, index) => {
				const Icon = SEVERITY_ICON[problem.severity];
				return (
					<li key={`${problem.kind}-${index}`} className={`problem problem--${problem.severity}`}>
						<Icon size={13} />
						<span className="problem-message">{problem.message}</span>
						{problem.path && problem.root && (
							<button
								type="button"
								className="reference-line-btn"
								onClick={() => onNavigate(problem.path!, problem.root!)}
							>
								{problem.path}
								{problem.location ? `:${problem.location.line}` : ''}
							</button>
						)}
					</li>
				);
			})}
		</ul>
	);
}
