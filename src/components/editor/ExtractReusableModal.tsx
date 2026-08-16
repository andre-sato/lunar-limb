import { useState, type FormEvent } from 'react';
import { X } from 'lucide-react';

interface ExtractReusableModalProps {
	selectionPreview: string;
	onClose: () => void;
	onExtract: (id: string, title: string) => Promise<void> | void;
}

function slugify(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
}

export default function ExtractReusableModal({ selectionPreview, onClose, onExtract }: ExtractReusableModalProps) {
	const [title, setTitle] = useState('');
	const [id, setId] = useState('');
	const [idTouched, setIdTouched] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	function handleTitleChange(value: string) {
		setTitle(value);
		if (!idTouched) setId(slugify(value));
	}

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		setError(null);
		const cleanId = slugify(id);
		if (!cleanId) {
			setError('Informe um ID (usado no nome do arquivo e nas referências).');
			return;
		}
		try {
			setSubmitting(true);
			await onExtract(cleanId, title.trim());
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Erro ao extrair conteúdo.');
			setSubmitting(false);
		}
	}

	return (
		<div className="modal-backdrop" role="presentation" onClick={onClose}>
			<div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
				<div className="modal-header">
					<h2>Extrair para conteúdo reutilizável</h2>
					<button type="button" className="icon-btn" onClick={onClose} title="Fechar">
						<X size={16} />
					</button>
				</div>
				<form onSubmit={handleSubmit} className="modal-body">
					<div className="extract-preview">
						<pre>{selectionPreview}</pre>
					</div>

					<label>
						Título
						<input type="text" value={title} onChange={(e) => handleTitleChange(e.target.value)} autoFocus />
					</label>

					<label>
						ID
						<input
							type="text"
							value={id}
							onChange={(e) => {
								setIdTouched(true);
								setId(e.target.value);
							}}
						/>
					</label>
					<p className="modal-hint">
						Cria <code>src/content/snippets/{slugify(id) || '…'}.md</code> e substitui a seleção por{' '}
						<code>{`<ContentBlock id="${slugify(id) || '…'}" />`}</code>.
					</p>

					{error && <p className="modal-error">{error}</p>}

					<div className="modal-actions">
						<button type="button" onClick={onClose} disabled={submitting}>
							Cancelar
						</button>
						<button type="submit" className="primary" disabled={submitting}>
							{submitting ? 'Extraindo…' : 'Extrair'}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
