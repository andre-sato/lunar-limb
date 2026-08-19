import { useEffect, useState } from 'react';

/**
 * Settings → Observability (P3.2).
 *
 * A tela mostra o que os leitores fazem, e por isso ela precisa dizer, de forma
 * visível e não em nota de rodapé, o que **não** está sendo guardado. Um painel
 * de comportamento sem essa declaração deixa quem opera o portal sem saber o que
 * ele tem em mãos — e é assim que um produto acumula dado que ninguém decidiu
 * coletar.
 */

interface SearchMetrics {
	searches: number;
	zeroResult: number;
	clicked: number;
	refined: number;
	abandoned: number;
	clickThroughRate: number | null;
	zeroResultRate: number | null;
	refinementRate: number | null;
	abandonmentRate: number | null;
}

interface PageMetrics {
	path: string;
	views: number;
	readers: number;
	medianDwellSeconds: number | null;
	exits: number;
	up: number;
	down: number;
}

interface Journey {
	steps: string[];
	sessions: number;
	abandonmentRate: number;
}

interface Gap {
	topic: string;
	signal: string;
	occurrences: number;
	confidence: number;
	evidence: string[];
}

interface Report {
	pages: PageMetrics[];
	search: SearchMetrics;
	journeys: Journey[];
	gaps: Gap[];
	sessions: number;
	windowDays: number;
	limited: boolean;
	limitations: string[];
	userSuccess: number | null;
	minimumSessions: number;
	storeQueryText: boolean;
}

const SIGNAL_LABEL: Record<string, string> = {
	'zero-result': 'Busca sem resultado',
	'abandoned-search': 'Busca abandonada',
	'high-exit': 'Saída em massa',
	'negative-feedback': 'Voto negativo',
};

function percent(value: number | null): string {
	return value === null ? '—' : `${value}%`;
}

export default function ObservabilityPanel() {
	const [data, setData] = useState<Report | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let active = true;

		fetch('/api/admin/observability')
			.then(async (response) => {
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				return (await response.json()) as Report;
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

	if (loading) return <p className="stat-card-hint">Carregando os sinais de leitura…</p>;
	if (error) return <p className="stat-card-hint">Não consegui montar o relatório: {error}</p>;
	if (!data) return null;

	return (
		<div className="panel-stack">
			<section>
				<h3>O que este painel não sabe</h3>
				<p className="stat-card-hint">
					Nada aqui identifica uma pessoa. O evento não tem onde guardar IP, id de usuário, cookie ou user-agent — o que
					existe é uma sessão efêmera, gerada no navegador, que some quando a aba fecha e nunca liga duas visitas.
					Leitores com Do Not Track ou Global Privacy Control não são observados, e qualquer um pode desligar a coleta
					no próprio navegador.
				</p>
				<p className="stat-card-hint">
					Uma linha só aparece com {data.minimumSessions}+ sessões distintas. Abaixo disso, “quem leu esta página”
					poderia ser uma pessoa identificável para quem conhece a equipe.
					{!data.storeQueryText && ' O texto das buscas não é guardado.'}
				</p>
			</section>

			<section>
				<h3>Visão geral ({data.windowDays} dias)</h3>
				<div className="stat-grid">
					<div className="stat-card">
						<span className="stat-card-value">{data.sessions}</span>
						<span className="stat-card-label">Sessões</span>
					</div>
					<div className="stat-card">
						<span className="stat-card-value">{data.search.searches}</span>
						<span className="stat-card-label">Buscas</span>
					</div>
					<div className="stat-card">
						<span className="stat-card-value">{data.userSuccess === null ? '—' : data.userSuccess}</span>
						<span className="stat-card-label">Sucesso do leitor</span>
						<span className="stat-card-hint">
							{data.userSuccess === null ? 'Sem volume para medir.' : 'Não somado à saúde técnica.'}
						</span>
					</div>
					<div className="stat-card">
						<span className="stat-card-value">{data.pages.length}</span>
						<span className="stat-card-label">Páginas com volume</span>
					</div>
				</div>
			</section>

			<section>
				<h3>Busca</h3>
				<ul className="plain-list">
					<li>
						Clique em resultado <strong>{percent(data.search.clickThroughRate)}</strong>{' '}
						<span className="stat-card-hint">({data.search.clicked})</span>
					</li>
					<li>
						Sem resultado <strong>{percent(data.search.zeroResultRate)}</strong>{' '}
						<span className="stat-card-hint">({data.search.zeroResult})</span>
					</li>
					<li>
						Refinou a busca <strong>{percent(data.search.refinementRate)}</strong>{' '}
						<span className="stat-card-hint">({data.search.refined})</span>
					</li>
					<li>
						Abandonou <strong>{percent(data.search.abandonmentRate)}</strong>{' '}
						<span className="stat-card-hint">({data.search.abandoned})</span>
					</li>
				</ul>
				<p className="stat-card-hint">
					“Clique em resultado” não é sucesso: clicar é o mais longe que a instrumentação enxerga. Quem clicou pode ter
					resolvido o problema na primeira linha ou desistido do produto — o portal não distingue os dois.
				</p>
			</section>

			{data.pages.length > 0 && (
				<section>
					<h3>Mais lidas</h3>
					<ul className="plain-list">
						{data.pages.slice(0, 15).map((page) => (
							<li key={page.path}>
								<code>{page.path}</code>{' '}
								<span className="stat-card-hint">
									{page.views} visitas · {page.readers} sessões ·{' '}
									{page.medianDwellSeconds === null ? 'sem saída registrada' : `mediana ${page.medianDwellSeconds}s`} ·{' '}
									{page.up}↑ {page.down}↓
								</span>
							</li>
						))}
					</ul>
				</section>
			)}

			{data.journeys.length > 0 && (
				<section>
					<h3>Jornadas</h3>
					<ul className="plain-list">
						{data.journeys.slice(0, 10).map((journey) => (
							<li key={journey.steps.join('>')}>
								<span className="stat-card-hint">{journey.sessions}×</span> {journey.steps.join(' → ')}
								<div className="stat-card-hint">{journey.abandonmentRate}% sem sinal de conclusão</div>
							</li>
						))}
					</ul>
					<p className="stat-card-hint">
						“Sem sinal de conclusão” é a ausência de clique de busca e de voto positivo — não a afirmação de que o
						leitor foi embora frustrado.
					</p>
				</section>
			)}

			<section>
				<h3>Lacunas sugeridas pelo comportamento ({data.gaps.length})</h3>
				<p className="stat-card-hint">
					Sugeridas, não confirmadas: comportamento é evidência de atrito, não prova de conteúdo faltando.
				</p>

				{data.gaps.length === 0 ? (
					<p className="stat-card-hint">Nenhum sinal atingiu o limiar.</p>
				) : (
					<ul className="plain-list">
						{data.gaps.map((gap) => (
							<li key={`${gap.signal}:${gap.topic}`}>
								<strong>{gap.topic}</strong>{' '}
								<span className="stat-card-hint">
									{SIGNAL_LABEL[gap.signal] ?? gap.signal} · confiança {Math.round(gap.confidence * 100)}%
								</span>
								{gap.evidence.map((evidence) => (
									<div className="stat-card-hint" key={evidence}>
										{evidence}
									</div>
								))}
							</li>
						))}
					</ul>
				)}
			</section>

			{data.limited && (
				<section>
					<h3>O que este relatório não sustenta</h3>
					<ul className="plain-list">
						{data.limitations.map((note) => (
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
