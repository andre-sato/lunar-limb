import { useEffect, useState } from 'react';

/**
 * Settings → History: o Documentation Time Machine (P2.1).
 *
 * Três perguntas, três abas: como esta página evoluiu, como o portal estava
 * naquela data, e o que mudou entre dois pontos.
 *
 * O que o painel **não** faz é restaurar com um clique. Restaurar prepara um diff
 * no workspace isolado e mostra o caminho que falta — conteúdo antigo pode estar
 * antigo por um bom motivo, e uma reversão silenciosa apagaria a razão junto.
 */

type View = 'timeline' | 'snapshot' | 'compare';

interface Entry {
	commit: string;
	date: string;
	author: string;
	subject: string;
	change: string;
	tags: string[];
	pullRequest?: number;
	insertions: number;
	deletions: number;
}

interface Snapshot {
	gitRef: string;
	timestamp: string;
	pages: string[];
	metrics?: {
		pages: number;
		words: number;
		lintScore?: number;
		glossaryTerms?: number;
		endpoints?: number;
		health?: number;
		healthMeasured: boolean;
	};
}

interface SemanticChange {
	kind: string;
	subject: string;
	before?: string;
	after?: string;
	confidence: number;
}

interface Comparison {
	comparison: {
		from: { ref: string; date?: string; resolvedFrom?: string };
		to: { ref: string; date?: string; resolvedFrom?: string };
		metrics: Array<{ name: string; before: number | null; after: number | null; delta: number | null }>;
		pages: { added: string[]; removed: string[]; modified: string[] };
		commits: number;
	};
	page?: { path: string; textual: string; semantic: SemanticChange[] };
}

const CHANGE_MARK: Record<string, string> = {
	added: '+',
	modified: '~',
	deleted: '−',
	renamed: '→',
};

const SEMANTIC_LABEL: Record<string, string> = {
	value: 'Valor',
	'required-field': 'Campo obrigatório',
	endpoint: 'Endpoint',
	authentication: 'Autenticação',
	'status-code': 'Código de status',
};

export default function HistoryPanel() {
	const [view, setView] = useState<View>('timeline');
	const [page, setPage] = useState('api-reference/authentication.md');
	const [at, setAt] = useState('');
	const [from, setFrom] = useState('');
	const [to, setTo] = useState('');

	const [timeline, setTimeline] = useState<Entry[] | null>(null);
	const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
	const [comparison, setComparison] = useState<Comparison | null>(null);
	const [restoreResult, setRestoreResult] = useState<{ diff: string; nextSteps: string[]; message: string } | null>(null);

	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function query(params: Record<string, string>) {
		setBusy(true);
		setError(null);
		try {
			const search = new URLSearchParams(params);
			const response = await fetch(`/api/admin/history?${search}`);
			const data = await response.json();
			if (!response.ok) throw new Error(data?.message ?? data?.error ?? 'Falha ao consultar o histórico.');
			return data;
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'Falha ao consultar o histórico.');
			return null;
		} finally {
			setBusy(false);
		}
	}

	async function loadTimeline() {
		const data = await query({ view: 'timeline', page });
		if (data) setTimeline(data.timeline as Entry[]);
	}

	useEffect(() => {
		void loadTimeline();
	}, []);

	async function doRestore() {
		if (!at) return;
		setBusy(true);
		setError(null);
		try {
			const response = await fetch('/api/admin/history', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action: 'restore', page, at }),
			});
			const data = await response.json();
			if (!response.ok) throw new Error(data?.message ?? data?.error ?? 'Falha ao restaurar.');
			setRestoreResult(data);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'Falha ao restaurar.');
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="history-panel">
			<section className="panel">
				<h2>Time Machine</h2>
				<p className="panel-hint">
					Tudo aqui é <strong>derivado do Git</strong> a cada consulta — não existe índice paralelo que possa
					divergir do repositório. O que não dá para reconstruir com honestidade aparece como ausente, não
					estimado: o Health Score de uma data antiga só é exibido quando houve medição naquele dia.
				</p>

				<div className="toolbar">
					{(['timeline', 'snapshot', 'compare'] as const).map((option) => (
						<button
							key={option}
							type="button"
							aria-pressed={view === option}
							onClick={() => setView(option)}
							disabled={busy}
						>
							{option === 'timeline' ? 'Timeline' : option === 'snapshot' ? 'Snapshot' : 'Comparar'}
						</button>
					))}
				</div>

				<div className="git-row">
					<input
						type="text"
						value={page}
						placeholder="api-reference/authentication.md"
						disabled={busy}
						onChange={(event) => setPage(event.target.value)}
					/>
					{view === 'timeline' && (
						<button type="button" disabled={busy} onClick={() => void loadTimeline()}>
							Ver timeline
						</button>
					)}
				</div>

				{view === 'snapshot' && (
					<div className="git-row">
						<input
							type="text"
							value={at}
							placeholder="2026-05-15, um commit ou uma tag"
							disabled={busy}
							onChange={(event) => setAt(event.target.value)}
						/>
						<button
							type="button"
							disabled={busy || at === ''}
							onClick={async () => {
								const data = await query({ view: 'snapshot', at });
								if (data) setSnapshot(data as Snapshot);
							}}
						>
							Reconstruir
						</button>
						<button type="button" disabled={busy || at === ''} onClick={() => void doRestore()}>
							Preparar restauração
						</button>
					</div>
				)}

				{view === 'compare' && (
					<div className="git-row">
						<input type="text" value={from} placeholder="de: 2026-05-15" disabled={busy} onChange={(event) => setFrom(event.target.value)} />
						<input type="text" value={to} placeholder="até: 2026-08-18" disabled={busy} onChange={(event) => setTo(event.target.value)} />
						<button
							type="button"
							disabled={busy || from === '' || to === ''}
							onClick={async () => {
								const data = await query({ view: 'compare', from, to, page });
								if (data) setComparison(data as Comparison);
							}}
						>
							Comparar
						</button>
					</div>
				)}

				{error && <p className="form-error">{error}</p>}
			</section>

			{view === 'timeline' && timeline && (
				<section className="panel">
					<h2>{page}</h2>
					{timeline.length === 0 ? (
						<p className="empty-state">Sem histórico: a página pode ser nova e ainda não commitada.</p>
					) : (
						<ul className="history-timeline">
							{timeline.map((entry) => (
								<li key={entry.commit}>
									<span className="history-mark">{CHANGE_MARK[entry.change] ?? '~'}</span>
									<span className="history-date">{entry.date.slice(0, 10)}</span>
									<span className="history-subject">{entry.subject}</span>
									{entry.tags.length > 0 && <span className="history-tag">{entry.tags.join(', ')}</span>}
									{entry.pullRequest && <span className="stat-card-hint"> #{entry.pullRequest}</span>}
									<span className="stat-card-hint">
										{' '}
										{entry.author} · <code>{entry.commit.slice(0, 8)}</code> · +{entry.insertions}/−{entry.deletions}
									</span>
								</li>
							))}
						</ul>
					)}
				</section>
			)}

			{view === 'snapshot' && snapshot && (
				<section className="panel">
					<h2>Estado em {snapshot.timestamp.slice(0, 10)}</h2>
					<p className="panel-hint">
						Reconstruído do commit <code>{snapshot.gitRef.slice(0, 8)}</code>.
					</p>
					<div className="stat-grid">
						<div className="stat-card">
							<p className="stat-card-label">Páginas</p>
							<p className="stat-card-value">{snapshot.metrics?.pages ?? '—'}</p>
						</div>
						<div className="stat-card">
							<p className="stat-card-label">Palavras</p>
							<p className="stat-card-value">{snapshot.metrics?.words ?? '—'}</p>
						</div>
						<div className="stat-card">
							<p className="stat-card-label">Endpoints</p>
							<p className="stat-card-value">{snapshot.metrics?.endpoints ?? '—'}</p>
						</div>
						<div className="stat-card">
							<p className="stat-card-label">Health Score</p>
							<p className="stat-card-value">{snapshot.metrics?.health ?? '—'}</p>
							<p className="stat-card-hint">
								{snapshot.metrics?.healthMeasured ? 'medido nesta data' : 'sem medição desta época'}
							</p>
						</div>
					</div>
				</section>
			)}

			{restoreResult && (
				<section className="panel">
					<h2>Restauração preparada</h2>
					<p className="panel-hint">{restoreResult.message}</p>
					<pre className="agent-diff">
						{restoreResult.diff.split('\n').map((line, index) => (
							<span
								key={index}
								style={{
									display: 'block',
									color: line.startsWith('+')
										? 'var(--sl-color-green)'
										: line.startsWith('-')
											? 'var(--sl-color-red)'
											: undefined,
								}}
							>
								{line}
							</span>
						))}
					</pre>
					<ul className="health-basis">
						{restoreResult.nextSteps.map((stepText) => (
							<li key={stepText}>{stepText}</li>
						))}
					</ul>
				</section>
			)}

			{view === 'compare' && comparison && (
				<section className="panel">
					<h2>
						{comparison.comparison.from.date?.slice(0, 10)} → {comparison.comparison.to.date?.slice(0, 10)}
					</h2>
					<p className="panel-hint">{comparison.comparison.commits} commit(s) entre os dois pontos.</p>

					<div className="data-table-wrap">
						<table className="data-table">
							<thead>
								<tr>
									<th>Métrica</th>
									<th style={{ width: 100, textAlign: 'right' }}>Antes</th>
									<th style={{ width: 100, textAlign: 'right' }}>Depois</th>
									<th style={{ width: 100, textAlign: 'right' }}>Δ</th>
								</tr>
							</thead>
							<tbody>
								{comparison.comparison.metrics.map((metric) => (
									<tr key={metric.name}>
										<td>{metric.name}</td>
										<td style={{ textAlign: 'right' }}>{metric.before ?? '—'}</td>
										<td style={{ textAlign: 'right' }}>{metric.after ?? '—'}</td>
										<td
											style={{
												textAlign: 'right',
												color:
													metric.delta === null
														? undefined
														: metric.delta < 0
															? 'var(--sl-color-red)'
															: 'var(--sl-color-green)',
											}}
										>
											{metric.delta === null ? '—' : `${metric.delta > 0 ? '+' : ''}${metric.delta}`}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>

					<p className="panel-hint">
						{comparison.comparison.pages.added.length} criada(s) · {comparison.comparison.pages.modified.length}{' '}
						alterada(s) · {comparison.comparison.pages.removed.length} removida(s)
					</p>

					{comparison.page && (
						<>
							<h3>{comparison.page.path} — mudanças de comportamento</h3>
							{comparison.page.semantic.length === 0 ? (
								<p className="panel-hint">
									Nenhuma reconhecida. O diff semântico lê valores, campos obrigatórios, endpoints, autenticação e
									códigos de status — uma reescrita em prosa passa por ele sem ser vista, e por isso o diff
									textual continua ao lado.
								</p>
							) : (
								<ul className="health-basis">
									{comparison.page.semantic.map((change, index) => (
										<li key={index}>
											<strong>{SEMANTIC_LABEL[change.kind] ?? change.kind}</strong> — {change.subject}:{' '}
											<span style={{ color: 'var(--sl-color-red)' }}>{change.before ?? '—'}</span> →{' '}
											<span style={{ color: 'var(--sl-color-green)' }}>{change.after ?? '—'}</span>
											<span className="stat-card-hint"> ({Math.round(change.confidence * 100)}%)</span>
										</li>
									))}
								</ul>
							)}

							{comparison.page.textual && (
								<pre className="agent-diff">
									{comparison.page.textual.split('\n').map((line, index) => (
										<span
											key={index}
											style={{
												display: 'block',
												color: line.startsWith('+')
													? 'var(--sl-color-green)'
													: line.startsWith('-')
														? 'var(--sl-color-red)'
														: undefined,
											}}
										>
											{line}
										</span>
									))}
								</pre>
							)}
						</>
					)}
				</section>
			)}
		</div>
	);
}
