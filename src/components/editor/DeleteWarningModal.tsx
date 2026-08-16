import { AlertTriangle } from 'lucide-react';

interface DeleteWarningModalProps {
	path: string;
	usedBy: string[];
	onCancel: () => void;
	onConfirm: () => void;
}

export default function DeleteWarningModal({ path, usedBy, onCancel, onConfirm }: DeleteWarningModalProps) {
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
						<code>{path}</code> é referenciado por {usedBy.length} página{usedBy.length > 1 ? 's' : ''}. Excluir agora vai
						quebrar essas referências:
					</p>
					<ul className="delete-warning-list">
						{usedBy.map((p) => (
							<li key={p}>{p}</li>
						))}
					</ul>
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
