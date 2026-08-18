import { useEffect, useState } from 'react';

/**
 * Settings → Gaps: o backlog documental descoberto (§16, §17, §20).
 *
 * A tela é uma fila de trabalho, não um painel de métricas. Cada linha traz o que
 * fazer e por que, e o dossiê abre com a evidência inteira — inclusive a
 * decomposição do score, porque um número que ninguém consegue conferir é um
 * número que a equipe reordena por conta própria.
 *
 * O botão de resolver **pode recusar**: publicar uma página não é evidência de que
 * o gap sumiu.
 */

type Priority = 'P0' | 'P1' | 'P2' | 'P3';

interface Gap {
	id: string;
	query: string;
	variants: string[];
	category: string;
	frequency: number;
	coverage: number;
	priority: Priority;
	status: string;
	evidence: {
		searches: number;
		aiQuestions: number;
		aiFailures: number;
		mcpQueries: number;
		negativeFeedback: number;
		brokenContracts: number;
	};
	score: { value: number; factors: Array<{ name: string; points: number; detail: string }> };
	relatedContent: string[];
	relatedProductNodes: string[];
	recommendation: { action: string; target?: string; outline: string[]; reason: string };
}

interface Report {
	gaps: Gap[];
	counts: Record<Priority, number>;
	limited: boolean;
}

const CATEGORY_LABEL: Record<string, string> = {
	missing: 'Falta documentação',
	incomplete: 'Incompleta',
	outdated: 'Desatualizada',
	unclear: 'Pouco clara',
	'hard-to-find': 'Difícil de achar',
	contradictory: 'Contraditória',
};

const ACTION_LABEL: Record<string, string> = {
	'create-page': 'Criar página',
	'update-page': 'Atualizar página',
	'add-example': 'Acrescentar exemplo',
	'add-api-reference': 'Documentar na referência da API',
	'fix-terminology': 'Corrigir terminologia',
	'fix-navigation': 'Melhorar a navegação',
	'update-outdated': 'Atualizar conteúdo divergente',
};

const STATUS_LABEL: Record<string, string> = {
	new: 'Novo',
	acknowledged: 'Reconhecido',
	'in-progress': 'Em andamento',
	resolved: 'Resolvido',
	dismissed: 'Descartado',
	duplicate: 'Duplicado',
};

const PRIORITY_COLOR: Record<Priority, string | undefined> = {
	P0: 'var(--sl-color-red)',
	P1: 'var(--sl-color-orange)',
	P2: undefined,
	P3: undefined,
};

export default function GapsPanel() {
	const [report, setReport] = useState<Report | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [open, setOpen] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function load() {
		setLoading(true);
		setError(null);
		try {
			const response = await fetch('/api/admin/gaps');
			const data = await response.json();
			if (!response.ok) throw new Error(data?.error ?? 'Falha ao analisar as lacunas.');
			setReport(data as Report);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'Falha ao analisar as lacunas.');
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		void load();
	}, []);

	async function act(body: Record<string, unknown>) {
		setBusy(true);
		setNotice(null);
		try {
			const response = await fetch('/api/admin/gaps', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
			});
			const data = await response.json();
			if (!response.ok) throw new Error(data?.error ?? 'Falha na ação.');

			setNotice(data.reason ?? 'Feito.');
			await load();
		} catch (cause) {
			setNotice(cause instanceof Error ? cause.message : 'Falha na ação.');
		} finally {
			setBusy(false);
		}
	}

	if (loading) return <p className="empty-state">Cruzando os sinais para descobrir o que falta…</p>;
	if (error) return <p className="form-error">{error}</p>;
	if (!report) return null;

	return (
		<div className="gaps-panel">
			<div className="stat-grid">
				{(['P0', 'P1', 'P2', 'P3'] as const).map((priority) => (
					<div key={priority} className="stat-card">
						<p className="stat-card-label">{priority}</p>
						<p className="stat-card-value" style={{ color: PRIORITY_COLOR[priority] }}>
							{report.counts[priority]}
						</p>
					</div>
				))}
			</div>

			{report.limited && (
				<p className="panel-hint">
					O texto das perguntas <strong>não</strong> está sendo guardado, então a análise usa apenas os sinais
					estruturais: endpoint sem página, contrato quebrado, voto negativo, proveniência inválida. Para incluir
					as perguntas, ligue <code>documentation.analytics.storeUnansweredQuestions</code> em{' '}
					<code>health.yml</code> — é uma decisão de privacidade, e por isso ela é sua.
				</p>
			)}

			{notice && <p className="panel-hint">{notice}</p>}

			<section className="panel">
				<h2>Backlog documental</h2>
				{report.gaps.length === 0 ? (
					<p className="empty-state">Nenhuma lacuna detectada.</p>
				) : (
					<div className="data-table-wrap">
						<table className="data-table">
							<thead>
								<tr>
									<th style={{ width: 50 }}>Pri</th>
									<th style={{ width: 60, textAlign: 'right' }}>Score</th>
									<th>Lacuna</th>
									<th style={{ width: 150 }}>Tipo</th>
									<th style={{ width: 90, textAlign: 'right' }}>Consultas</th>
									<th style={{ width: 120 }}>Estado</th>
								</tr>
							</thead>
							<tbody>
								{report.gaps.map((gap) => (
									<tr
										key={gap.id}
										onClick={() => setOpen(open === gap.id ? null : gap.id)}
										style={{ cursor: 'pointer' }}
									>
										<td style={{ color: PRIORITY_COLOR[gap.priority] }}>{gap.priority}</td>
										<td style={{ textAlign: 'right' }}>{gap.score.value}</td>
										<td>{gap.query}</td>
										<td>{CATEGORY_LABEL[gap.category] ?? gap.category}</td>
										<td style={{ textAlign: 'right' }}>{gap.frequency}</td>
										<td>{STATUS_LABEL[gap.status] ?? gap.status}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>

			{report.gaps
				.filter((gap) => gap.id === open)
				.map((gap) => (
					<section className="panel" key={gap.id}>
						<h2>{gap.query}</h2>

						<div className="stat-grid">
							<div className="stat-card">
								<p className="stat-card-label">Score</p>
								<p className="stat-card-value">{gap.score.value}</p>
								<p className="stat-card-hint">{gap.priority}</p>
							</div>
							<div className="stat-card">
								<p className="stat-card-label">Cobertura atual</p>
								<p className="stat-card-value">{gap.coverage}%</p>
							</div>
							<div className="stat-card">
								<p className="stat-card-label">Consultas</p>
								<p className="stat-card-value">{gap.evidence.searches}</p>
								<p className="stat-card-hint">{gap.evidence.aiFailures} sem lastro</p>
							</div>
							<div className="stat-card">
								<p className="stat-card-label">Contratos quebrados</p>
								<p className="stat-card-value">{gap.evidence.brokenContracts}</p>
							</div>
						</div>

						<h3>Como o score foi calculado</h3>
						<ul className="health-basis">
							{gap.score.factors.map((factor) => (
								<li key={factor.name}>
									+{factor.points} <strong>{factor.name}</strong> ({factor.detail})
								</li>
							))}
						</ul>

						{gap.variants.length > 1 && (
							<>
								<h3>Perguntas agrupadas</h3>
								<ul className="health-basis">
									{gap.variants.map((variant) => (
										<li key={variant}>{variant}</li>
									))}
								</ul>
							</>
						)}

						{gap.relatedContent.length > 0 && (
							<>
								<h3>Conteúdo relacionado</h3>
								<ul className="health-basis">
									{gap.relatedContent.map((path) => (
										<li key={path}>
											<code>{path}</code>
										</li>
									))}
								</ul>
							</>
						)}

						<h3>Recomendação</h3>
						<p>
							<strong>{ACTION_LABEL[gap.recommendation.action] ?? gap.recommendation.action}</strong>
							{gap.recommendation.target && (
								<>
									{' — '}
									<code>{gap.recommendation.target}</code>
								</>
							)}
						</p>
						<p className="panel-hint">{gap.recommendation.reason}</p>
						<ol className="health-basis">
							{gap.recommendation.outline.map((step) => (
								<li key={step}>{step}</li>
							))}
						</ol>

						<div className="health-actions">
							<button type="button" disabled={busy} onClick={() => void act({ action: 'acknowledge', id: gap.id })}>
								Reconhecer
							</button>
							<button type="button" disabled={busy} onClick={() => void act({ action: 'start', id: gap.id })}>
								Começar
							</button>
							<button type="button" disabled={busy} onClick={() => void act({ action: 'resolve', id: gap.id })}>
								Marcar resolvido
							</button>
							<button type="button" disabled={busy} onClick={() => void act({ action: 'dismiss', id: gap.id })}>
								Descartar
							</button>
							<span className="stat-card-hint">
								"Começar" registra o sinal de hoje. "Resolvido" só é aceito quando esse sinal cair — publicar
								uma página não é evidência de que o gap sumiu.
							</span>
						</div>
					</section>
				))}

			<section className="panel">
				<h2>Telemetria</h2>
				<p className="panel-hint">
					O que alimenta esta tela são contadores e, quando ligado, o texto das perguntas que{' '}
					<strong>não</strong> foram respondidas — sem quem perguntou, truncado e com credenciais redigidas.
				</p>
				<div className="health-actions">
					<button type="button" disabled={busy} onClick={() => void act({ action: 'forget-signals' })}>
						Apagar as perguntas guardadas
					</button>
					<span className="stat-card-hint">Os contadores permanecem.</span>
				</div>
			</section>
		</div>
	);
}
