import { useEffect, useState } from 'react';

/**
 * Settings → Health: o Health Center (§2, §5, §6, §9, §11, §12).
 *
 * A ordem da tela é a ordem de uma conversa de segunda-feira: como estamos, o
 * que está fora do alvo, o que fazemos primeiro. Cada dimensão mostra **de onde o
 * número veio** — um painel cujo indicador ninguém consegue conferir é um painel
 * que a equipe passa a discutir em vez de usar.
 *
 * A análise roda por inteiro no servidor (linter, testes, confiança, cobertura de
 * API), o que leva alguns segundos. Daí o estado de carregamento explícito.
 */

type SloStatus = 'healthy' | 'at-risk' | 'breached';

interface Dimension {
	dimension: string;
	value: number;
	basis: string;
	measured: boolean;
}

interface Slo {
	dimension: string;
	current: number;
	target: number;
	status: SloStatus;
	measured: boolean;
}

interface Gap {
	kind: string;
	title: string;
	detail: string;
	priority: 'P0' | 'P1' | 'P2';
	frequency: number;
	target?: string;
	factors: string[];
}

interface Report {
	overall: number;
	dimensions: Dimension[];
	slo: Slo[];
	sloStatus: SloStatus;
	gaps: Gap[];
	backlog: { P0: Gap[]; P1: Gap[]; P2: Gap[] };
	totals: {
		pages: number;
		endpoints: number;
		documentedEndpoints: number;
		tests: number;
		brokenLinks: number;
		stalePages: number;
		unansweredQuestions: number;
	};
	teams: Array<{ owner: string; pages: number; health: number }>;
	analytics: {
		counters: {
			queries: number;
			highConfidence: number;
			mediumConfidence: number;
			lowConfidence: number;
			unanswered: number;
			refused: number;
		};
		topUnanswered: Array<{ question: string; count: number }>;
		questionsStored: boolean;
	};
	audiences: {
		total: number;
		distribution: Array<{ audience: string; queries: number; share: number; unanswered: number }>;
	};
	minimumHealthScore: number;
	reliability: {
		brokenLinks: number;
		failedTests: number;
		brokenContracts: number;
		invalidPages: number;
		stalePages: number;
	};
	budgets: Array<{ name: string; allowed: number; used: number; remaining: number; exceeded: boolean }>;
	freshness: {
		fresh: number;
		potentiallyStale: number;
		stale: number;
		unknown: number;
		score: number;
		worst: Array<{ path: string; status: string; reasons: string[]; ageDays?: number }>;
	};
	regression: {
		delta: number;
		previous: number;
		current: number;
		since: string;
		byDimension: Array<{ dimension: string; delta: number }>;
		newIssues: string[];
	} | null;
	changeCandidates: Array<{ commit: string; subject: string; relevantFiles: string[] }>;
	pages: Array<{
		path: string;
		score: number | null;
		dimensions: Array<{ name: string; value: number; basis: string }>;
		unmeasured: Array<{ name: string; reason: string }>;
	}>;
	history: Array<{ at: string; score: number }>;
}

const DIMENSION_LABEL: Record<string, string> = {
	quality: 'Qualidade',
	contractIntegrity: 'Integridade de contrato',
	coverage: 'Cobertura',
	freshness: 'Frescor',
	reliability: 'Confiabilidade',
	trust: 'Confiança',
	aiReadiness: 'Preparo para IA',
	consistency: 'Consistência',
	testCoverage: 'Cobertura de testes',
	accessibility: 'Acessibilidade',
};

const STALENESS_MARK: Record<string, string> = {
	fresh: '🟢',
	'potentially-stale': '🟡',
	stale: '🔴',
	unknown: '⚪',
};

const STATUS_MARK: Record<SloStatus, string> = { healthy: '🟢', 'at-risk': '🟡', breached: '🔴' };
const STATUS_LABEL: Record<SloStatus, string> = {
	healthy: 'Saudável',
	'at-risk': 'Em risco',
	breached: 'SLO violado',
};

function barColor(value: number, measured: boolean): string {
	if (!measured) return 'var(--sl-color-gray-4)';
	if (value >= 90) return 'var(--sl-color-green)';
	if (value >= 75) return 'var(--sl-color-accent)';
	return 'var(--sl-color-red)';
}

export default function HealthPanel() {
	const [report, setReport] = useState<Report | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function load() {
		setLoading(true);
		setError(null);
		try {
			const response = await fetch('/api/admin/health');
			const data = await response.json();
			if (!response.ok) throw new Error(data?.error ?? 'Falha ao medir a saúde.');
			setReport(data as Report);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'Falha ao medir a saúde.');
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
			const response = await fetch('/api/admin/health', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
			});
			const data = await response.json();
			if (!response.ok) throw new Error(data?.error ?? 'Falha na ação.');

			if (Array.isArray(data.sent) && data.sent.length > 0) {
				setNotice(data.sent.map((item: { channel: string; detail: string }) => `${item.channel}: ${item.detail}`).join(' · '));
			} else {
				setNotice(data.message ?? 'Feito.');
			}
		} catch (cause) {
			setNotice(cause instanceof Error ? cause.message : 'Falha na ação.');
		} finally {
			setBusy(false);
		}
	}

	if (loading) return <p className="empty-state">Medindo a saúde da documentação…</p>;
	if (error) return <p className="form-error">{error}</p>;
	if (!report) return null;

	const breached = report.slo.filter((item) => item.status === 'breached');

	return (
		<div className="health-panel">
			<div className="stat-grid">
				<div className="stat-card">
					<p className="stat-card-label">Saúde geral</p>
					<p className="stat-card-value" style={{ color: barColor(report.overall, true) }}>
						{report.overall}%
					</p>
					<p className="stat-card-hint">
						{STATUS_MARK[report.sloStatus]} {STATUS_LABEL[report.sloStatus]}
					</p>
				</div>
				<div className="stat-card">
					<p className="stat-card-label">Páginas</p>
					<p className="stat-card-value">{report.totals.pages}</p>
					<p className="stat-card-hint">{report.totals.stalePages} com verificação vencida</p>
				</div>
				<div className="stat-card">
					<p className="stat-card-label">Endpoints</p>
					<p className="stat-card-value">
						{report.totals.documentedEndpoints}/{report.totals.endpoints}
					</p>
					<p className="stat-card-hint">documentados</p>
				</div>
				<div className="stat-card">
					<p className="stat-card-label">Links quebrados</p>
					<p
						className="stat-card-value"
						style={{ color: report.totals.brokenLinks > 0 ? 'var(--sl-color-red)' : undefined }}
					>
						{report.totals.brokenLinks}
					</p>
					<p className="stat-card-hint">{report.totals.tests} teste(s) rodados</p>
				</div>
			</div>

			{report.regression && report.regression.delta !== 0 && (
				<section className="panel">
					<h2>{report.regression.delta < 0 ? 'Regressão' : 'Melhora'}</h2>
					<p className="panel-hint">
						{report.regression.previous} → {report.regression.current} (
						<strong style={{ color: report.regression.delta < 0 ? 'var(--sl-color-red)' : 'var(--sl-color-green)' }}>
							{report.regression.delta > 0 ? '+' : ''}
							{report.regression.delta}
						</strong>
						) desde {report.regression.since.slice(0, 10)}.
					</p>

					{report.regression.byDimension.length > 0 && (
						<ul className="health-basis">
							{report.regression.byDimension.map((entry) => (
								<li key={entry.dimension}>
									{DIMENSION_LABEL[entry.dimension] ?? entry.dimension}: <strong>{entry.delta}</strong>
								</li>
							))}
						</ul>
					)}

					{report.regression.newIssues.length > 0 && (
						<p className="panel-hint">Defeitos novos: {report.regression.newIssues.join(', ')}</p>
					)}

					{report.changeCandidates.length > 0 && (
						<>
							<h3>Mudanças que podem explicar</h3>
							<p className="panel-hint">
								São <strong>candidatos</strong>, não causa: a documentação também degrada quando o produto muda
								e ninguém mexe nela — e nesse caso o commit responsável não está nesta lista.
							</p>
							<ul className="health-basis">
								{report.changeCandidates.map((candidate) => (
									<li key={candidate.commit}>
										<code>{candidate.commit.slice(0, 8)}</code> {candidate.subject}{' '}
										<span className="stat-card-hint">({candidate.relevantFiles.length} arquivo(s))</span>
									</li>
								))}
							</ul>
						</>
					)}
				</section>
			)}

			<section className="panel">
				<h2>Error budget</h2>
				<p className="panel-hint">
					Quanto ainda sobra antes de o compromisso estar quebrado. A leitura é do que <strong>resta</strong>, não
					do que já se gastou: quem vê "40% restante" decide diferente de quem vê "3 de 5".
				</p>
				<div className="breakdown">
					{report.budgets.map((budget) => (
						<div key={budget.name} className="breakdown-row breakdown-row--wide">
							<span className="breakdown-label">{budget.name}</span>
							<span className="breakdown-bar">
								<span
									style={{
										width: `${budget.remaining}%`,
										background: budget.exceeded
											? 'var(--sl-color-red)'
											: budget.remaining < 50
												? 'var(--sl-color-orange)'
												: 'var(--sl-color-green)',
									}}
								/>
							</span>
							<span className="breakdown-count">
								{budget.remaining}%{' '}
								<span className="stat-card-hint">
									({budget.used}/{budget.allowed})
								</span>
							</span>
						</div>
					))}
				</div>
			</section>

			<section className="panel">
				<h2>Frescor</h2>
				<p className="panel-hint">
					A idade sozinha <strong>não</strong> determina que uma página está obsoleta — conteúdo estável pode ficar
					válido por anos. O que decide é o cruzamento com evidência de divergência: contrato quebrado,
					proveniência inválida, a API mudando depois da última edição.
				</p>
				<div className="stat-grid">
					<div className="stat-card">
						<p className="stat-card-label">Atuais</p>
						<p className="stat-card-value">{report.freshness.fresh}</p>
					</div>
					<div className="stat-card">
						<p className="stat-card-label">Possivelmente obsoletas</p>
						<p className="stat-card-value">{report.freshness.potentiallyStale}</p>
					</div>
					<div className="stat-card">
						<p className="stat-card-label">Obsoletas</p>
						<p
							className="stat-card-value"
							style={{ color: report.freshness.stale > 0 ? 'var(--sl-color-red)' : undefined }}
						>
							{report.freshness.stale}
						</p>
					</div>
					<div className="stat-card">
						<p className="stat-card-label">Sem informação</p>
						<p className="stat-card-value">{report.freshness.unknown}</p>
						<p className="stat-card-hint">sem histórico de alteração</p>
					</div>
				</div>

				{report.freshness.worst.length > 0 && (
					<ul className="health-basis">
						{report.freshness.worst.slice(0, 12).map((verdict) => (
							<li key={verdict.path}>
								{STALENESS_MARK[verdict.status]} <code>{verdict.path}</code>
								<span className="stat-card-hint"> — {verdict.reasons.join('; ')}</span>
							</li>
						))}
					</ul>
				)}
			</section>

			<section className="panel">
				<h2>Páginas com menor saúde</h2>
				<p className="panel-hint">
					Cada página tem a própria nota, com as mesmas regras do painel: dimensão sem dado fica fora da média e
					aparece com o motivo. Uma página sem proveniência declarada não é uma página sem confiança — é uma
					página que ninguém anotou.
				</p>
				<div className="data-table-wrap">
					<table className="data-table">
						<thead>
							<tr>
								<th>Página</th>
								<th style={{ width: 90, textAlign: 'right' }}>Saúde</th>
								<th style={{ width: 260 }}>Não medido</th>
							</tr>
						</thead>
						<tbody>
							{report.pages.slice(0, 12).map((page) => (
								<tr key={page.path}>
									<td>
										<code>{page.path}</code>
									</td>
									<td style={{ textAlign: 'right', color: barColor(page.score ?? 0, page.score !== null) }}>
										{page.score === null ? '—' : page.score}
									</td>
									<td className="stat-card-hint">
										{page.unmeasured.map((entry) => entry.name).join(', ') || '—'}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</section>

			<section className="panel">
				<h2>Dimensões</h2>
				<p className="panel-hint">
					Nada é medido aqui de novo: cada número vem da camada que já o mede. Dimensão sem dado aparece como{' '}
					<strong>não medida</strong>, e não como zero — um portal ainda não medido não é um portal doente.
				</p>
				<div className="breakdown">
					{report.dimensions.map((dimension) => (
						<div key={dimension.dimension} className="breakdown-row breakdown-row--wide">
							<span className="breakdown-label">{DIMENSION_LABEL[dimension.dimension] ?? dimension.dimension}</span>
							<span className="breakdown-bar" title={dimension.basis}>
								<span
									style={{
										width: `${dimension.measured ? dimension.value : 100}%`,
										background: barColor(dimension.value, dimension.measured),
									}}
								/>
							</span>
							<span className="breakdown-count">{dimension.measured ? `${dimension.value}%` : '—'}</span>
						</div>
					))}
				</div>
				<ul className="health-basis">
					{report.dimensions.map((dimension) => (
						<li key={dimension.dimension}>
							<strong>{DIMENSION_LABEL[dimension.dimension] ?? dimension.dimension}:</strong> {dimension.basis}
						</li>
					))}
				</ul>
			</section>

			<section className="panel">
				<h2>SLO</h2>
				<div className="data-table-wrap">
					<table className="data-table">
						<thead>
							<tr>
								<th>Dimensão</th>
								<th style={{ width: 90, textAlign: 'right' }}>Atual</th>
								<th style={{ width: 90, textAlign: 'right' }}>Alvo</th>
								<th style={{ width: 160 }}>Status</th>
							</tr>
						</thead>
						<tbody>
							{report.slo.map((item) => (
								<tr key={item.dimension}>
									<td>{DIMENSION_LABEL[item.dimension] ?? item.dimension}</td>
									<td style={{ textAlign: 'right' }}>{item.measured ? `${item.current}%` : '—'}</td>
									<td style={{ textAlign: 'right' }}>{item.target}%</td>
									<td>
										{STATUS_MARK[item.status]} {STATUS_LABEL[item.status]}
										{!item.measured && <span className="stat-card-hint"> (não medida)</span>}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>

				<div className="health-actions">
					<button type="button" onClick={() => void act({ action: 'alert', channels: ['webhook'] })} disabled={busy}>
						Alertar por webhook
					</button>
					<button type="button" onClick={() => void act({ action: 'alert', channels: ['issue'] })} disabled={busy}>
						Abrir issue
					</button>
					<button type="button" onClick={() => void act({ action: 'snapshot' })} disabled={busy}>
						Gravar snapshot
					</button>
					<span className="stat-card-hint">
						{breached.length === 0
							? 'Nenhum SLO violado.'
							: `${breached.length} SLO(s) violado(s).`}{' '}
						O alerta não sai sozinho — notificação repetida é notificação silenciada.
					</span>
				</div>

				{notice && <p className="panel-hint">{notice}</p>}
			</section>

			<section className="panel">
				<h2>O que fazer primeiro</h2>
				<p className="panel-hint">
					A fila cruza os sinais que o portal já coleta: endpoint sem página, voto negativo, evidência inválida,
					teste reprovado, nota abaixo do mínimo. Cada item carrega <strong>por que</strong> recebeu a prioridade
					que recebeu.
				</p>
				{report.gaps.length === 0 ? (
					<p className="empty-state">Nenhuma lacuna detectada.</p>
				) : (
					(['P0', 'P1', 'P2'] as const).map((priority) =>
						report.backlog[priority].length === 0 ? null : (
							<div key={priority} className="health-backlog">
								<h3>
									{priority} <span className="stat-card-hint">({report.backlog[priority].length})</span>
								</h3>
								<ul>
									{report.backlog[priority].slice(0, 15).map((gap, index) => (
										<li key={`${gap.title}-${index}`}>
											<strong>{gap.title}</strong>
											<span className="health-gap-detail"> {gap.detail}</span>
											<span className="health-gap-factors"> ({gap.factors.join(', ')})</span>
										</li>
									))}
									{report.backlog[priority].length > 15 && (
										<li className="stat-card-hint">… e mais {report.backlog[priority].length - 15}</li>
									)}
								</ul>
							</div>
						)
					)
				)}
			</section>

			<section className="panel">
				<h2>Busca e assistente</h2>
				<div className="stat-grid">
					<div className="stat-card">
						<p className="stat-card-label">Consultas</p>
						<p className="stat-card-value">{report.analytics.counters.queries}</p>
					</div>
					<div className="stat-card">
						<p className="stat-card-label">Confiança alta</p>
						<p className="stat-card-value">
							{report.analytics.counters.queries === 0
								? '—'
								: `${Math.round((report.analytics.counters.highConfidence / report.analytics.counters.queries) * 100)}%`}
						</p>
					</div>
					<div className="stat-card">
						<p className="stat-card-label">Sem resposta</p>
						<p className="stat-card-value">{report.analytics.counters.unanswered}</p>
					</div>
					<div className="stat-card">
						<p className="stat-card-label">Recusadas por guardrail</p>
						<p className="stat-card-value">{report.analytics.counters.refused}</p>
					</div>
				</div>

				{report.analytics.questionsStored ? (
					<>
						<h3>Perguntas sem resposta mais frequentes</h3>
						{report.analytics.topUnanswered.length === 0 ? (
							<p className="empty-state">Nenhuma ainda.</p>
						) : (
							<ol className="health-questions">
								{report.analytics.topUnanswered.map((entry) => (
									<li key={entry.question}>
										{entry.question} <span className="stat-card-hint">{entry.count}×</span>
									</li>
								))}
							</ol>
						)}
						<div className="health-actions">
							<button type="button" onClick={() => void act({ action: 'forget-questions' })} disabled={busy}>
								Apagar o texto guardado
							</button>
							<span className="stat-card-hint">Os contadores permanecem.</span>
						</div>
					</>
				) : (
					<p className="panel-hint">
						O texto das perguntas <strong>não</strong> está sendo guardado. Os contadores acima não identificam
						ninguém e não registram o que foi perguntado. Para listar as perguntas sem resposta, ligue{' '}
						<code>documentation.analytics.storeUnansweredQuestions</code> em <code>health.yml</code> — é uma
						decisão de privacidade, e por isso ela é sua, não do padrão.
					</p>
				)}
			</section>

			{report.audiences.total > 0 && (
				<section className="panel">
					<h2>Por audiência</h2>
					<p className="panel-hint">
						Quem consulta a documentação, por perfil declarado. Só contadores — nem pergunta, nem página, nem
						quem perguntou. A distribuição é o que muda a prioridade do backlog; o rastro individual não
						mudaria nada e criaria um arquivo para proteger para sempre.
					</p>
					<div className="data-table-wrap">
						<table className="data-table">
							<thead>
								<tr>
									<th>Perfil</th>
									<th style={{ width: 110, textAlign: 'right' }}>Consultas</th>
									<th style={{ width: 90, textAlign: 'right' }}>Fatia</th>
									<th style={{ width: 130, textAlign: 'right' }}>Sem resposta</th>
								</tr>
							</thead>
							<tbody>
								{report.audiences.distribution.map((row) => (
									<tr key={row.audience}>
										<td>{row.audience === 'unknown' ? 'Não informado' : row.audience}</td>
										<td style={{ textAlign: 'right' }}>{row.queries}</td>
										<td style={{ textAlign: 'right' }}>{row.share}%</td>
										<td style={{ textAlign: 'right' }}>{row.unanswered}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</section>
			)}

			<section className="panel">
				<h2>Por responsável</h2>
				<div className="data-table-wrap">
					<table className="data-table">
						<thead>
							<tr>
								<th>Responsável</th>
								<th style={{ width: 100, textAlign: 'right' }}>Páginas</th>
								<th style={{ width: 100, textAlign: 'right' }}>Saúde</th>
							</tr>
						</thead>
						<tbody>
							{report.teams.map((team) => (
								<tr key={team.owner}>
									<td>{team.owner}</td>
									<td style={{ textAlign: 'right' }}>{team.pages}</td>
									<td style={{ textAlign: 'right', color: barColor(team.health, true) }}>{team.health}%</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</section>
		</div>
	);
}
