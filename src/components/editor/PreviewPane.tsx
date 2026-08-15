interface PreviewPaneProps {
	html: string;
	title?: string;
	loading: boolean;
	warning?: string;
}

export default function PreviewPane({ html, title, loading, warning }: PreviewPaneProps) {
	return (
		<div className="preview-pane">
			<div className="preview-scroll">
				{title ? <p className="preview-title">{title}</p> : null}
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
