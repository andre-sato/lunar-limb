import { useEffect, useMemo, useState } from 'react';

/**
 * Settings → Analytics: métricas do Do11y e configuração da integração.
 *
 * A chave `service_role` nunca chega aqui — a API devolve só um indicador de
 * que existe e os últimos caracteres. O campo de senha começa vazio e, em
 * branco, preserva a chave gravada.
 */

interface Counted {
	label: string;
	count: number;
}

interface Metrics {
	totalEvents: number;
	pageViews: number;
	sessions: number;
	timeline: Array<{ date: string; count: number }>;
	topPages: Array<{ path: string; title: string; views: number }>;
	eventTypes: Counted[];
	trafficSources: Counted[];
	aiPlatforms: Counted[];
	devices: Counted[];
	aiShare: number;
	aiSessions: number;
	truncated: boolean;
}

interface AdminConfig {
	enabled: boolean;
	supabaseUrl: string;
	supabaseKey: string;
	table: string;
	scriptVersion: string;
	trackScrollDepth: boolean;
	trackSectionVisibility: boolean;
	trackOutboundLinks: boolean;
	trackInternalLinks: boolean;
	trackTocClicks: boolean;
	trackFeedback: boolean;
	respectDNT: boolean;
	debug: boolean;
	hasServiceRoleKey: boolean;
	serviceRoleKeyHint: string;
	managedByEnv: boolean;
}

type AnalyticsState =
	| { state: 'loading' }
	| { state: 'disabled' }
	| { state: 'unconfigured' }
	| { state: 'error'; message: string }
	| { state: 'ok'; range: string; since: string; metrics: Metrics };

const RANGES = [
	{ key: '24h', label: '24 horas' },
	{ key: '7d', label: '7 dias' },
	{ key: '30d', label: '30 dias' },
	{ key: '90d', label: '90 dias' },
];

const SOURCE_LABELS: Record<string, string> = {
	ai: 'Plataformas de IA',
	'search-engine': 'Buscadores',
	social: 'Redes sociais',
	community: 'Comunidades',
	'code-host': 'Repositórios de código',
	direct: 'Acesso direto',
	internal: 'Navegação interna',
	other: 'Outros',
	unknown: 'Desconhecida',
	desconhecido: 'Desconhecida',
};

const EVENT_LABELS: Record<string, string> = {
	page_view: 'Visualização de página',
	link_click: 'Clique em link',
	scroll_depth: 'Profundidade de rolagem',
	page_exit: 'Saída da página',
	search_opened: 'Busca aberta',
	code_copied: 'Código copiado',
	section_visible: 'Seção lida',
	tab_switch: 'Troca de aba',
	toc_click: 'Clique no índice',
	feedback: 'Feedback',
	expand_collapse: 'Expandir/recolher',
};

function formatNumber(value: number): string {
	return new Intl.NumberFormat('pt-BR').format(value);
}

export default function Do11yPanel() {
	const [analytics, setAnalytics] = useState<AnalyticsState>({ state: 'loading' });
	const [range, setRange] = useState('7d');
	const [config, setConfig] = useState<AdminConfig | null>(null);
	const [schemaSql, setSchemaSql] = useState('');
	const [showConfig, setShowConfig] = useState(false);

	async function loadAnalytics(nextRange: string) {
		setAnalytics({ state: 'loading' });
		try {
			const response = await fetch(`/api/admin/analytics/do11y?range=${nextRange}`);
			const body = await response.json();
			setAnalytics(body);
		} catch {
			setAnalytics({ state: 'error', message: 'Não foi possível carregar as métricas.' });
		}
	}

	async function loadConfig() {
		try {
			const response = await fetch('/api/admin/integrations/do11y');
			if (!response.ok) return;
			const body = await response.json();
			setConfig(body.config);
			setSchemaSql(body.schemaSql);
			// Sem integração ativa, o formulário é o que interessa mostrar.
			if (!body.config.enabled) setShowConfig(true);
		} catch {
			/* o painel de métricas já reporta indisponibilidade */
		}
	}

	useEffect(() => {
		void loadConfig();
	}, []);

	useEffect(() => {
		void loadAnalytics(range);
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
				<div className="toolbar-end">
					<button type="button" className="btn" onClick={() => setShowConfig((value) => !value)}>
						{showConfig ? 'Ocultar configuração' : 'Configurar integração'}
					</button>
				</div>
			</div>

			{showConfig && config && (
				<ConfigForm
					config={config}
					schemaSql={schemaSql}
					onSaved={(next) => {
						setConfig(next);
						void loadAnalytics(range);
					}}
				/>
			)}

			<AnalyticsView state={analytics} />
		</>
	);
}

// ------------------------------------------------------------- métricas

function AnalyticsView({ state }: { state: AnalyticsState }) {
	if (state.state === 'loading') {
		return <p className="empty-state">Carregando métricas…</p>;
	}

	if (state.state === 'disabled') {
		return (
			<div className="callout callout--warn">
				<strong>Integração desativada.</strong>
				<p style={{ margin: '6px 0 0' }}>
					O portal não está enviando eventos ao Do11y. Ative em "Configurar integração".
				</p>
			</div>
		);
	}

	if (state.state === 'unconfigured') {
		return (
			<div className="callout callout--warn">
				<strong>Falta credencial.</strong>
				<p style={{ margin: '6px 0 0' }}>
					Informe a URL do Supabase e a chave <code>service_role</code> para o dashboard conseguir ler os
					eventos.
				</p>
			</div>
		);
	}

	if (state.state === 'error') {
		return (
			<div className="callout callout--danger">
				<strong>Não foi possível consultar o Supabase.</strong>
				<p style={{ margin: '6px 0 0' }}>{state.message}</p>
			</div>
		);
	}

	const { metrics } = state;

	if (metrics.totalEvents === 0) {
		return (
			<div className="callout callout--warn">
				<strong>Nenhum evento no período.</strong>
				<p style={{ margin: '6px 0 0' }}>
					Se a integração acabou de ser ativada, visite uma página da documentação e recarregue esta tela — o
					coletor envia em lotes.
				</p>
			</div>
		);
	}

	const maxTimeline = Math.max(1, ...metrics.timeline.map((point) => point.count));

	return (
		<>
			{metrics.truncated && (
				<div className="callout callout--warn">
					O período tem mais eventos do que o limite de consulta. Os números abaixo são uma amostra dos mais
					recentes, não o total do período.
				</div>
			)}

			<div className="stat-grid">
				<div className="stat-card">
					<p className="stat-card-label">Eventos</p>
					<p className="stat-card-value">{formatNumber(metrics.totalEvents)}</p>
				</div>
				<div className="stat-card">
					<p className="stat-card-label">Visualizações de página</p>
					<p className="stat-card-value">{formatNumber(metrics.pageViews)}</p>
				</div>
				<div className="stat-card">
					<p className="stat-card-label">Sessões</p>
					<p className="stat-card-value">{formatNumber(metrics.sessions)}</p>
				</div>
				<div className="stat-card">
					<p className="stat-card-label">Sessões vindas de IA</p>
					<p className="stat-card-value">{Math.round(metrics.aiShare * 100)}%</p>
					<p className="stat-card-hint">{formatNumber(metrics.aiSessions)} sessões</p>
				</div>
			</div>

			{metrics.timeline.length > 1 && (
				<section className="panel">
					<h2>Eventos por dia</h2>
					<div className="spark">
						{metrics.timeline.map((point) => (
							<div key={point.date} className="spark-col" title={`${point.date}: ${point.count}`}>
								<span style={{ height: `${Math.max(2, (point.count / maxTimeline) * 100)}%` }} />
							</div>
						))}
					</div>
					<div className="spark-axis">
						<span>{metrics.timeline[0]?.date}</span>
						<span>{metrics.timeline[metrics.timeline.length - 1]?.date}</span>
					</div>
				</section>
			)}

			<section className="panel">
				<h2>Páginas mais vistas</h2>
				{metrics.topPages.length === 0 ? (
					<p className="empty-state" style={{ padding: '12px 0' }}>
						Nenhuma visualização registrada.
					</p>
				) : (
					<div className="data-table-wrap">
						<table className="data-table">
							<thead>
								<tr>
									<th>Página</th>
									<th>Caminho</th>
									<th style={{ textAlign: 'right' }}>Views</th>
								</tr>
							</thead>
							<tbody>
								{metrics.topPages.map((page) => (
									<tr key={page.path}>
										<td className="cell-name">{page.title}</td>
										<td className="cell-email">
											<a href={page.path}>{page.path}</a>
										</td>
										<td style={{ textAlign: 'right' }}>{formatNumber(page.views)}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>

			<div className="role-columns">
				<Distribution title="Origem das sessões" items={metrics.trafficSources} labels={SOURCE_LABELS} />
				{metrics.aiPlatforms.length > 0 && <Distribution title="Plataformas de IA" items={metrics.aiPlatforms} />}
				<Distribution title="Tipos de evento" items={metrics.eventTypes} labels={EVENT_LABELS} />
				<Distribution title="Dispositivos" items={metrics.devices} />
			</div>
		</>
	);
}

function Distribution({
	title,
	items,
	labels = {},
}: {
	title: string;
	items: Counted[];
	labels?: Record<string, string>;
}) {
	const total = useMemo(() => items.reduce((sum, item) => sum + item.count, 0), [items]);
	if (items.length === 0) return null;

	return (
		<section className="role-card">
			<h2 style={{ margin: '0 0 12px', fontSize: '0.95rem' }}>{title}</h2>
			<div className="breakdown">
				{items.slice(0, 8).map((item) => (
					<div key={item.label} className="breakdown-row breakdown-row--wide">
						<span className="breakdown-label">{labels[item.label] ?? item.label}</span>
						<span className="breakdown-bar">
							<span style={{ width: `${total > 0 ? (item.count / total) * 100 : 0}%` }} />
						</span>
						<span className="breakdown-count">{formatNumber(item.count)}</span>
					</div>
				))}
			</div>
		</section>
	);
}

// ---------------------------------------------------------- configuração

function ConfigForm({
	config,
	schemaSql,
	onSaved,
}: {
	config: AdminConfig;
	schemaSql: string;
	onSaved: (next: AdminConfig) => void;
}) {
	const [form, setForm] = useState(config);
	const [serviceRoleKey, setServiceRoleKey] = useState('');
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [testing, setTesting] = useState(false);

	useEffect(() => setForm(config), [config]);

	function update<K extends keyof AdminConfig>(key: K, value: AdminConfig[K]) {
		setForm((current) => ({ ...current, [key]: value }));
	}

	async function save(event: React.FormEvent) {
		event.preventDefault();
		setError(null);
		setNotice(null);
		setSaving(true);
		try {
			const response = await fetch('/api/admin/integrations/do11y', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ ...form, serviceRoleKey }),
			});
			const body = await response.json();
			if (!response.ok) {
				setError(body.message ?? 'Não foi possível salvar.');
				return;
			}
			setServiceRoleKey('');
			setNotice('Configuração salva.');
			onSaved(body.config);
		} catch {
			setError('Não foi possível conectar ao servidor.');
		} finally {
			setSaving(false);
		}
	}

	async function test() {
		setTesting(true);
		setError(null);
		setNotice(null);
		try {
			const response = await fetch('/api/admin/integrations/do11y', { method: 'POST' });
			const body = await response.json();
			if (body.ok) setNotice('Conexão bem-sucedida: a tabela existe e é legível.');
			else setError(body.message ?? 'Falha no teste.');
		} catch {
			setError('Não foi possível conectar ao servidor.');
		} finally {
			setTesting(false);
		}
	}

	return (
		<section className="panel">
			<h2>Integração com o Do11y</h2>
			<p style={{ margin: '0 0 16px', fontSize: '0.88rem', color: 'var(--sl-color-gray-2)', lineHeight: 1.6 }}>
				O <a href="https://docservable.com/" target="_blank" rel="noreferrer noopener">Do11y</a> captura eventos
				de engajamento nas páginas de documentação e os grava numa tabela do Supabase. Crie a tabela com o SQL
				abaixo, cole as credenciais do projeto e ative.
			</p>

			{form.managedByEnv && (
				<div className="callout callout--warn">
					Há variáveis de ambiente <code>DO11Y_*</code> definidas. Elas têm precedência sobre o que for salvo
					aqui.
				</div>
			)}

			{error && <p className="form-error">{error}</p>}
			{notice && <p className="form-notice">{notice}</p>}

			<form onSubmit={save}>
				<label className="field">
					URL do projeto Supabase
					<input
						type="url"
						placeholder="https://abc123.supabase.co"
						value={form.supabaseUrl}
						onChange={(event) => update('supabaseUrl', event.target.value)}
					/>
				</label>

				<label className="field">
					Chave publishable (anon)
					<input
						type="text"
						placeholder="sb_publishable_…"
						value={form.supabaseKey}
						onChange={(event) => update('supabaseKey', event.target.value)}
					/>
					<small className="field-hint">
						Vai no HTML do portal — é pública por design. A política de RLS só permite inserir.
					</small>
				</label>

				<label className="field">
					Chave service_role
					<input
						type="password"
						placeholder={form.hasServiceRoleKey ? `gravada (${form.serviceRoleKeyHint})` : 'sb_secret_…'}
						value={serviceRoleKey}
						onChange={(event) => setServiceRoleKey(event.target.value)}
						autoComplete="new-password"
					/>
					<small className="field-hint">
						Usada só pelo servidor, para ler os eventos. Nunca é enviada ao navegador nem devolvida por esta
						tela. Deixe em branco para manter a atual.
					</small>
				</label>

				<label className="field">
					Tabela
					<input type="text" value={form.table} onChange={(event) => update('table', event.target.value)} />
				</label>

				<fieldset className="field-group">
					<legend>O que coletar</legend>
					{(
						[
							['trackScrollDepth', 'Profundidade de rolagem'],
							['trackSectionVisibility', 'Seções efetivamente lidas'],
							['trackInternalLinks', 'Cliques em links internos'],
							['trackOutboundLinks', 'Cliques em links externos'],
							['trackTocClicks', 'Cliques no índice'],
							['trackFeedback', 'Feedback "isto foi útil?"'],
						] as const
					).map(([key, label]) => (
						<label key={key} className="check">
							<input
								type="checkbox"
								checked={form[key]}
								onChange={(event) => update(key, event.target.checked)}
							/>
							{label}
						</label>
					))}
					<label className="check">
						<input
							type="checkbox"
							checked={form.respectDNT}
							onChange={(event) => update('respectDNT', event.target.checked)}
						/>
						Respeitar Do Not Track
					</label>
				</fieldset>

				<label className="check" style={{ marginBottom: 16 }}>
					<input
						type="checkbox"
						checked={form.enabled}
						onChange={(event) => update('enabled', event.target.checked)}
					/>
					<strong>Ativar a coleta no portal</strong>
				</label>

				<details style={{ marginBottom: 16 }}>
					<summary style={{ cursor: 'pointer', fontSize: '0.88rem' }}>SQL de criação da tabela</summary>
					<pre className="sql-block">{schemaSql}</pre>
				</details>

				<div className="modal-actions" style={{ justifyContent: 'flex-start' }}>
					<button type="submit" className="btn btn--primary" disabled={saving}>
						{saving ? 'Salvando…' : 'Salvar'}
					</button>
					<button type="button" className="btn" onClick={() => void test()} disabled={testing}>
						{testing ? 'Testando…' : 'Testar conexão'}
					</button>
				</div>
			</form>
		</section>
	);
}
