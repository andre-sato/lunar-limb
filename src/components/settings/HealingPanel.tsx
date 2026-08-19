import { useEffect, useState } from 'react';

/**
 * Settings → Self-Healing (P3.6 — §23).
 *
 * A tela mostra o funil — detectado, diagnosticado, proposto, revisado — e o que
 * **parou** em cada etapa. Um painel que só mostra o que avançou faria parecer
 * que o ciclo funciona; o que ensina é onde ele para, e por quê.
 */

interface Issue {
	id: string;
	type: string;
	severity: string;
	confidence: number;
	summary: string;
	affectedPages: string[];
}

interface Validation {
	name: string;
	passed: boolean | null;
	detail: string;
}

interface Record_ {
	issueId: string;
	issue: Issue;
	diagnosis?: { rootCause: string; confidence: number; unhealable: boolean; reason?: string; conflict?: { reason: string } };
	candidate?: { risk: string; validated: boolean; validations: Validation[]; changes: Array<{ path: string; added: number; removed: number }> };
	attempts: number;
	status: string;
	timeline: Array<{ at: string; event: string; detail?: string }>;
}

interface Payload {
	summary: {
		detected: number;
		candidates: number;
		drafted: number;
		pullRequests: number;
		resolved: number;
		failed: number;
		successRate: number | null;
		byType: Record<string, number>;
	};
	policy: { autonomy: number; maxAttempts: number; minimumConfidence: number };
	records: Record_[];
}

const ISSUE_LABEL: Record<string, string> = {
	stale: 'Documentação defasada',
	'contract-mismatch': 'Divergência de contrato',
	'broken-example': 'Exemplo quebrado',
	'missing-documentation': 'Documentação ausente',
	terminology: 'Inconsistência de terminologia',
	'behavioral-gap': 'Lacuna sugerida por comportamento',
};

const AUTONOMY_LABEL: Record<number, string> = {
	0: 'Só detectar',
	1: 'Detectar e explicar',
	2: 'Detectar e redigir',
	3: 'Detectar, redigir, validar e abrir PR',
	4: 'Merge automático',
};

export default function HealingPanel() {
	const [data, setData] = useState<Payload | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const load = () => {
		fetch('/api/admin/heal')
			.then(async (response) => {
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				return (await response.json()) as Payload;
			})
			.then(setData)
			.catch((cause) => setError(cause instanceof Error ? cause.message : 'Falha ao carregar.'));
	};

	useEffect(load, []);

	const act = (action: string, issueId?: string) => {
		setBusy(true);
		setError(null);

		fetch('/api/admin/heal', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action, issueId }),
		})
			.then(async (response) => {
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				return response.json();
			})
			.then(load)
			.catch((cause) => setError(cause instanceof Error ? cause.message : 'Falha ao executar.'))
			.finally(() => setBusy(false));
	};

	if (error && !data) return <p className="stat-card-hint">{error}</p>;
	if (!data) return <p className="stat-card-hint">Carregando o ciclo…</p>;

	const { summary, policy } = data;

	return (
		<div className="panel-stack">
			<section>
				<h3>Funil</h3>
				<div className="stat-grid">
					<div className="stat-card">
						<span className="stat-card-value">{summary.detected}</span>
						<span className="stat-card-label">Detectados</span>
					</div>
					<div className="stat-card">
						<span className="stat-card-value">{summary.candidates}</span>
						<span className="stat-card-label">Diagnosticados</span>
					</div>
					<div className="stat-card">
						<span className="stat-card-value">{summary.drafted}</span>
						<span className="stat-card-label">Com proposta</span>
					</div>
					<div className="stat-card">
						<span className="stat-card-value">{summary.successRate === null ? '—' : `${summary.successRate}%`}</span>
						<span className="stat-card-label">Taxa de sucesso</span>
						<span className="stat-card-hint">
							{summary.successRate === null ? 'Nada concluído ainda.' : `${summary.resolved} resolvidos, ${summary.failed} falharam.`}
						</span>
					</div>
				</div>

				<p className="stat-card-hint">
					Nível {policy.autonomy} — {AUTONOMY_LABEL[policy.autonomy]}. Merge automático está desligado: nada é publicado
					sem aprovação humana, e o texto proposto vive no workspace isolado dos agentes.
				</p>

				<button type="button" onClick={() => act('detect')} disabled={busy}>
					{busy ? 'Executando…' : 'Detectar problemas'}
				</button>
				{error && <p className="stat-card-hint">{error}</p>}
			</section>

			<section>
				<h3>Problemas ({data.records.length})</h3>

				{data.records.length === 0 ? (
					<p className="stat-card-hint">Nenhum. As camadas de verificação não apontaram nada.</p>
				) : (
					<ul className="plain-list">
						{data.records.map((record) => (
							<li key={record.issueId}>
								<strong>{ISSUE_LABEL[record.issue.type] ?? record.issue.type}</strong>{' '}
								<span className="stat-card-hint">
									{record.issue.severity} · {Math.round(record.issue.confidence * 100)}% · {record.status}
									{record.attempts > 0 && ` · ${record.attempts}/${policy.maxAttempts} tentativa(s)`}
								</span>
								<div>{record.issue.summary}</div>

								{record.diagnosis && (
									<div className="stat-card-hint">
										Causa provável: {record.diagnosis.rootCause} ({Math.round(record.diagnosis.confidence * 100)}%)
										{record.diagnosis.conflict && ` — ${record.diagnosis.conflict.reason}`}
										{record.diagnosis.unhealable && record.diagnosis.reason && ` — ${record.diagnosis.reason}`}
									</div>
								)}

								{record.candidate && (
									<div className="stat-card-hint">
										Proposta: {record.candidate.changes.length} arquivo(s) · risco {record.candidate.risk} ·{' '}
										{record.candidate.validated ? 'validada' : 'validação incompleta'}
										{record.candidate.validations
											.filter((validation) => validation.passed !== true)
											.map((validation) => (
												<div key={validation.name}>
													{validation.passed === null ? '·' : '✗'} {validation.name}: {validation.detail}
												</div>
											))}
									</div>
								)}

								<button type="button" onClick={() => act('diagnose', record.issueId)} disabled={busy}>
									diagnosticar
								</button>{' '}
								<button type="button" onClick={() => act('draft', record.issueId)} disabled={busy}>
									redigir proposta
								</button>
							</li>
						))}
					</ul>
				)}
			</section>

			{Object.keys(summary.byType).length > 0 && (
				<section>
					<h3>Por tipo</h3>
					<ul className="plain-list">
						{Object.entries(summary.byType)
							.sort((a, b) => b[1] - a[1])
							.map(([type, count]) => (
								<li key={type}>
									{ISSUE_LABEL[type] ?? type} <span className="stat-card-hint">{count}</span>
								</li>
							))}
					</ul>
				</section>
			)}

			<section>
				<h3>O que este ciclo não faz</h3>
				<ul className="plain-list">
					<li className="stat-card-hint">Não inventa fatos: sem fonte autoritativa, o diagnóstico recusa.</li>
					<li className="stat-card-hint">Não altera código: os agentes só escrevem em <code>src/content</code>.</li>
					<li className="stat-card-hint">
						Não escolhe entre fontes que discordam: conflito vira lacuna para intervenção humana.
					</li>
					<li className="stat-card-hint">
						Não mascara falha de validação: validação que não roda vale “não verificado”, nunca “aprovado”.
					</li>
					<li className="stat-card-hint">Não faz merge, em nível de autonomia nenhum.</li>
				</ul>
			</section>
		</div>
	);
}
