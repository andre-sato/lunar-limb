import { useEffect, useState } from 'react';

/**
 * Settings → Governance (P3.1).
 *
 * A tela separa duas pendências que dão o mesmo trabalho e têm causas
 * diferentes: **vencida** é a página que foi revisada e cujo intervalo passou;
 * **nunca revisada** é a página que entrou no regime e nunca teve revisão
 * declarada. Somar as duas diria à equipe, no primeiro dia de qualquer regime,
 * que ela está atrasada em algo que acabou de ser criado.
 */

interface Slice {
	covered?: number;
	compliant?: number;
	total: number;
	percentage: number | null;
}

interface Status {
	path: string;
	state: string;
	reviewedAt: string | null;
	daysUntilDue: number | null;
	expired: boolean;
	neverReviewed: boolean;
	underRegime: boolean;
	severity: string;
	slaDays: number | null;
	slaBreached: boolean;
}

interface Approval {
	path: string;
	triggers: string[];
	satisfied: boolean;
	reason: string;
}

interface Snapshot {
	compliance: {
		ownership: Slice;
		review: Slice;
		approval: Slice;
		expiredReviews: number;
		neverReviewed: number;
		unownedPages: string[];
		slaBreaches: number;
	};
	statuses: Status[];
	approvals: Approval[];
	pages: Array<{ path: string; owner?: { id: string; label?: string }; inherited: Record<string, string | undefined> }>;
}

const STATE_LABEL: Record<string, string> = {
	draft: 'Rascunho',
	'in-review': 'Em revisão',
	approved: 'Aprovada',
	published: 'Publicada',
	'review-required': 'Revisão pendente',
};

const TRIGGER_LABEL: Record<string, string> = {
	'public-api': 'API pública',
	'breaking-change': 'Mudança incompatível',
	'security-sensitive': 'Sensível a segurança',
};

function colorFor(value: number | null): string | undefined {
	if (value === null) return undefined;
	if (value >= 95) return 'var(--sl-color-green)';
	if (value >= 80) return 'var(--sl-color-accent)';
	return 'var(--sl-color-red)';
}

function Row({ label, slice }: { label: string; slice: Slice }) {
	const covered = slice.covered ?? slice.compliant ?? 0;
	return (
		<div className="breakdown-row breakdown-row--wide">
			<span className="breakdown-label">{label}</span>
			<span className="breakdown-bar">
				<span style={{ width: `${slice.percentage ?? 0}%`, background: colorFor(slice.percentage) }} />
			</span>
			<span className="breakdown-count">
				{slice.percentage === null ? '—' : `${slice.percentage}%`}{' '}
				<span className="stat-card-hint">
					({covered}/{slice.total})
				</span>
			</span>
		</div>
	);
}

export default function GovernancePanel() {
	const [data, setData] = useState<Snapshot | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let active = true;

		fetch('/api/admin/governance')
			.then(async (response) => {
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				return (await response.json()) as Snapshot;
			})
			.then((payload) => {
				if (active) setData(payload);
			})
			.catch((cause) => {
				if (active) setError(cause instanceof Error ? cause.message : 'Falha ao carregar.');
			})
			.finally(() => {
				if (active) setLoading(false);
			});

		return () => {
			active = false;
		};
	}, []);

	if (loading) return <p className="stat-card-hint">Carregando a governança…</p>;
	if (error) return <p className="stat-card-hint">Não consegui montar o relatório: {error}</p>;
	if (!data) return null;

	const { compliance } = data;
	const pending = data.statuses.filter((status) => status.expired || (status.neverReviewed && status.underRegime));
	const missingApprover = data.approvals.filter((approval) => !approval.satisfied);

	return (
		<div className="panel-stack">
			<section>
				<h3>Conformidade</h3>
				<Row label="Cobertura de dono" slice={compliance.ownership} />
				<Row label="Revisões em dia" slice={compliance.review} />
				<Row label="Aprovações designadas" slice={compliance.approval} />

				<p className="stat-card-hint">
					A conta de revisão considera apenas as páginas sob regime — as que alguma regra do <code>governance.yml</code>{' '}
					obriga a revisar. Uma página fora do regime não está em dia nem atrasada.
				</p>
			</section>

			<section>
				<h3>Pendências</h3>
				<div className="stat-grid">
					<div className="stat-card">
						<span className="stat-card-value">{compliance.expiredReviews}</span>
						<span className="stat-card-label">Revisões vencidas</span>
						<span className="stat-card-hint">Revisadas, e o intervalo passou.</span>
					</div>
					<div className="stat-card">
						<span className="stat-card-value">{compliance.neverReviewed}</span>
						<span className="stat-card-label">Nunca revisadas</span>
						<span className="stat-card-hint">Sob regime, sem revisão declarada.</span>
					</div>
					<div className="stat-card">
						<span className="stat-card-value">{compliance.slaBreaches}</span>
						<span className="stat-card-label">SLA estourado</span>
					</div>
					<div className="stat-card">
						<span className="stat-card-value">{compliance.unownedPages.length}</span>
						<span className="stat-card-label">Páginas sem dono</span>
					</div>
				</div>

				{pending.length > 0 && (
					<ul className="plain-list">
						{pending.slice(0, 30).map((status) => (
							<li key={status.path}>
								<span aria-hidden="true">{status.slaBreached ? '✗' : '⚠'}</span> <code>{status.path}</code>
								<span className="stat-card-hint">
									{' '}
									{status.neverReviewed
										? 'nunca revisada, e a regra exige revisão periódica'
										: `venceu há ${-(status.daysUntilDue ?? 0)} dia(s)`}{' '}
									· severidade {status.severity}
									{status.slaDays !== null && ` · SLA ${status.slaDays}d`}
								</span>
							</li>
						))}
					</ul>
				)}
			</section>

			{compliance.unownedPages.length > 0 && (
				<section>
					<h3>Sem dono declarado ({compliance.unownedPages.length})</h3>
					<ul className="plain-list">
						{compliance.unownedPages.slice(0, 30).map((page) => (
							<li key={page}>
								<code>{page}</code>
							</li>
						))}
					</ul>
				</section>
			)}

			<section>
				<h3>Aprovação obrigatória ({data.approvals.length})</h3>
				<p className="stat-card-hint">
					“Designada” significa que existe um aprovador para a página — não que alguém aprovou. Quem registra a
					aprovação é o provedor de Git, no pull request; afirmar aqui que a mudança foi aprovada seria afirmar algo que
					esta camada não enxerga.
				</p>

				{data.approvals.length === 0 ? (
					<p className="stat-card-hint">Nenhuma página dispara os gatilhos configurados.</p>
				) : (
					<ul className="plain-list">
						{data.approvals.map((approval) => (
							<li key={approval.path}>
								<span aria-hidden="true">{approval.satisfied ? '✓' : '✗'}</span> <code>{approval.path}</code>
								<span className="stat-card-hint">
									{' '}
									{approval.triggers.map((trigger) => TRIGGER_LABEL[trigger] ?? trigger).join(', ')}
								</span>
							</li>
						))}
					</ul>
				)}

				{missingApprover.length > 0 && (
					<p className="stat-card-hint">
						{missingApprover.length} exigem aprovação e não têm aprovador designado.
					</p>
				)}
			</section>

			<section>
				<h3>Estado das páginas</h3>
				<ul className="plain-list">
					{Object.entries(
						data.statuses.reduce<Record<string, number>>((counts, status) => {
							counts[status.state] = (counts[status.state] ?? 0) + 1;
							return counts;
						}, {})
					)
						.sort((a, b) => b[1] - a[1])
						.map(([state, count]) => (
							<li key={state}>
								{STATE_LABEL[state] ?? state} <span className="stat-card-hint">{count}</span>
							</li>
						))}
				</ul>

				<p className="stat-card-hint">
					“Revisada” é o que alguém declarou no frontmatter, nunca a data do último commit: corrigir uma vírgula não
					reinicia o relógio de uma página que ninguém leu.
				</p>
			</section>
		</div>
	);
}
