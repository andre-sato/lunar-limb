import { useState } from 'react';
import {
	AlertTriangle,
	ArrowDownLeft,
	ArrowUpRight,
	ChevronDown,
	ChevronRight,
	FileText,
	Network,
	Puzzle,
} from 'lucide-react';
import type { ContentNode, ContentRoot, ImpactAnalysis, ReferenceDetail } from './types';

interface ReferencePanelProps {
	/** Arquivo aberto, só para rótulo. */
	path: string;
	node?: ContentNode;
	uses: ReferenceDetail[];
	usedBy: ReferenceDetail[];
	impact: ImpactAnalysis;
	loading: boolean;
	error: string | null;
	/** Abre outro arquivo do grafo. */
	onNavigate: (path: string, root: ContentRoot) => void;
	/** Move o cursor do Monaco para a linha da tag no arquivo atual. */
	onRevealLine: (line: number) => void;
	/** Abre o modal com o grafo completo. */
	onOpenGraph: () => void;
}

/**
 * Fase 4 — navegação bidirecional (§20–§23 da especificação).
 *
 * Mostra os dois lados da mesma aresta: o que esta página usa e quem usa esta
 * página. Ambos navegáveis. Quando o arquivo aberto é consumido por outros, o
 * painel abre com o aviso de impacto — o autor precisa saber que está editando
 * conteúdo compartilhado *antes* de digitar, não depois de publicar.
 */
export default function ReferencePanel({
	node,
	uses,
	usedBy,
	impact,
	loading,
	error,
	onNavigate,
	onRevealLine,
	onOpenGraph,
}: ReferencePanelProps) {
	const isShared = usedBy.length > 0;
	const [expanded, setExpanded] = useState(false);

	const broken = uses.filter((ref) => !ref.resolved);
	const hasAnything = uses.length > 0 || usedBy.length > 0;

	if (error) {
		return <div className="reference-panel reference-panel--error">{error}</div>;
	}

	if (!hasAnything) {
		// Nada a mostrar sobre este arquivo, mas o acesso ao grafo global
		// continua útil — mantém o botão, sem ocupar espaço.
		return (
			<div className="reference-panel reference-panel--quiet">
				<button type="button" className="reference-graph-btn" onClick={onOpenGraph} title="Abrir Content Graph">
					<Network size={13} /> Grafo de conteúdo
				</button>
				{loading && <span className="reference-loading">carregando referências…</span>}
			</div>
		);
	}

	return (
		<div className={`reference-panel${isShared ? ' reference-panel--shared' : ''}`}>
			<div className="reference-summary">
				<button
					type="button"
					className="reference-expander"
					onClick={() => setExpanded((v) => !v)}
					aria-expanded={expanded}
				>
					{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
					<span>Referências</span>
				</button>

				{isShared && (
					<span className="reference-impact-badge" title="Impacto de editar este conteúdo">
						<AlertTriangle size={12} />
						Conteúdo reutilizável — {impactLabel(impact, usedBy.length)}
					</span>
				)}

				{uses.length > 0 && (
					<span className="reference-count">
						<ArrowUpRight size={12} /> usa {uses.length}
					</span>
				)}

				{broken.length > 0 && (
					<span className="reference-count reference-count--error">
						<AlertTriangle size={12} /> {broken.length} quebrada{broken.length > 1 ? 's' : ''}
					</span>
				)}

				<button type="button" className="reference-graph-btn" onClick={onOpenGraph} title="Abrir Content Graph">
					<Network size={13} /> Grafo
				</button>
			</div>

			{expanded && (
				<div className="reference-details">
					{uses.length > 0 && (
						<section className="reference-group">
							<p className="reference-group-title">
								<ArrowUpRight size={12} /> Esta página usa
							</p>
							<ul className="reference-list">
								{uses.map((ref, index) => (
									<li key={`${ref.type}:${ref.id}:${index}`}>
										<button
											type="button"
											className={`reference-item${ref.resolved ? '' : ' reference-item--broken'}`}
											onClick={() =>
												ref.resolved && ref.path && ref.root
													? onNavigate(ref.path, ref.root)
													: undefined
											}
											disabled={!ref.resolved}
											title={ref.resolved ? 'Abrir conteúdo original' : 'Referência não encontrada'}
										>
											{ref.type === 'block' ? <Puzzle size={13} /> : <FileText size={13} />}
											<span className="reference-item-title">{ref.title || ref.id}</span>
											<span className="reference-item-id">{ref.id}</span>
											{!ref.resolved && <AlertTriangle size={12} />}
										</button>
										<button
											type="button"
											className="reference-line-btn"
											onClick={() => onRevealLine(ref.location.line)}
											title="Ir para a linha da tag"
										>
											L{ref.location.line}
										</button>
									</li>
								))}
							</ul>
						</section>
					)}

					{usedBy.length > 0 && (
						<section className="reference-group">
							<p className="reference-group-title">
								<ArrowDownLeft size={12} /> Usado por {usedBy.length} página{usedBy.length > 1 ? 's' : ''}
							</p>
							<ul className="reference-list">
								{usedBy.map((ref, index) => (
									<li key={`${ref.id}:${index}`}>
										<button
											type="button"
											className="reference-item"
											onClick={() => (ref.path && ref.root ? onNavigate(ref.path, ref.root) : undefined)}
											title="Abrir página consumidora"
										>
											{ref.type === 'block' ? <Puzzle size={13} /> : <FileText size={13} />}
											<span className="reference-item-title">{ref.title || ref.id}</span>
											<span className="reference-item-id">{ref.path ?? ref.id}</span>
										</button>
									</li>
								))}
							</ul>

							{impact.indirect.length > 0 && (
								<p className="reference-indirect">
									+ {impact.indirect.length} página{impact.indirect.length > 1 ? 's' : ''} afetada
									{impact.indirect.length > 1 ? 's' : ''} indiretamente:{' '}
									{impact.indirect.map((affected, index) => (
										<button
											key={affected.key}
											type="button"
											className="reference-inline-link"
											onClick={() => onNavigate(affected.path, affected.root)}
										>
											{affected.title || affected.id}
											{index < impact.indirect.length - 1 ? ', ' : ''}
										</button>
									))}
								</p>
							)}
						</section>
					)}

					{node && (
						<p className="reference-node-id">
							id deste conteúdo: <code>{node.id}</code> ({node.type === 'block' ? 'bloco' : 'página'})
						</p>
					)}
				</div>
			)}
		</div>
	);
}

function impactLabel(impact: ImpactAnalysis, directCount: number): string {
	if (impact.indirect.length === 0) {
		return `usado por ${directCount} página${directCount > 1 ? 's' : ''}`;
	}
	return `afeta ${impact.total} páginas (${directCount} direta${directCount > 1 ? 's' : ''}, ${impact.indirect.length} indireta${
		impact.indirect.length > 1 ? 's' : ''
	})`;
}
