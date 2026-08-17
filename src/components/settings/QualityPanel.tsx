import { useEffect, useState } from 'react';

/**
 * Settings → Quality: relatório de qualidade do workspace (§68–§70).
 *
 * A análise roda sob demanda no servidor, o que pode levar alguns segundos num
 * portal grande — daí o estado de carregamento explícito em vez de um spinner
 * silencioso.
 */

interface PageRow {
	path: string;
	score: number;
	band: string;
	gate: 'pass' | 'warning' | 'fail';
	counts: { error: number; warning: number; suggestion: number; info: number };
	categories: Record<string, number>;
}

interface Report {
	summary: {
		averageScore: number;
		analyzed: number;
		passing: number;
		failing: number;
		bands: Record<string, number>;
		categoryAverages: Record<string, number>;
		topProblems: Array<{ ruleId: string; message: string; count: number }>;
		gate: 'pass' | 'warning' | 'fail';
	};
	minimumScore: number;
	pages: PageRow[];
}

const CATEGORY_LABELS: Record<string, string> = {
	grammar: 'Gramática',
	clarity: 'Clareza',
	conciseness: 'Concisão',
	structure: 'Estrutura',
	technicalWriting: 'Technical writing',
	consistency: 'Consistência',
	actionability: 'Acionabilidade',
	terminology: 'Terminologia',
	readability: 'Legibilidade',
	completeness: 'Completude',
};

function scoreColor(score: number, minimum: number): string {
	if (score < minimum) return 'var(--sl-color-red)';
	if (score < 9) return 'var(--sl-color-accent)';
	return 'var(--sl-color-green)';
}

export default function QualityPanel() {
	const [report, setReport] = useState<Report | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	async function load() {
		setLoading(true);
		setError(null);
		try {
			const response = await fetch('/api/admin/quality');
			if (!response.ok) throw new Error('Não foi possível analisar a documentação.');
			setReport(await response.json());
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Erro ao carregar.');
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		void load();
	}, []);

	if (loading) return <p className="empty-state">Analisando a documentação…</p>;
	if (error) return <p className="form-error">{error}</p>;
	if (!report) return null;

	const { summary, minimumScore, pages } = report;
	const failing = pages.filter((page) => page.gate === 'fail');

	return (
		<>
			<div className="toolbar">
				<div className="toolbar-end">
					<button type="button" className="btn" onClick={() => void load()}>
						Reanalisar
					</button>
				</div>
			</div>

			<div className="stat-grid">
				<div className="stat-card">
					<p className="stat-card-label">Nota média</p>
					<p className="stat-card-value" style={{ color: scoreColor(summary.averageScore, minimumScore) }}>
						{summary.averageScore.toFixed(1)}
					</p>
					<p className="stat-card-hint">mínimo exigido: {minimumScore.toFixed(1)}</p>
				</div>
				<div className="stat-card">
					<p className="stat-card-label">Páginas analisadas</p>
					<p className="stat-card-value">{summary.analyzed}</p>
				</div>
				<div className="stat-card">
					<p className="stat-card-label">Aprovadas</p>
					<p className="stat-card-value">{summary.passing}</p>
				</div>
				<div className="stat-card">
					<p className="stat-card-label">Reprovadas</p>
					<p className="stat-card-value" style={{ color: failing.length > 0 ? 'var(--sl-color-red)' : undefined }}>
						{summary.failing}
					</p>
				</div>
			</div>

			<section className="panel">
				<h2>Média por dimensão</h2>
				<div className="breakdown">
					{Object.entries(summary.categoryAverages)
						.sort((a, b) => a[1] - b[1])
						.map(([category, value]) => (
							<div key={category} className="breakdown-row breakdown-row--wide">
								<span className="breakdown-label">{CATEGORY_LABELS[category] ?? category}</span>
								<span className="breakdown-bar">
									<span
										style={{ width: `${value * 10}%`, background: scoreColor(value, minimumScore) }}
									/>
								</span>
								<span className="breakdown-count">{value.toFixed(1)}</span>
							</div>
						))}
				</div>
			</section>

			{summary.topProblems.length > 0 && (
				<section className="panel">
					<h2>Problemas mais frequentes</h2>
					<div className="data-table-wrap">
						<table className="data-table">
							<thead>
								<tr>
									<th style={{ width: 140 }}>Regra</th>
									<th>Exemplo</th>
									<th style={{ textAlign: 'right', width: 90 }}>Ocorrências</th>
								</tr>
							</thead>
							<tbody>
								{summary.topProblems.map((problem) => (
									<tr key={problem.ruleId}>
										<td className="cell-name" style={{ fontFamily: 'var(--shell-font-mono)', fontSize: '0.8rem' }}>
											{problem.ruleId}
										</td>
										<td className="cell-email">{problem.message}</td>
										<td style={{ textAlign: 'right' }}>{problem.count}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</section>
			)}

			<section className="panel">
				<h2>Páginas por nota</h2>
				<div className="data-table-wrap">
					<table className="data-table">
						<thead>
							<tr>
								<th>Página</th>
								<th style={{ width: 70, textAlign: 'right' }}>Nota</th>
								<th style={{ width: 130 }}>Faixa</th>
								<th style={{ width: 110, textAlign: 'right' }}>E / A / S</th>
							</tr>
						</thead>
						<tbody>
							{pages.map((page) => (
								<tr key={page.path}>
									<td className="cell-name">
										<a href={`/editor/${page.path.replace(/\.mdx?$/, '')}`}>{page.path}</a>
									</td>
									<td
										style={{
											textAlign: 'right',
											fontWeight: 600,
											color: scoreColor(page.score, minimumScore),
										}}
									>
										{page.score.toFixed(1)}
									</td>
									<td className="cell-email">{page.band}</td>
									<td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
										{page.counts.error} / {page.counts.warning} / {page.counts.suggestion}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</section>

			<p style={{ fontSize: '0.82rem', color: 'var(--sl-color-gray-2)', lineHeight: 1.6 }}>
				Avaliação editorial automatizada, baseada nas regras configuradas em <code>styles/</code>. Ela não
				verifica se a informação técnica está correta — isso continua sendo revisão humana.
			</p>
		</>
	);
}
