import { useState, type FormEvent } from 'react';
import { X } from 'lucide-react';

interface NewFileModalProps {
	onClose: () => void;
	onCreate: (path: string, content: string) => Promise<void> | void;
}

const LOCALES = [
	{ value: 'root', label: 'Português (Brasil) — raiz' },
	{ value: 'en', label: 'English (en/)' },
	{ value: 'es', label: 'Español (es/)' },
];

function slugifySegment(segment: string): string {
	return segment
		.trim()
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9/]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
}

export default function NewFileModal({ onClose, onCreate }: NewFileModalProps) {
	const [locale, setLocale] = useState('root');
	const [subpath, setSubpath] = useState('');
	const [title, setTitle] = useState('');
	const [description, setDescription] = useState('');
	const [isMdx, setIsMdx] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		setError(null);

		const cleanSubpath = slugifySegment(subpath);
		if (!cleanSubpath) {
			setError('Informe um caminho para a página, ex: guides/minha-pagina');
			return;
		}
		if (!title.trim()) {
			setError('Informe um título — o Starlight exige "title" no frontmatter.');
			return;
		}

		const ext = isMdx ? '.mdx' : '.md';
		const prefix = locale === 'root' ? '' : `${locale}/`;
		const fullPath = `${prefix}${cleanSubpath}${ext}`;

		const frontmatterLines = ['---', `title: ${JSON.stringify(title.trim())}`];
		if (description.trim()) {
			frontmatterLines.push(`description: ${JSON.stringify(description.trim())}`);
		}
		frontmatterLines.push('---', '', '');
		const content = frontmatterLines.join('\n');

		try {
			setSubmitting(true);
			await onCreate(fullPath, content);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Erro ao criar arquivo.');
			setSubmitting(false);
		}
	}

	return (
		<div className="modal-backdrop" role="presentation" onClick={onClose}>
			<div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
				<div className="modal-header">
					<h2>Nova página</h2>
					<button type="button" className="icon-btn" onClick={onClose} title="Fechar">
						<X size={16} />
					</button>
				</div>
				<form onSubmit={handleSubmit} className="modal-body">
					<label>
						Idioma / pasta
						<select value={locale} onChange={(e) => setLocale(e.target.value)}>
							{LOCALES.map((l) => (
								<option key={l.value} value={l.value}>
									{l.label}
								</option>
							))}
						</select>
					</label>

					<label>
						Caminho (sem extensão)
						<input
							type="text"
							placeholder="guides/minha-nova-pagina"
							value={subpath}
							onChange={(e) => setSubpath(e.target.value)}
						/>
					</label>

					<label>
						Título
						<input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
					</label>

					<label>
						Descrição (opcional)
						<input type="text" value={description} onChange={(e) => setDescription(e.target.value)} />
					</label>

					<label className="modal-checkbox">
						<input type="checkbox" checked={isMdx} onChange={(e) => setIsMdx(e.target.checked)} />
						Criar como .mdx (permite componentes)
					</label>

					{error && <p className="modal-error">{error}</p>}

					<div className="modal-actions">
						<button type="button" onClick={onClose} disabled={submitting}>
							Cancelar
						</button>
						<button type="submit" className="primary" disabled={submitting}>
							{submitting ? 'Criando…' : 'Criar página'}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
