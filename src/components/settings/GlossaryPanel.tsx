import { useEffect, useState } from 'react';

/**
 * Settings → Glossary (issue #4).
 *
 * O glossário sempre esteve acessível — os termos são Markdown, e quem tem o
 * editor os abre. O que faltava é a pergunta que só aparece olhando o conjunto:
 * **este glossário está saudável?**
 *
 * A tela é de leitura. Editar um termo leva ao editor, que é onde a alteração
 * ganha diff e revisão; um formulário aqui seria um segundo caminho de escrita
 * para o mesmo conteúdo, com regras próprias.
 */

interface TermUsage {
	id: string;
	term: string;
	aliases: string[];
	enabled: boolean;
	pages: number;
	samples: string[];
	definitionChars: number;
}

interface GlossaryProblem {
	code: string;
	id: string;
	message: string;
	severity: 'error' | 'warning' | 'info';
}

interface Audit {
	terms: TermUsage[];
	problems: GlossaryProblem[];
	totals: { terms: number; enabled: number; unused: number; pagesScanned: number };
	generatedAt: number;
}

const SEVERITY_LABEL: Record<GlossaryProblem['severity'], string> = {
	error: 'Erro',
	warning: 'Aviso',
	info: 'Nota',
};

export default function GlossaryPanel() {
	const [data, setData] = useState<Audit | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		fetch('/api/admin/glossary')
			.then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
			.then(setData)
			.catch(() => setError('Não foi possível carregar o glossário.'));
	}, []);

	if (error) return <p className="panel-note">{error}</p>;
	if (!data) return <p className="panel-note">Carregando…</p>;

	const errors = data.problems.filter((problem) => problem.severity === 'error');
	const warnings = data.problems.filter((problem) => problem.severity === 'warning');

	return (
		<div className="panel-stack">
			<section>
				<h3>Visão geral</h3>
				<div className="stat-grid">
					<div className="stat-card">
						<span className="stat-card-value">{data.totals.terms}</span>
						<span className="stat-card-label">Termos</span>
					</div>
					<div className="stat-card">
						<span className="stat-card-value">{data.totals.enabled}</span>
						<span className="stat-card-label">Ligados</span>
						<span className="stat-card-hint">Desligado continua listado, sem destaque nas páginas.</span>
					</div>
					<div className="stat-card">
						<span className="stat-card-value">{data.totals.unused}</span>
						<span className="stat-card-label">Sem uso</span>
						<span className="stat-card-hint">Nenhuma página menciona o termo.</span>
					</div>
					<div className="stat-card">
						<span className="stat-card-value">{errors.length}</span>
						<span className="stat-card-label">Problemas</span>
						<span className="stat-card-hint">{warnings.length} aviso(s) além destes.</span>
					</div>
				</div>
				<p className="panel-note">
					O glossário é a fonte de terminologia do portal: o linter o consome para avaliar
					consistência. Esta tela lê e não escreve — editar um termo é editar o arquivo, no editor,
					onde a alteração ganha diff e revisão.
				</p>
			</section>

			{data.problems.length > 0 && (
				<section>
					<h3>O que precisa de atenção</h3>
					<ul className="plain-list">
						{[...errors, ...warnings, ...data.problems.filter((p) => p.severity === 'info')].map(
							(problem, index) => (
								<li key={`${problem.code}-${problem.id}-${index}`}>
									<span>
										<strong>{SEVERITY_LABEL[problem.severity]}</strong> · <code>{problem.code}</code>{' '}
										{problem.message}
									</span>
									<a href={`/editor?file=glossary/${problem.id}.md`}>Editar</a>
								</li>
							)
						)}
					</ul>
				</section>
			)}

			<section>
				<h3>Termos, por alcance</h3>
				<p className="panel-note">
					A contagem é por <strong>página</strong>, não por ocorrência: um termo citado quinze vezes
					numa página só não tem mais alcance que um citado uma vez em cinco.
				</p>
				<table className="data-table">
					<thead>
						<tr>
							<th>Termo</th>
							<th>Apelidos</th>
							<th>Páginas</th>
							<th>Definição</th>
							<th />
						</tr>
					</thead>
					<tbody>
						{data.terms.map((term) => (
							<tr key={term.id}>
								<td>
									{term.term}
									{!term.enabled && <span className="badge"> desligado</span>}
									<br />
									<code>{term.id}</code>
								</td>
								<td>{term.aliases.length > 0 ? term.aliases.join(', ') : '—'}</td>
								<td>
									{term.pages}
									{term.samples.length > 0 && (
										<>
											<br />
											<small>{term.samples.slice(0, 3).join(', ')}</small>
										</>
									)}
								</td>
								<td>{term.definitionChars} car.</td>
								<td>
									<a href={`/editor?file=glossary/${term.id}.md`}>Editar</a>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</section>

			<section>
				<h3>Onde o glossário aparece</h3>
				<ul className="plain-list">
					<li>
						<span>Termos destacados nas páginas, com a definição numa bolha</span>
					</li>
					<li>
						<span>
							A lista pública em <a href="/glossary">/glossary</a>
						</span>
					</li>
					<li>
						<span>O linter, que o usa para pontuar consistência de terminologia</span>
					</li>
					<li>
						<span>Os agentes de documentação, que o consultam antes de redigir</span>
					</li>
				</ul>
			</section>
		</div>
	);
}
