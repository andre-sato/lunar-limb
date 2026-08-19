import { useEffect, useState } from 'react';

/**
 * Settings → Agents: as execuções (§31).
 *
 * A tela é feita para **revisar**, não para admirar. O que ela mostra em primeiro
 * plano é o diff — porque é sobre ele que a pessoa decide — e, ao lado, de onde
 * cada afirmação veio e o que a validação disse.
 *
 * Aprovar aqui não publica. O botão muda o estado da execução; o conteúdo
 * continua no workspace isolado até alguém aplicá-lo, e o texto do botão diz isso.
 */

interface Step {
	agent: string;
	label: string;
	status: string;
	confidence?: number;
	tools?: string[];
	output?: unknown;
}

interface Change {
	path: string;
	kind: 'create' | 'update';
	diff: string;
}

interface Run {
	id: string;
	task: { instruction: string; target?: string; type: string };
	status: string;
	autonomy: number;
	steps: Step[];
	changes: Change[];
	confidence: Record<string, number>;
	blockedReason?: string;
	research?: {
		facts: Array<{ fact: string; source: string; confidence: number }>;
		sources: string[];
		unknowns: string[];
		conflicts: Array<{ subject: string; positions: Array<{ source: string; value: string }> }>;
	};
	pullRequestBody?: string;
	createdBy: string;
	createdAt: string;
}

const STATUS_LABEL: Record<string, string> = {
	queued: 'Na fila',
	running: 'Executando',
	'awaiting-approval': 'Aguardando aprovação',
	approved: 'Aprovado',
	rejected: 'Rejeitado',
	blocked: 'Bloqueado',
	failed: 'Falhou',
	cancelled: 'Cancelado',
	completed: 'Concluído',
};

const AGENT_LABEL: Record<string, string> = {
	researcher: 'Pesquisa',
	writer: 'Redação',
	reviewer: 'Revisão',
	tester: 'Testes',
	auditor: 'Auditoria',
	orchestrator: 'Orquestrador',
};

function stepColor(status: string): string | undefined {
	if (status === 'completed') return 'var(--sl-color-green)';
	if (status === 'failed') return 'var(--sl-color-red)';
	if (status === 'blocked') return 'var(--sl-color-orange)';
	return undefined;
}

export default function AgentsPanel() {
	const [runs, setRuns] = useState<Run[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [open, setOpen] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);

	const [instruction, setInstruction] = useState('');
	const [target, setTarget] = useState('');
	const [autonomy, setAutonomy] = useState(2);

	async function load() {
		setLoading(true);
		try {
			const response = await fetch('/api/admin/agents');
			const data = await response.json();
			if (!response.ok) throw new Error(data?.error ?? 'Falha ao listar execuções.');
			setRuns(data.runs as Run[]);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'Falha ao listar execuções.');
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
			const response = await fetch('/api/admin/agents', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
			});
			const data = await response.json();
			if (!response.ok) throw new Error(data?.message ?? data?.error ?? 'Falha na ação.');

			setNotice(data.message ?? data.blockedReason ?? 'Execução concluída.');
			await load();
		} catch (cause) {
			setNotice(cause instanceof Error ? cause.message : 'Falha na ação.');
		} finally {
			setBusy(false);
		}
	}

	if (loading) return <p className="empty-state">Carregando execuções…</p>;
	if (error) return <p className="form-error">{error}</p>;

	return (
		<div className="agents-panel">
			<section className="panel">
				<h2>Nova execução</h2>
				<p className="panel-hint">
					O agente pesquisa nas fontes do portal, rascunha num workspace isolado e valida com o linter, os testes de
					documentação, os testes de contrato e a auditoria de proveniência. <strong>Nada é publicado
					automaticamente</strong>, mesmo com todos os testes verdes.
				</p>

				<div className="git-row">
					<input
						type="text"
						placeholder="O que precisa ser documentado"
						value={instruction}
						disabled={busy}
						onChange={(event) => setInstruction(event.target.value)}
					/>
				</div>
				<div className="git-row">
					<input
						type="text"
						placeholder="Página alvo (opcional): api-reference/authentication.md"
						value={target}
						disabled={busy}
						onChange={(event) => setTarget(event.target.value)}
					/>
					<select value={autonomy} disabled={busy} onChange={(event) => setAutonomy(Number(event.target.value))}>
						<option value={0}>0 — Sugerir</option>
						<option value={1}>1 — Rascunhar</option>
						<option value={2}>2 — Validar</option>
						<option value={3}>3 — Pull request</option>
					</select>
					<button
						type="button"
						disabled={busy || instruction.trim() === ''}
						onClick={() => void act({ action: 'run', instruction, target, autonomy })}
					>
						Executar
					</button>
				</div>

				{notice && <p className="panel-hint">{notice}</p>}
			</section>

			<section className="panel">
				<h2>Execuções</h2>
				{runs.length === 0 ? (
					<p className="empty-state">Nenhuma execução ainda.</p>
				) : (
					<div className="data-table-wrap">
						<table className="data-table">
							<thead>
								<tr>
									<th style={{ width: 100 }}>Id</th>
									<th>Tarefa</th>
									<th style={{ width: 180 }}>Estado</th>
									<th style={{ width: 90, textAlign: 'right' }}>Arquivos</th>
								</tr>
							</thead>
							<tbody>
								{runs.map((run) => (
									<tr key={run.id} style={{ cursor: 'pointer' }} onClick={() => setOpen(open === run.id ? null : run.id)}>
										<td>
											<code>{run.id.slice(0, 8)}</code>
										</td>
										<td>{run.task.instruction}</td>
										<td>{STATUS_LABEL[run.status] ?? run.status}</td>
										<td style={{ textAlign: 'right' }}>{run.changes.length}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>

			{runs
				.filter((run) => run.id === open)
				.map((run) => (
					<section className="panel" key={run.id}>
						<h2>{run.task.instruction}</h2>
						<p className="panel-hint">
							{STATUS_LABEL[run.status] ?? run.status} · criada por {run.createdBy} em {run.createdAt.slice(0, 16).replace('T', ' ')}
						</p>

						{run.blockedReason && (
							<p className="panel-hint" style={{ color: 'var(--sl-color-orange)' }}>
								{run.blockedReason}
							</p>
						)}

						<h3>Etapas</h3>
						<ul className="health-basis">
							{run.steps.map((step, index) => (
								<li key={`${step.agent}-${index}`} style={{ color: stepColor(step.status) }}>
									<strong>{AGENT_LABEL[step.agent] ?? step.agent}</strong> — {step.label}: {step.status}
									{step.confidence !== undefined && (
										<span className="stat-card-hint"> ({Math.round(step.confidence * 100)}%)</span>
									)}
									{step.tools && step.tools.length > 0 && (
										<span className="stat-card-hint"> · {step.tools.join(', ')}</span>
									)}
								</li>
							))}
						</ul>

						{run.research && (
							<>
								<h3>Evidência</h3>
								<p className="panel-hint">
									O agente só escreve o que estas fontes sustentam. O que não tinha evidência ficou marcado no
									texto em vez de preenchido com suposição.
								</p>
								<ul className="health-basis">
									{run.research.facts.slice(0, 12).map((fact, index) => (
										<li key={index}>
											{fact.fact} <span className="stat-card-hint">({fact.source}, {Math.round(fact.confidence * 100)}%)</span>
										</li>
									))}
								</ul>

								{run.research.conflicts.length > 0 && (
									<>
										<h3>Conflitos</h3>
										<ul className="health-basis">
											{run.research.conflicts.map((conflict, index) => (
												<li key={index}>
													<strong>{conflict.subject}</strong>:{' '}
													{conflict.positions.map((position) => `${position.source} diz ${position.value}`).join(' · ')}
												</li>
											))}
										</ul>
									</>
								)}

								{run.research.unknowns.length > 0 && (
									<>
										<h3>Lacunas</h3>
										<ul className="health-basis">
											{run.research.unknowns.map((unknown, index) => (
												<li key={index}>{unknown}</li>
											))}
										</ul>
									</>
								)}
							</>
						)}

						{run.changes.length > 0 && (
							<>
								<h3>Alterações propostas</h3>
								{run.changes.map((change) => (
									<div key={change.path}>
										<p>
											<code>{change.path}</code>{' '}
											<span className="stat-card-hint">({change.kind === 'create' ? 'nova' : 'alterada'})</span>
										</p>
										<pre className="agent-diff">
											{change.diff.split('\n').map((line, index) => (
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
									</div>
								))}
							</>
						)}

						<div className="health-actions">
							<button type="button" disabled={busy} onClick={() => void act({ action: 'approve', id: run.id })}>
								Aprovar
							</button>
							<button type="button" disabled={busy} onClick={() => void act({ action: 'reject', id: run.id })}>
								Rejeitar
							</button>
							<span className="stat-card-hint">
								Aprovar <strong>não publica</strong>: o conteúdo continua no workspace isolado até ser aplicado.
							</span>
						</div>
					</section>
				))}
		</div>
	);
}
