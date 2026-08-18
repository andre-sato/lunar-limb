import { useEffect, useState } from 'react';

/**
 * Settings → Intelligence: o Digital Twin (§16, §17, §18).
 *
 * A §17 permite uma visualização em grafo, mas exige que ela **não** seja a única
 * forma de navegar. Aqui a tabela é a principal: um grafo com centenas de nós é
 * bonito na captura de tela e inútil para achar o endpoint que ninguém
 * documentou. O que a tela entrega é a lista ordenada, com o caminho de cada
 * conclusão.
 */

interface CoverageSlice {
	documented: number;
	total: number;
	percentage: number | null;
}

interface Summary {
	nodes: Record<string, number>;
	edges: number;
	coverage: {
		endpoints: CoverageSlice;
		schemas: CoverageSlice;
		examples: CoverageSlice;
		features: CoverageSlice;
		byDomain: Array<{ domain: string; documented: number; total: number; percentage: number }>;
		overall: number | null;
		internal: number;
	};
	undocumented: Array<{ node: { id: string; name: string }; evidence: string[] }>;
	stale: Array<{ node: { id: string; name: string; source?: string }; reference: string; reason: string }>;
	versionGaps: Array<{ endpoint: string; version: string; issue: string }>;
}

interface Answer {
	summary: string;
	items: Array<{ id: string; label: string; detail?: string }>;
}

const NODE_LABEL: Record<string, string> = {
	page: 'Páginas',
	endpoint: 'Endpoints',
	code: 'Arquivos de código',
	api: 'Especificações',
	schema: 'Schemas',
	example: 'Exemplos',
	snippet: 'Blocos reutilizáveis',
	glossary: 'Termos',
	test: 'Testes',
	version: 'Versões',
	section: 'Seções',
};

function colorFor(value: number | null): string | undefined {
	if (value === null) return undefined;
	if (value >= 90) return 'var(--sl-color-green)';
	if (value >= 70) return 'var(--sl-color-accent)';
	return 'var(--sl-color-red)';
}

function CoverageRow({ label, entry }: { label: string; entry: CoverageSlice }) {
	return (
		<div className="breakdown-row breakdown-row--wide">
			<span className="breakdown-label">{label}</span>
			<span className="breakdown-bar">
				<span style={{ width: `${entry.percentage ?? 0}%`, background: colorFor(entry.percentage) }} />
			</span>
			<span className="breakdown-count">
				{entry.percentage === null ? '—' : `${entry.percentage}%`}{' '}
				<span className="stat-card-hint">
					({entry.documented}/{entry.total})
				</span>
			</span>
		</div>
	);
}

export default function TwinPanel() {
	const [summary, setSummary] = useState<Summary | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [question, setQuestion] = useState('');
	const [answer, setAnswer] = useState<Answer | null>(null);
	const [answerError, setAnswerError] = useState<string | null>(null);

	useEffect(() => {
		void (async () => {
			try {
				const response = await fetch('/api/admin/twin');
				const data = await response.json();
				if (!response.ok) throw new Error(data?.error ?? 'Falha ao montar o Digital Twin.');
				setSummary(data as Summary);
			} catch (cause) {
				setError(cause instanceof Error ? cause.message : 'Falha ao montar o Digital Twin.');
			} finally {
				setLoading(false);
			}
		})();
	}, []);

	async function ask() {
		setAnswer(null);
		setAnswerError(null);
		if (question.trim() === '') return;

		try {
			const response = await fetch(`/api/admin/twin?q=${encodeURIComponent(question)}`);
			const data = await response.json();
			if (!response.ok) throw new Error(data?.message ?? data?.error ?? 'Não entendi a pergunta.');
			setAnswer(data as Answer);
		} catch (cause) {
			setAnswerError(cause instanceof Error ? cause.message : 'Não entendi a pergunta.');
		}
	}

	if (loading) return <p className="empty-state">Derivando o Digital Twin das fontes de verdade…</p>;
	if (error) return <p className="form-error">{error}</p>;
	if (!summary) return null;

	const { coverage } = summary;

	return (
		<div className="twin-panel">
			<div className="stat-grid">
				<div className="stat-card">
					<p className="stat-card-label">Cobertura geral</p>
					<p className="stat-card-value" style={{ color: colorFor(coverage.overall) }}>
						{coverage.overall === null ? '—' : `${coverage.overall}%`}
					</p>
					<p className="stat-card-hint">média das fatias mensuráveis</p>
				</div>
				<div className="stat-card">
					<p className="stat-card-label">Sem documentação</p>
					<p
						className="stat-card-value"
						style={{ color: summary.undocumented.length > 0 ? 'var(--sl-color-red)' : undefined }}
					>
						{summary.undocumented.length}
					</p>
					<p className="stat-card-hint">endpoints de produto</p>
				</div>
				<div className="stat-card">
					<p className="stat-card-label">Potencialmente obsoleta</p>
					<p className="stat-card-value">{summary.stale.length}</p>
					<p className="stat-card-hint">referência sem correspondente</p>
				</div>
				<div className="stat-card">
					<p className="stat-card-label">Rotas internas</p>
					<p className="stat-card-value">{coverage.internal}</p>
					<p className="stat-card-hint">fora da conta da cobertura</p>
				</div>
			</div>

			<section className="panel">
				<h2>Cobertura documental</h2>
				<p className="panel-hint">
					O Twin é <strong>derivado</strong> das fontes de verdade — Markdown, OpenAPI e o roteamento por arquivo
					do código. Ele não guarda verdade própria: se discordar do repositório, quem está errado é o grafo. As
					rotas internas do portal (editor, administração) ficam fora da conta, senão o indicador falaria da
                    ferramenta em vez do produto.
				</p>
				<div className="breakdown">
					<CoverageRow label="Endpoints" entry={coverage.endpoints} />
					<CoverageRow label="Schemas" entry={coverage.schemas} />
					<CoverageRow label="Exemplos" entry={coverage.examples} />
					<CoverageRow label="Domínios" entry={coverage.features} />
				</div>

				{coverage.byDomain.length > 0 && (
					<div className="data-table-wrap">
						<table className="data-table">
							<thead>
								<tr>
									<th>Domínio</th>
									<th style={{ width: 120, textAlign: 'right' }}>Documentados</th>
									<th style={{ width: 90, textAlign: 'right' }}>Cobertura</th>
								</tr>
							</thead>
							<tbody>
								{coverage.byDomain.map((domain) => (
									<tr key={domain.domain}>
										<td>{domain.domain}</td>
										<td style={{ textAlign: 'right' }}>
											{domain.documented}/{domain.total}
										</td>
										<td style={{ textAlign: 'right', color: colorFor(domain.percentage) }}>{domain.percentage}%</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>

			<section className="panel">
				<h2>Implementado e não documentado</h2>
				{summary.undocumented.length === 0 ? (
					<p className="empty-state">Todo endpoint de produto tem documentação.</p>
				) : (
					<div className="data-table-wrap">
						<table className="data-table">
							<thead>
								<tr>
									<th>Endpoint</th>
									<th>O que existe</th>
								</tr>
							</thead>
							<tbody>
								{summary.undocumented.map((item) => (
									<tr key={item.node.id}>
										<td>
											<code>{item.node.name}</code>
										</td>
										<td className="stat-card-hint">{item.evidence.join(' · ') || '—'}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>

			<section className="panel">
				<h2>Documentação potencialmente obsoleta</h2>
				<p className="panel-hint">
					<strong>Potencialmente</strong>, e a palavra é a política: a página pode estar documentando
					comportamento histórico, versão anterior, um conceito ou algo ainda planejado. Isto é um sinal para
					alguém olhar, não um veredito.
				</p>
				{summary.stale.length === 0 ? (
					<p className="empty-state">Nenhuma referência órfã.</p>
				) : (
					<div className="data-table-wrap">
						<table className="data-table">
							<thead>
								<tr>
									<th>Página</th>
									<th style={{ width: 260 }}>Cita</th>
								</tr>
							</thead>
							<tbody>
								{summary.stale.map((item, index) => (
									<tr key={`${item.node.id}-${index}`}>
										<td>
											<code>{item.node.source ?? item.node.name}</code>
										</td>
										<td>
											<code>{item.reference}</code>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>

			<section className="panel">
				<h2>Perguntar ao Twin</h2>
				<p className="panel-hint">
					Reconhecimento de padrão, não modelo de linguagem: as perguntas úteis aqui são poucas e conhecidas.
					Pergunta que ele não entende recebe a lista do que ele sabe responder, em vez de um palpite.
				</p>
				<div className="toolbar">
					<input
						type="text"
						value={question}
						placeholder="Quais APIs não estão documentadas?"
						onChange={(event) => setQuestion(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === 'Enter') void ask();
						}}
					/>
					<button type="button" onClick={() => void ask()}>
						Perguntar
					</button>
				</div>

				{answerError && <p className="form-error">{answerError}</p>}

				{answer && (
					<>
						<p>
							<strong>{answer.summary}</strong>
						</p>
						<ul className="twin-answer">
							{answer.items.slice(0, 20).map((item, index) => (
								<li key={`${item.id}-${index}`}>
									{item.label}
									{item.detail && <span className="stat-card-hint"> — {item.detail}</span>}
								</li>
							))}
						</ul>
					</>
				)}
			</section>

			<section className="panel">
				<h2>O grafo</h2>
				<div className="data-table-wrap">
					<table className="data-table">
						<thead>
							<tr>
								<th>Tipo de nó</th>
								<th style={{ width: 100, textAlign: 'right' }}>Quantidade</th>
							</tr>
						</thead>
						<tbody>
							{Object.entries(summary.nodes)
								.sort((a, b) => b[1] - a[1])
								.map(([type, count]) => (
									<tr key={type}>
										<td>{NODE_LABEL[type] ?? type}</td>
										<td style={{ textAlign: 'right' }}>{count}</td>
									</tr>
								))}
							<tr>
								<td>
									<strong>Relações</strong>
								</td>
								<td style={{ textAlign: 'right' }}>
									<strong>{summary.edges}</strong>
								</td>
							</tr>
						</tbody>
					</table>
				</div>
			</section>
		</div>
	);
}
