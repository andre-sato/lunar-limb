import { useEffect, useState } from 'react';

/**
 * Settings → Feedback: o que os leitores responderam em "Esta página foi útil?".
 *
 * Os comentários são texto livre de visitantes anônimos. O React escapa por
 * padrão e nada aqui usa `dangerouslySetInnerHTML` — conteúdo enviado por
 * terceiros nunca deve virar markup no painel administrativo.
 */

interface PageFeedback {
	path: string;
	up: number;
	down: number;
	total: number;
	score: number;
}

interface Comment {
	id: string;
	path: string;
	rating: 'up' | 'down';
	comment: string;
	createdAt: string;
}

interface Summary {
	total: number;
	up: number;
	down: number;
	score: number;
	needsAttention: PageFeedback[];
	topPages: PageFeedback[];
	comments: Comment[];
	timeline: Array<{ date: string; up: number; down: number }>;
}

const RANGES = [
	{ key: '7d', label: '7 dias' },
	{ key: '30d', label: '30 dias' },
	{ key: '90d', label: '90 dias' },
	{ key: 'all', label: 'Tudo' },
];

const formatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

function percent(value: number): string {
	return `${Math.round(value * 100)}%`;
}

export default function FeedbackPanel() {
	const [summary, setSummary] = useState<Summary | null>(null);
	const [range, setRange] = useState('30d');
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setError(null);

		fetch(`/api/admin/feedback?range=${range}`)
			.then((response) => {
				if (!response.ok) throw new Error('Não foi possível carregar o feedback.');
				return response.json();
			})
			.then((body) => {
				if (!cancelled) setSummary(body.summary);
			})
			.catch((err) => {
				if (!cancelled) setError(err instanceof Error ? err.message : 'Erro ao carregar.');
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});

		return () => {
			cancelled = true;
		};
	}, [range]);

	return (
		<>
			<div className="toolbar">
				<div style={{ display: 'flex', gap: 4 }}>
					{RANGES.map((option) => (
						<button
							key={option.key}
							type="button"
							className={`btn${range === option.key ? ' btn--primary' : ''}`}
							onClick={() => setRange(option.key)}
						>
							{option.label}
						</button>
					))}
				</div>
			</div>

			{error && <p className="form-error">{error}</p>}
			{loading && <p className="empty-state">Carregando…</p>}

			{!loading && summary && summary.total === 0 && (
				<div className="callout callout--warn">
					<strong>Ainda não há respostas neste período.</strong>
					<p style={{ margin: '6px 0 0' }}>
						O widget "Esta página foi útil?" aparece no fim de cada página de documentação.
					</p>
				</div>
			)}

			{!loading && summary && summary.total > 0 && (
				<>
					<div className="stat-grid">
						<div className="stat-card">
							<p className="stat-card-label">Respostas</p>
							<p className="stat-card-value">{summary.total}</p>
						</div>
						<div className="stat-card">
							<p className="stat-card-label">Úteis</p>
							<p className="stat-card-value">{percent(summary.score)}</p>
							<p className="stat-card-hint">
								{summary.up} sim · {summary.down} não
							</p>
						</div>
						<div className="stat-card">
							<p className="stat-card-label">Páginas com problema</p>
							<p className="stat-card-value">{summary.needsAttention.length}</p>
							<p className="stat-card-hint">maioria negativa, com volume</p>
						</div>
						<div className="stat-card">
							<p className="stat-card-label">Comentários</p>
							<p className="stat-card-value">{summary.comments.length}</p>
						</div>
					</div>

					{summary.needsAttention.length > 0 && (
						<section className="panel">
							<h2>Onde mexer primeiro</h2>
							<p
								style={{
									margin: '-6px 0 14px',
									fontSize: '0.84rem',
									color: 'var(--sl-color-gray-2)',
								}}
							>
								Páginas com maioria de votos negativos e volume suficiente para não ser opinião isolada.
							</p>
							<PageTable pages={summary.needsAttention} />
						</section>
					)}

					{summary.comments.length > 0 && (
						<section className="panel">
							<h2>Comentários recentes</h2>
							<ul className="feedback-comments">
								{summary.comments.map((item) => (
									<li key={item.id} className="feedback-comment">
										<span
											className={`feedback-mark feedback-mark--${item.rating}`}
											aria-label={item.rating === 'up' ? 'Positivo' : 'Negativo'}
										>
											{item.rating === 'up' ? '↑' : '↓'}
										</span>
										<div className="feedback-comment-body">
											<p className="feedback-comment-text">{item.comment}</p>
											<p className="feedback-comment-meta">
												<a href={item.path}>{item.path}</a>
												<span> · {formatter.format(new Date(item.createdAt))}</span>
											</p>
										</div>
									</li>
								))}
							</ul>
						</section>
					)}

					<section className="panel">
						<h2>Todas as páginas avaliadas</h2>
						<PageTable pages={summary.topPages} />
					</section>
				</>
			)}
		</>
	);
}

function PageTable({ pages }: { pages: PageFeedback[] }) {
	return (
		<div className="data-table-wrap">
			<table className="data-table">
				<thead>
					<tr>
						<th>Página</th>
						<th style={{ textAlign: 'right' }}>Sim</th>
						<th style={{ textAlign: 'right' }}>Não</th>
						<th style={{ width: 120 }}>Útil</th>
					</tr>
				</thead>
				<tbody>
					{pages.map((page) => (
						<tr key={page.path}>
							<td className="cell-name">
								<a href={page.path}>{page.path}</a>
							</td>
							<td style={{ textAlign: 'right' }}>{page.up}</td>
							<td style={{ textAlign: 'right' }}>{page.down}</td>
							<td>
								<div className="score-cell">
									<span className="breakdown-bar">
										<span
											style={{
												width: percent(page.score),
												background:
													page.score < 0.5 ? 'var(--sl-color-red)' : 'var(--sl-color-accent)',
											}}
										/>
									</span>
									<span className="breakdown-count">{percent(page.score)}</span>
								</div>
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
