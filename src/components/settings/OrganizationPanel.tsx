import { useEffect, useState } from 'react';

/**
 * Settings → Organization (P3.5).
 *
 * A coluna que importa nesta tela não é a nota — é a **profundidade da leitura**.
 * Exibir "84" ao lado de "—" sob o mesmo cabeçalho faria a segunda parecer um
 * zero, quando ela significa "não foi medido".
 */

interface RepositoryReport {
	id: string;
	product?: string;
	owner?: string;
	depth: 'full' | 'files' | 'unreachable';
	pages: number;
	owned: number;
	brokenLinks: number;
	crossReferences: Array<{ from: string; to: string; repository: string; resolved: boolean }>;
	health: number | null;
	gaps: number | null;
	reason?: string;
}

interface Report {
	organization: string;
	repositories: RepositoryReport[];
	products: Array<{ id: string; label: string; repositories: string[]; health: number | null }>;
	totals: { repositories: number; pages: number; ownership: number | null };
	health: number | null;
	limitations: string[];
}

interface Hit {
	repository: string;
	path: string;
	title: string;
	excerpt: string;
}

const DEPTH_LABEL: Record<string, string> = {
	full: 'Leitura completa',
	files: 'Lido pelos arquivos',
	unreachable: 'Não lido',
};

function colorFor(value: number | null): string | undefined {
	if (value === null) return undefined;
	if (value >= 90) return 'var(--sl-color-green)';
	if (value >= 75) return 'var(--sl-color-accent)';
	return 'var(--sl-color-red)';
}

function Bar({ value }: { value: number | null }) {
	return (
		<span className="breakdown-bar">
			<span style={{ width: `${value ?? 0}%`, background: colorFor(value) }} />
		</span>
	);
}

export default function OrganizationPanel() {
	const [report, setReport] = useState<Report | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [term, setTerm] = useState('');
	const [hits, setHits] = useState<Hit[] | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		fetch('/api/admin/organization')
			.then(async (response) => {
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				return (await response.json()) as Report;
			})
			.then(setReport)
			.catch((cause) => setError(cause instanceof Error ? cause.message : 'Falha ao carregar.'));
	}, []);

	const search = (event: React.FormEvent) => {
		event.preventDefault();
		if (term.trim() === '') return;

		setBusy(true);
		fetch(`/api/admin/organization?view=search&q=${encodeURIComponent(term)}`)
			.then(async (response) => {
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				return (await response.json()) as { hits: Hit[] };
			})
			.then((payload) => setHits(payload.hits))
			.catch((cause) => setError(cause instanceof Error ? cause.message : 'Falha na busca.'))
			.finally(() => setBusy(false));
	};

	if (error) return <p className="stat-card-hint">{error}</p>;
	if (!report) return <p className="stat-card-hint">Carregando a organização…</p>;

	const unresolved = report.repositories.flatMap((repository) =>
		repository.crossReferences.filter((reference) => !reference.resolved)
	);

	return (
		<div className="panel-stack">
			<section>
				<h3>{report.organization}</h3>
				<div className="stat-grid">
					<div className="stat-card">
						<span className="stat-card-value">{report.totals.repositories}</span>
						<span className="stat-card-label">Repositórios</span>
					</div>
					<div className="stat-card">
						<span className="stat-card-value">{report.totals.pages}</span>
						<span className="stat-card-label">Páginas</span>
					</div>
					<div className="stat-card">
						<span className="stat-card-value">{report.health === null ? '—' : report.health}</span>
						<span className="stat-card-label">Saúde da organização</span>
						<span className="stat-card-hint">Média só dos repositórios medidos.</span>
					</div>
					<div className="stat-card">
						<span className="stat-card-value">
							{report.totals.ownership === null ? '—' : `${report.totals.ownership}%`}
						</span>
						<span className="stat-card-label">Cobertura de dono</span>
					</div>
				</div>
			</section>

			<section>
				<h3>Repositórios</h3>
				{report.repositories.map((repository) => (
					<div className="breakdown-row breakdown-row--wide" key={repository.id}>
						<span className="breakdown-label">{repository.id}</span>
						<Bar value={repository.health} />
						<span className="breakdown-count">
							{repository.health === null ? '—' : repository.health}{' '}
							<span className="stat-card-hint">{DEPTH_LABEL[repository.depth]}</span>
						</span>
					</div>
				))}

				<ul className="plain-list">
					{report.repositories.map((repository) => (
						<li key={repository.id}>
							<code>{repository.id}</code>{' '}
							<span className="stat-card-hint">
								{repository.pages} páginas · {repository.owned} com dono
								{repository.brokenLinks > 0 && ` · ${repository.brokenLinks} link(s) quebrado(s)`}
								{repository.gaps !== null && ` · ${repository.gaps} lacuna(s)`}
							</span>
							{repository.reason && <div className="stat-card-hint">{repository.reason}</div>}
						</li>
					))}
				</ul>

				<p className="stat-card-hint">
					Repositório lido só pelos arquivos fica <strong>fora</strong> da média da organização. Contá-lo como zero
					faria registrar um repositório baixar a nota — e o efeito disso seria ninguém registrar repositório nenhum.
				</p>
			</section>

			{report.products.length > 0 && (
				<section>
					<h3>Por produto</h3>
					{report.products.map((product) => (
						<div className="breakdown-row breakdown-row--wide" key={product.id}>
							<span className="breakdown-label">{product.label}</span>
							<Bar value={product.health} />
							<span className="breakdown-count">
								{product.health === null ? '—' : product.health}{' '}
								<span className="stat-card-hint">{product.repositories.length} repo(s)</span>
							</span>
						</div>
					))}
				</section>
			)}

			{unresolved.length > 0 && (
				<section>
					<h3>Referências cruzadas sem destino ({unresolved.length})</h3>
					<ul className="plain-list">
						{unresolved.slice(0, 20).map((reference) => (
							<li key={`${reference.from}:${reference.repository}:${reference.to}`}>
								<code>{reference.from}</code>{' '}
								<span className="stat-card-hint">
									→ repo://{reference.repository}/{reference.to}
								</span>
							</li>
						))}
					</ul>
					<p className="stat-card-hint">
						“Resolvida” significa apenas que o repositório de destino está registrado. Conferir se a página existe lá
						exigiria ler o outro repositório, e o relatório não afirma o que não conferiu.
					</p>
				</section>
			)}

			<section>
				<h3>Busca global</h3>
				<form onSubmit={search}>
					<input
						type="search"
						value={term}
						onChange={(event) => setTerm(event.target.value)}
						placeholder="payments API"
						aria-label="Procurar em todos os repositórios"
					/>
					<button type="submit" disabled={busy}>
						Procurar
					</button>
				</form>

				<p className="stat-card-hint">
					Busca literal nos arquivos, não a busca do portal: sem índice, sem ranqueamento. A busca do portal só conhece
					este repositório, e estendê-la aos vizinhos exigiria indexá-los.
				</p>

				{hits !== null && (
					<ul className="plain-list">
						{hits.map((hit) => (
							<li key={`${hit.repository}:${hit.path}`}>
								<span className="stat-card-hint">{hit.repository}</span> <strong>{hit.title}</strong>
								<div className="stat-card-hint">{hit.path}</div>
								<div className="stat-card-hint">…{hit.excerpt}…</div>
							</li>
						))}
						{hits.length === 0 && <li className="stat-card-hint">Nada encontrado.</li>}
					</ul>
				)}
			</section>

			{report.limitations.length > 0 && (
				<section>
					<h3>O que este relatório não sustenta</h3>
					<ul className="plain-list">
						{report.limitations.map((note) => (
							<li key={note} className="stat-card-hint">
								{note}
							</li>
						))}
					</ul>
				</section>
			)}
		</div>
	);
}
