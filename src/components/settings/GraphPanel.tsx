import { useEffect, useState } from 'react';

/**
 * Settings → Knowledge Graph (P3.4).
 *
 * A tela é uma **tabela com busca**, não um desenho de grafo. Um grafo de
 * duzentos nós é bonito na captura de tela e inútil para achar o que muda se
 * este endpoint mudar — a mesma decisão já tomada no painel do Digital Twin, e
 * pelo mesmo motivo.
 */

interface Node {
	id: string;
	type: string;
	name: string;
	source?: string;
}

interface Match {
	node: Node;
	matchedOn: string;
	related: Array<{ node: Node; relation: string; direction: 'out' | 'in' }>;
}

interface Status {
	freshness: string;
	ageSeconds: number | null;
	counts: { nodes: Record<string, number>; edges: Record<string, number>; total: { nodes: number; edges: number } };
	degraded: string[];
	reason?: string;
}

interface Impact {
	origin: Node | null;
	affected: Array<{ node: Node; distance: number; via: string[] }>;
	teams: string[];
	truncated: boolean;
}

const NODE_LABEL: Record<string, string> = {
	page: 'Página',
	section: 'Seção',
	api: 'Especificação',
	endpoint: 'Endpoint',
	schema: 'Schema',
	code: 'Código',
	example: 'Exemplo',
	snippet: 'Bloco reutilizável',
	glossary: 'Termo',
	test: 'Teste',
	version: 'Versão',
	team: 'Time',
	release: 'Release',
	gap: 'Lacuna',
	contract: 'Contrato',
};

const RELATION_LABEL: Record<string, string> = {
	references: 'referencia',
	documents: 'documenta',
	implements: 'implementa',
	uses: 'usa',
	'used-by': 'usada por',
	defines: 'define',
	'validated-by': 'validado por',
	'belongs-to': 'pertence a',
	contains: 'contém',
	'generated-from': 'gerado a partir de',
	supersedes: 'substitui',
	'owned-by': 'pertence ao time',
	'changed-in': 'mudou em',
	'affected-by': 'afetada por',
};

const FRESHNESS_LABEL: Record<string, string> = {
	fresh: 'Atualizado',
	stale: 'Desatualizado',
	rebuilding: 'Reconstruindo',
	failed: 'Falhou',
};

export default function GraphPanel() {
	const [status, setStatus] = useState<Status | null>(null);
	const [term, setTerm] = useState('');
	const [matches, setMatches] = useState<Match[] | null>(null);
	const [impact, setImpact] = useState<Impact | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		fetch('/api/admin/graph')
			.then(async (response) => {
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				return (await response.json()) as Status;
			})
			.then(setStatus)
			.catch((cause) => setError(cause instanceof Error ? cause.message : 'Falha ao carregar.'));
	}, []);

	const search = (event: React.FormEvent) => {
		event.preventDefault();
		if (term.trim() === '') return;

		setBusy(true);
		setImpact(null);

		fetch(`/api/admin/graph?view=query&q=${encodeURIComponent(term)}`)
			.then(async (response) => {
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				return (await response.json()) as { matches: Match[] };
			})
			.then((payload) => setMatches(payload.matches))
			.catch((cause) => setError(cause instanceof Error ? cause.message : 'Falha na busca.'))
			.finally(() => setBusy(false));
	};

	const showImpact = (nodeId: string) => {
		setBusy(true);
		fetch(`/api/admin/graph?view=impact&node=${encodeURIComponent(nodeId)}`)
			.then(async (response) => {
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				return (await response.json()) as Impact;
			})
			.then(setImpact)
			.catch((cause) => setError(cause instanceof Error ? cause.message : 'Falha ao calcular impacto.'))
			.finally(() => setBusy(false));
	};

	return (
		<div className="panel-stack">
			<section>
				<h3>Estado</h3>
				{error && <p className="stat-card-hint">{error}</p>}

				{status && (
					<>
						<p>
							<strong>{FRESHNESS_LABEL[status.freshness] ?? status.freshness}</strong>{' '}
							<span className="stat-card-hint">
								{status.ageSeconds === null ? '' : `construído há ${status.ageSeconds}s`} · {status.counts.total.nodes}{' '}
								nós · {status.counts.total.edges} arestas
							</span>
						</p>

						{status.degraded.length > 0 && <p className="stat-card-hint">{status.reason}</p>}

						<ul className="plain-list">
							{Object.entries(status.counts.nodes)
								.sort((a, b) => b[1] - a[1])
								.map(([type, count]) => (
									<li key={type}>
										{NODE_LABEL[type] ?? type} <span className="stat-card-hint">{count}</span>
									</li>
								))}
						</ul>
					</>
				)}

				<p className="stat-card-hint">
					O grafo é <strong>derivado</strong> do repositório e não tem verdade própria: se ele discordar do Git, quem
					está errado é o grafo. Ele estende o Digital Twin com time, release, lacuna e contrato — não é um segundo
					grafo, porque dois grafos com as mesmas entidades divergiriam na primeira semana.
				</p>
			</section>

			<section>
				<h3>Consultar</h3>
				<form onSubmit={search}>
					<input
						type="search"
						value={term}
						onChange={(event) => setTerm(event.target.value)}
						placeholder="payments, authentication, GET /api/auth/me"
						aria-label="Procurar no grafo"
					/>
					<button type="submit" disabled={busy}>
						Procurar
					</button>
				</form>

				<p className="stat-card-hint">
					Casa por nome, arquivo de origem e identificador. Não há busca semântica aqui: o grafo responde perguntas
					estruturais, e quem responde em linguagem natural é o assistente. Misturar os dois faria o grafo devolver
					resultados plausíveis e não verificáveis.
				</p>

				{matches !== null && (
					<ul className="plain-list">
						{matches.map((match) => (
							<li key={match.node.id}>
								<span className="stat-card-hint">{NODE_LABEL[match.node.type] ?? match.node.type}</span>{' '}
								<strong>{match.node.name}</strong>{' '}
								<button type="button" onClick={() => showImpact(match.node.id)} disabled={busy}>
									impacto
								</button>
								<div className="stat-card-hint">
									<code>{match.node.id}</code> · casou por {match.matchedOn}
								</div>
								{match.related.slice(0, 6).map((related) => (
									<div className="stat-card-hint" key={`${related.direction}:${related.relation}:${related.node.id}`}>
										{related.direction === 'out' ? '→' : '←'} {RELATION_LABEL[related.relation] ?? related.relation}:{' '}
										{related.node.name}
									</div>
								))}
							</li>
						))}
						{matches.length === 0 && <li className="stat-card-hint">Nada encontrado.</li>}
					</ul>
				)}
			</section>

			{impact && (
				<section>
					<h3>Impacto: {impact.origin?.name ?? '—'}</h3>
					<ul className="plain-list">
						{impact.affected.map((entry) => (
							<li key={entry.node.id}>
								<span className="stat-card-hint">{entry.distance}</span>{' '}
								<span className="stat-card-hint">{NODE_LABEL[entry.node.type] ?? entry.node.type}</span>{' '}
								{entry.node.name}
								<div className="stat-card-hint">
									via {entry.via.map((relation) => RELATION_LABEL[relation] ?? relation).join(' → ')}
								</div>
							</li>
						))}
						{impact.affected.length === 0 && (
							<li className="stat-card-hint">Nada depende deste nó pelas relações que propagam impacto.</li>
						)}
					</ul>

					{impact.teams.length > 0 && <p className="stat-card-hint">Times a avisar: {impact.teams.join(', ')}</p>}
					{impact.truncated && <p className="stat-card-hint">A busca parou no limite de saltos; pode haver mais.</p>}
				</section>
			)}
		</div>
	);
}
