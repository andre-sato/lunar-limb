import { EyeOff } from 'lucide-react';

interface PreviewPaneProps {
	html: string;
	title?: string;
	loading: boolean;
	warning?: string;
	/** Fase 5: por que a página está invisível para o leitor, se estiver. */
	hiddenReason?: 'visible-false' | 'condition-off' | null;
	/** Fase 5: variáveis citadas em `<If>` que não existem. */
	unknownFlags?: string[];
	/** Abre o modal de variáveis a partir do aviso. */
	onOpenVariables?: () => void;
}

const HIDDEN_LABEL: Record<'visible-false' | 'condition-off', string> = {
	'visible-false': 'Esta página está publicada, mas invisível: fora da navegação e da busca (visible: false).',
	'condition-off':
		'Esta página está publicada, mas invisível: a variável de showIf está desligada no momento.',
};

export default function PreviewPane({
	html,
	title,
	loading,
	warning,
	hiddenReason,
	unknownFlags,
	onOpenVariables,
}: PreviewPaneProps) {
	return (
		<div className="preview-pane">
			<div className="preview-scroll">
				{title ? <p className="preview-title">{title}</p> : null}

				{hiddenReason && (
					<div className="preview-notice preview-notice--hidden">
						<EyeOff size={14} />
						<span>{HIDDEN_LABEL[hiddenReason]}</span>
					</div>
				)}

				{unknownFlags && unknownFlags.length > 0 && (
					<div className="preview-notice preview-notice--warning">
						<span>
							Condicional aponta para {unknownFlags.length > 1 ? 'variáveis inexistentes' : 'uma variável inexistente'}:{' '}
							{unknownFlags.map((flag) => (
								<code key={flag}>{flag}</code>
							))}
							. O trecho fica oculto até a variável existir.
						</span>
						{onOpenVariables && (
							<button type="button" onClick={onOpenVariables}>
								Gerenciar variáveis
							</button>
						)}
					</div>
				)}

				{warning ? (
					<div className="preview-error">
						<strong>Não foi possível renderizar o preview</strong>
						<pre>{warning}</pre>
					</div>
				) : (
					<div
						className={`preview-content${loading ? ' preview-content--loading' : ''}`}
						// eslint-disable-next-line react/no-danger
						dangerouslySetInnerHTML={{ __html: html }}
					/>
				)}
			</div>
		</div>
	);
}
