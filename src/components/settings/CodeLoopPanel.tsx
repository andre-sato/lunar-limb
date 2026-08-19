import { useEffect, useState } from 'react';

/**
 * Settings → Code Loop: o Documentation-to-Code Loop (P2.2).
 *
 * A tela responde três perguntas distintas que é fácil confundir numa só:
 *
 * - **Consistência** — dos vínculos declarados, quantos apontam para algo real?
 * - **Cobertura** — das entidades públicas, quantas têm vínculo declarado?
 * - **Órfãos** — que vínculos apontam para algo que não existe mais?
 *
 * Uma página com três vínculos corretos tem 100% de consistência e pode deixar
 * dez endpoints sem documentação nenhuma. Somar as duas num número só esconderia
 * exatamente o buraco que esta tela existe para mostrar.
 */

interface Slice {
	name: string;
	consistent: number;
	total: number;
	percentage: number | null;
}

interface Binding {
	documentationId: string;
	entityType: string;
	entityId: string;
	required: boolean;
	resolved: boolean;
	reason?: string;
}

interface Orphan {
	documentationId: string;
	entityId: string;
	entityType: string;
	reason: string;
}

interface Undocumented {
	entityId: string;
	entityType: string;
	required: boolean;
	evidence: string[];
}

interface Overview {
	consistency: { slices: Slice[]; overall: number | null };
	bindings: Binding[];
	orphans: Orphan[];
	undocumented: Undocumented[];
	policy: { requiredFor: string[]; releaseMinimumCoverage: number; failOnViolation: boolean };
}

const ENTITY_LABEL: Record<string, string> = {
	api: 'Endpoint',
	schema: 'Schema',
	service: 'Serviço',
	function: 'Função',
	class: 'Classe',
	event: 'Evento',
	database: 'Schema de banco',
	cli: 'Comando',
	config: 'Configuração',
	feature: 'Funcionalidade',
};

function colorFor(value: number | null): string | undefined {
	if (value === null) return undefined;
	if (value >= 95) return 'var(--sl-color-green)';
	if (value >= 80) return 'var(--sl-color-accent)';
	return 'var(--sl-color-red)';
}

export default function CodeLoopPanel() {
	const [data, setData] = useState<Overview | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let active = true;

		fetch('/api/admin/codeloop')
			.then(async (response) => {
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				return (await response.json()) as Overview;
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

	if (loading) return <p className="stat-card-hint">Carregando o loop…</p>;
	if (error) return <p className="stat-card-hint">Não consegui montar o relatório: {error}</p>;
	if (!data) return null;

	const unresolved = data.bindings.filter((binding) => !binding.resolved);
	const requiredMissing = data.undocumented.filter((entity) => entity.required);

	return (
		<div className="panel-stack">
			<section>
				<h3>Consistência</h3>
				<p className="stat-card-hint">
					Dos vínculos declarados no frontmatter, quantos apontam para algo que existe no produto. Fatia sem vínculo
					aparece como “—”, não como 0%: ausência de dado não é inconsistência.
				</p>

				{data.consistency.slices.map((slice) => (
					<div className="breakdown-row breakdown-row--wide" key={slice.name}>
						<span className="breakdown-label">{slice.name}</span>
						<span className="breakdown-bar">
							<span style={{ width: `${slice.percentage ?? 0}%`, background: colorFor(slice.percentage) }} />
						</span>
						<span className="breakdown-count">
							{slice.percentage === null ? '—' : `${slice.percentage}%`}{' '}
							<span className="stat-card-hint">
								({slice.consistent}/{slice.total})
							</span>
						</span>
					</div>
				))}
			</section>

			<section>
				<h3>Sem vínculo declarado ({data.undocumented.length})</h3>
				<p className="stat-card-hint">
					Entidade pública que nenhuma página declara documentar. Vínculo declarado, não menção em texto: uma frase
					citando o endpoint não é documentação dele.
					{requiredMissing.length > 0 && ` ${requiredMissing.length} são obrigatórias pela política.`}
				</p>

				{data.undocumented.length === 0 ? (
					<p className="stat-card-hint">Nenhuma. Toda entidade pública tem página vinculada.</p>
				) : (
					<ul className="plain-list">
						{data.undocumented.map((entity) => (
							<li key={entity.entityId}>
								<code>{entity.entityId}</code>
								{entity.required && <span className="badge badge--danger">obrigatório</span>}
								<span className="stat-card-hint"> {entity.evidence.join(' · ')}</span>
							</li>
						))}
					</ul>
				)}
			</section>

			<section>
				<h3>Vínculos ({data.bindings.length})</h3>
				{unresolved.length > 0 && (
					<p className="stat-card-hint">
						{unresolved.length} não resolve contra o Digital Twin. Um vínculo que não resolve não conta como
						cobertura — aceitá-lo transformaria a métrica em ficção.
					</p>
				)}

				<ul className="plain-list">
					{data.bindings.map((binding) => (
						<li key={`${binding.documentationId}:${binding.entityId}`}>
							<span aria-hidden="true">{binding.resolved ? '✓' : '✗'}</span> {ENTITY_LABEL[binding.entityType] ?? binding.entityType}{' '}
							<code>{binding.entityId}</code>
							<span className="stat-card-hint"> → {binding.documentationId}</span>
							{binding.reason && <div className="stat-card-hint">{binding.reason}</div>}
						</li>
					))}
				</ul>
			</section>

			{data.orphans.length > 0 && (
				<section>
					<h3>Potencialmente órfãos ({data.orphans.length})</h3>
					<p className="stat-card-hint">
						Sempre “potencialmente”: a página pode documentar comportamento histórico, uma versão anterior ou algo
						planejado.
					</p>
					<ul className="plain-list">
						{data.orphans.map((orphan) => (
							<li key={`${orphan.documentationId}:${orphan.entityId}`}>
								<code>{orphan.documentationId}</code>
								<span className="stat-card-hint"> aponta para {orphan.entityId}</span>
							</li>
						))}
					</ul>
				</section>
			)}

			<section>
				<h3>Política</h3>
				<p className="stat-card-hint">
					Documentação obrigatória para: {data.policy.requiredFor.map((type) => ENTITY_LABEL[type] ?? type).join(', ')}.
					Cobertura mínima para release: {data.policy.releaseMinimumCoverage}%.{' '}
					{data.policy.failOnViolation ? 'Violação obrigatória bloqueia o merge.' : 'Violações não bloqueiam o merge.'}
				</p>
				<p className="stat-card-hint">
					Configurada em <code>codeloop.yml</code>. Esta tela lê o repositório e não altera código — quem escreve
					conteúdo é o Agent Orchestrator, em workspace isolado e com aprovação humana.
				</p>
			</section>
		</div>
	);
}
