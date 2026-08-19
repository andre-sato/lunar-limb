import { useEffect, useState } from 'react';

/**
 * Settings → AI Evaluation (P3.3).
 *
 * A tela precisa deixar visível a diferença entre **medido** e **não medido**,
 * porque é aí que uma avaliação de IA vira teatro: um caso que não pôde ser
 * avaliado somado como aprovado produz o número mais confortável e mais vazio
 * do painel.
 */

interface Metric {
	value: number | null;
	judge: string;
	detail: string;
}

interface CaseResult {
	caseId: string;
	dataset: string;
	kind: string;
	score: number | null;
	passed: boolean | null;
	metrics: { termCoverage: Metric; citationValidity: Metric; sourceRecall: Metric; safety: Metric };
	trace: { cited: string[]; latencyMs: number; retrievalOnly: boolean; refused: boolean };
	notes: string[];
}

interface Run {
	id: string;
	at: string;
	label: string;
	model: string | null;
	results: CaseResult[];
	summary: {
		total: number;
		passed: number;
		failed: number;
		unmeasured: number;
		averageScore: number | null;
		termCoverage: number | null;
		citationValidity: number | null;
		sourceRecall: number | null;
		safety: number | null;
		medianLatencyMs: number | null;
		retrievalOnly: boolean;
		limitations: string[];
	};
}

const KIND_LABEL: Record<string, string> = {
	golden: 'Referência',
	regression: 'Regressão',
	adversarial: 'Adversarial',
	real: 'Pergunta real',
};

function percent(value: number | null): string {
	return value === null ? '— não medido' : `${Math.round(value * 100)}%`;
}

export default function AiEvalPanel() {
	const [run, setRun] = useState<Run | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [running, setRunning] = useState(false);

	const load = () => {
		setLoading(true);
		fetch('/api/admin/ai-eval')
			.then(async (response) => {
				if (response.status === 404) return null;
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				return (await response.json()) as Run;
			})
			.then(setRun)
			.catch((cause) => setError(cause instanceof Error ? cause.message : 'Falha ao carregar.'))
			.finally(() => setLoading(false));
	};

	useEffect(load, []);

	const execute = () => {
		setRunning(true);
		setError(null);

		fetch('/api/admin/ai-eval', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ label: 'local' }),
		})
			.then(async (response) => {
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				return (await response.json()) as Run;
			})
			.then(setRun)
			.catch((cause) => setError(cause instanceof Error ? cause.message : 'Falha ao executar.'))
			.finally(() => setRunning(false));
	};

	if (loading) return <p className="stat-card-hint">Carregando avaliações…</p>;

	return (
		<div className="panel-stack">
			<section>
				<h3>Executar</h3>
				<p className="stat-card-hint">
					Os conjuntos de perguntas ficam em <code>evals/</code>, versionados pelo Git: são um acordo da equipe sobre o
					comportamento esperado, e acordo que vive no banco de alguém não aparece em revisão de pull request.
				</p>
				<button type="button" onClick={execute} disabled={running}>
					{running ? 'Executando…' : 'Executar avaliação'}
				</button>
				{error && <p className="stat-card-hint">{error}</p>}
			</section>

			{!run ? (
				<section>
					<p className="stat-card-hint">Nenhuma corrida guardada ainda.</p>
				</section>
			) : (
				<>
					<section>
						<h3>
							Última corrida <span className="stat-card-hint">{run.at.slice(0, 19).replace('T', ' ')}</span>
						</h3>

						<div className="stat-grid">
							<div className="stat-card">
								<span className="stat-card-value">
									{run.summary.averageScore === null ? '—' : run.summary.averageScore.toFixed(1)}
								</span>
								<span className="stat-card-label">Nota média</span>
							</div>
							<div className="stat-card">
								<span className="stat-card-value">
									{run.summary.passed}/{run.summary.total - run.summary.unmeasured}
								</span>
								<span className="stat-card-label">Aprovados</span>
							</div>
							<div className="stat-card">
								<span className="stat-card-value">{run.summary.unmeasured}</span>
								<span className="stat-card-label">Não medidos</span>
								<span className="stat-card-hint">Fora das médias, nunca contados como falha.</span>
							</div>
							<div className="stat-card">
								<span className="stat-card-value">
									{run.summary.medianLatencyMs === null ? '—' : `${run.summary.medianLatencyMs}ms`}
								</span>
								<span className="stat-card-label">Latência mediana</span>
							</div>
						</div>

						<ul className="plain-list">
							<li>
								Termos presentes <strong>{percent(run.summary.termCoverage)}</strong>{' '}
								<span className="stat-card-hint">presença de palavra, não verdade</span>
							</li>
							<li>
								Citações válidas <strong>{percent(run.summary.citationValidity)}</strong>
							</li>
							<li>
								Páginas esperadas <strong>{percent(run.summary.sourceRecall)}</strong>
							</li>
							<li>
								Segurança <strong>{percent(run.summary.safety)}</strong>
							</li>
						</ul>

						<p className="stat-card-hint">
							{run.model === null
								? 'Sem modelo de linguagem configurado: o que foi medido é a recuperação de trechos, não a resposta gerada. Os casos adversariais não podem ser avaliados neste regime, porque os guardrails não rodam.'
								: `Modelo: ${run.model}.`}
						</p>
					</section>

					<section>
						<h3>Casos</h3>
						<ul className="plain-list">
							{run.results.map((result) => (
								<li key={result.caseId}>
									<span aria-hidden="true">{result.passed === null ? '·' : result.passed ? '✓' : '✗'}</span>{' '}
									<strong>{result.score === null ? '—' : result.score.toFixed(1)}</strong> <code>{result.caseId}</code>{' '}
									<span className="stat-card-hint">{KIND_LABEL[result.kind] ?? result.kind}</span>
									{result.notes.map((note) => (
										<div className="stat-card-hint" key={note}>
											{note}
										</div>
									))}
									{result.passed === false &&
										Object.entries(result.metrics)
											.filter(([, metric]) => metric.value !== null && metric.value < 1)
											.map(([name, metric]) => (
												<div className="stat-card-hint" key={name}>
													{metric.detail}
												</div>
											))}
								</li>
							))}
						</ul>
					</section>

					{run.summary.limitations.length > 0 && (
						<section>
							<h3>O que esta corrida não sustenta</h3>
							<ul className="plain-list">
								{run.summary.limitations.map((note) => (
									<li key={note} className="stat-card-hint">
										{note}
									</li>
								))}
							</ul>
						</section>
					)}
				</>
			)}
		</div>
	);
}
