import { useCallback, useState } from 'react';
import {
	AlertTriangle,
	ArrowDownLeft,
	ArrowUpRight,
	ChevronDown,
	ChevronRight,
	FileText,
	Network,
	Puzzle,
	Radar,
} from 'lucide-react';
import type { ContentNode, ContentRoot, ImpactAnalysis, ReferenceDetail } from './types';
import { SEVERITY_MARK, REVIEW_SCOPE_LABEL, type ImpactReport } from '../../lib/impact/types';

interface ReferencePanelProps {
	/** Arquivo aberto, relativo à raiz da collection. */
	path: string;
	/** Qual collection — decide o caminho que vai para a análise de impacto. */
	root: ContentRoot;
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
	path,
	root,
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
	const [impactReport, setImpactReport] = useState<ImpactReport | null>(null);
	const [impactBusy, setImpactBusy] = useState(false);
	const [impactError, setImpactError] = useState<string | null>(null);

	/**
	 * Preview de impacto (§9): a pergunta é "se eu mexer aqui, o que muda junto?",
	 * e ela é respondida **antes** de salvar. Sob demanda, e não a cada tecla: a
	 * análise varre o grafo, o glossário e as especificações, e recalcular isso
	 * enquanto alguém digita torna o editor pesado sem tornar a resposta melhor.
	 */
	const loadImpact = useCallback(async () => {
		setImpactBusy(true);
		setImpactError(null);
		try {
			const prefix = root === 'snippets' ? 'src/content/snippets/' : 'src/content/docs/';
			const response = await fetch(`/api/editor/impact?path=${encodeURIComponent(prefix + path)}`);
			const data = await response.json();
			if (!response.ok) throw new Error(data?.error ?? 'Falha ao analisar o impacto.');
			setImpactReport(data as ImpactReport);
		} catch (cause) {
			setImpactError(cause instanceof Error ? cause.message : 'Falha ao analisar o impacto.');
		} finally {
			setImpactBusy(false);
		}
	}, [path, root]);

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
				{/* Sem referência de conteúdo ainda há impacto possível: a página pode
				    mencionar termos do glossário ou documentar um endpoint. */}
				<button
					type="button"
					className="reference-graph-btn"
					onClick={() => void loadImpact()}
					disabled={impactBusy}
					title="O que precisa de revisão se este arquivo mudar"
				>
					<Radar size={13} /> {impactBusy ? 'Analisando…' : 'Impacto'}
				</button>
				{loading && <span className="reference-loading">carregando referências…</span>}
				{impactError && <span className="reference-impact-error">{impactError}</span>}
				{impactReport && (
					<span className="reference-impact-inline">
						{impactReport.items.length === 0
							? 'sem impacto além deste arquivo'
							: `${impactReport.items.length} página(s) a revisar · score ${impactReport.score.value}/100`}
					</span>
				)}
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

				<button
					type="button"
					className="reference-graph-btn"
					onClick={() => void loadImpact()}
					disabled={impactBusy}
					title="O que precisa de revisão se este arquivo mudar"
				>
					<Radar size={13} /> {impactBusy ? 'Analisando…' : 'Impacto'}
				</button>
			</div>

			{impactError && <p className="reference-impact-error">{impactError}</p>}

			{impactReport && (
				<div className="reference-impact-preview">
					{impactReport.items.length === 0 ? (
						<p className="reference-impact-empty">
							Nada mais precisa de revisão se este arquivo mudar.
						</p>
					) : (
						<>
							<p className="reference-impact-head">
								{(['critical', 'high', 'medium', 'low'] as const)
									.filter((severity) => impactReport.counts[severity] > 0)
									.map((severity) => `${SEVERITY_MARK[severity]} ${impactReport.counts[severity]}`)
									.join('  ')}
								{'  ·  '}
								Score {impactReport.score.value}/100 · escopo {REVIEW_SCOPE_LABEL[impactReport.scope]}
							</p>
							<ul className="reference-impact-list">
								{impactReport.items.slice(0, 8).map((item) => (
									<li key={item.node.id}>
										{SEVERITY_MARK[item.severity]}{' '}
										<button
											type="button"
											className="reference-inline-link"
											onClick={() =>
												onNavigate(
													item.node.path.replace(/^src\/content\/(docs|snippets)\//, ''),
													item.node.path.includes('/snippets/') ? 'snippets' : 'docs'
												)
											}
										>
											{item.node.path.replace(/^src\/content\/(docs|snippets)\//, '')}
										</button>{' '}
										<span className="reference-impact-reason">{item.reason}</span>
									</li>
								))}
								{impactReport.items.length > 8 && (
									<li className="reference-impact-reason">… e mais {impactReport.items.length - 8}</li>
								)}
							</ul>
						</>
					)}
				</div>
			)}

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
