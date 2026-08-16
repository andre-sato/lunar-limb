import { AlertTriangle, ExternalLink } from 'lucide-react';
import type { ContentNode, ContentRoot, ImpactAnalysis } from './types';

interface DeleteWarningModalProps {
	path: string;
	/** Impacto completo: consumidores diretos e indiretos. */
	impact: ImpactAnalysis;
	onCancel: () => void;
	onConfirm: () => void;
	/** "Mostrar referências" — abre a página consumidora sem excluir nada. */
	onNavigate: (path: string, root: ContentRoot) => void;
}

/**
 * Fase 4 — impact analysis na exclusão (§23 da especificação).
 * A Fase 3 já listava os consumidores diretos; aqui o aviso passa a incluir
 * também quem é afetado indiretamente (A usa B, B usa o que vai ser apagado).
 */
export default function DeleteWarningModal({ path, impact, onCancel, onConfirm, onNavigate }: DeleteWarningModalProps) {
	const direct = impact.direct.length;
	const indirect = impact.indirect.length;

	return (
		<div className="modal-backdrop" role="presentation" onClick={onCancel}>
			<div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
				<div className="modal-header modal-header--warning">
					<h2>
						<AlertTriangle size={16} /> Este conteúdo está em uso
					</h2>
				</div>
				<div className="modal-body">
					<p>
						<code>{path}</code> é referenciado por {direct} página{direct === 1 ? '' : 's'}
						{indirect > 0 && ` e afeta indiretamente outras ${indirect}`}. Excluir agora vai quebrar essas
						referências:
					</p>

					<ConsumerList title="Diretas" nodes={impact.direct} onNavigate={onNavigate} />
					{indirect > 0 && <ConsumerList title="Indiretas" nodes={impact.indirect} onNavigate={onNavigate} />}

					<div className="modal-actions">
						<button type="button" onClick={onCancel}>
							Cancelar
						</button>
						<button type="button" className="danger" onClick={onConfirm}>
							Excluir mesmo assim
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}

function ConsumerList({
	title,
	nodes,
	onNavigate,
}: {
	title: string;
	nodes: ContentNode[];
	onNavigate: (path: string, root: ContentRoot) => void;
}) {
	if (nodes.length === 0) return null;
	return (
		<>
			<p className="modal-hint">{title}</p>
			<ul className="delete-warning-list">
				{nodes.map((node) => (
					<li key={node.key}>
						<button type="button" className="reference-inline-link" onClick={() => onNavigate(node.path, node.root)}>
							{node.title || node.id} <ExternalLink size={11} />
						</button>
					</li>
				))}
			</ul>
		</>
	);
}
