import { useCallback, useEffect, useState } from 'react';
import { GitBranch, Check, AlertTriangle, ExternalLink, X } from 'lucide-react';

/**
 * Workflow de Git no editor: branch, diff, portão de qualidade e pull request.
 *
 * Um painel só, e não quatro telas, porque as quatro perguntas são feitas na
 * mesma sessão de trabalho: "em que branch estou", "o que mudei", "está bom o
 * suficiente" e "manda para revisão".
 *
 * A revisão, a aprovação e o merge acontecem no provedor. Reimplementá-los aqui
 * seria um GitHub pior, desconectado do que a equipe já usa para revisar código.
 */

interface BranchInfo {
	name: string;
	current: boolean;
	ahead: number;
	behind: number;
}

interface FileDiff {
	path: string;
	change: 'added' | 'removed' | 'modified' | 'renamed';
	additions: number;
	deletions: number;
}

interface Review {
	base: string;
	head: string;
	diff: { files: FileDiff[]; additions: number; deletions: number };
	gate: { score: number | null; passed: boolean; findings: number };
	tests: {
		total: number;
		passed: number;
		failed: number;
		skipped: number;
		passing: boolean;
		error?: string;
		failures: Array<{ id: string; name: string; message?: string; location?: { path: string; line?: number } }>;
	};
	impact: { changedSnippets: string[]; affectedPages: string[] };
	remote: { url: string } | null;
	canCreatePullRequest: boolean;
}

const CHANGE_LABEL: Record<FileDiff['change'], string> = {
	added: 'novo',
	removed: 'removido',
	modified: 'alterado',
	renamed: 'renomeado',
};

export default function GitWorkflowModal({ onClose }: { onClose: () => void }) {
	const [branches, setBranches] = useState<BranchInfo[]>([]);
	const [defaultBranch, setDefaultBranch] = useState('');
	const [current, setCurrent] = useState('');
	const [review, setReview] = useState<Review | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

	const [newBranch, setNewBranch] = useState('');
	const [title, setTitle] = useState('');
	const [description, setDescription] = useState('');

	const load = useCallback(async () => {
		setError(null);
		try {
			const branchResponse = await fetch('/api/editor/git/branches');
			const data = await branchResponse.json();
			if (!branchResponse.ok) throw new Error(data.error ?? 'Falha ao ler as branches.');

			setBranches(data.branches ?? []);
			setCurrent(data.current ?? '');
			setDefaultBranch(data.defaultBranch ?? '');

			const reviewResponse = await fetch('/api/editor/git/review');
			const reviewData = await reviewResponse.json();
			if (reviewResponse.ok) setReview(reviewData);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : 'Falha ao consultar o Git.');
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const act = useCallback(
		async (body: Record<string, unknown>, success: string) => {
			setBusy(true);
			setError(null);
			setNotice(null);
			try {
				const response = await fetch('/api/editor/git/branches', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(body),
				});
				const data = await response.json();
				if (!response.ok) throw new Error(data.error ?? 'Operação recusada.');
				setNotice(success);
				setNewBranch('');
				await load();
			} catch (caught) {
				setError(caught instanceof Error ? caught.message : 'Operação falhou.');
			} finally {
				setBusy(false);
			}
		},
		[load]
	);

	async function createPullRequest() {
		if (title.trim() === '') {
			setError('Escreva um título para o pull request.');
			return;
		}
		setBusy(true);
		setError(null);
		setNotice(null);
		try {
			const response = await fetch('/api/editor/git/review', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ title, description, base: review?.base, head: current }),
			});
			const data = await response.json();
			if (!response.ok) throw new Error(data.error ?? 'Falha ao criar o pull request.');

			if (data.created) {
				setNotice(`Pull request #${data.number} criado.`);
				window.open(data.url, '_blank', 'noopener');
			} else {
				// Sem token, o trabalho não se perde: o provedor abre com tudo pronto.
				setNotice(data.reason ?? 'Abra o provedor para concluir.');
				if (data.url) window.open(data.url, '_blank', 'noopener');
			}
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : 'Falha ao criar o pull request.');
		} finally {
			setBusy(false);
		}
	}

	const score = review?.gate.score;
	const onDefaultBranch = current === defaultBranch;

	return (
		<div className="modal-backdrop" onClick={onClose}>
			<div className="modal modal--wide" onClick={(event) => event.stopPropagation()}>
				<header className="modal-header">
					<h2>
						<GitBranch size={16} /> Branch e publicação
					</h2>
					<button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar">
						<X size={16} />
					</button>
				</header>

				{error && <div className="banner banner--error">{error}</div>}
				{notice && <div className="banner banner--info">{notice}</div>}

				<section className="git-section">
					<h3>Branch atual</h3>
					<div className="git-current">
						<strong>{current || '—'}</strong>
						{onDefaultBranch && (
							<span className="git-warning">
								<AlertTriangle size={13} /> você está na branch padrão; crie uma branch para revisar antes de publicar
							</span>
						)}
					</div>

					<div className="git-row">
						<select
							value={current}
							disabled={busy}
							onChange={(event) => void act({ action: 'switch', name: event.target.value }, `Agora em ${event.target.value}.`)}
						>
							{branches.map((branch) => (
								<option key={branch.name} value={branch.name}>
									{branch.name}
									{branch.name === defaultBranch ? ' (padrão)' : ''}
									{branch.ahead > 0 ? ` · ${branch.ahead} à frente` : ''}
								</option>
							))}
						</select>
					</div>

					<div className="git-row">
						<input
							type="text"
							placeholder="docs/minha-alteracao"
							value={newBranch}
							disabled={busy}
							onChange={(event) => setNewBranch(event.target.value)}
						/>
						<button
							type="button"
							className="btn"
							disabled={busy || newBranch.trim() === ''}
							onClick={() => void act({ action: 'create', name: newBranch, base: defaultBranch }, `Branch ${newBranch} criada.`)}
						>
							Criar branch
						</button>
						{!onDefaultBranch && (
							<button
								type="button"
								className="btn btn--ghost"
								disabled={busy}
								onClick={() => void act({ action: 'delete', name: current }, 'Branch apagada.')}
							>
								Apagar esta
							</button>
						)}
					</div>
				</section>

				<section className="git-section">
					<h3>Alterações em relação a {review?.base ?? defaultBranch}</h3>

					{!review || review.diff.files.length === 0 ? (
						<p className="git-empty">Nenhuma alteração nesta branch.</p>
					) : (
						<>
							<p className="git-summary">
								{review.diff.files.length} arquivo(s) · <span className="git-add">+{review.diff.additions}</span>{' '}
								<span className="git-del">−{review.diff.deletions}</span>
							</p>
							<ul className="git-files">
								{review.diff.files.map((file) => (
									<li key={file.path}>
										<span className={`git-change git-change--${file.change}`}>{CHANGE_LABEL[file.change]}</span>
										<code>{file.path}</code>
										<span className="git-counts">
											<span className="git-add">+{file.additions}</span>{' '}
											<span className="git-del">−{file.deletions}</span>
										</span>
									</li>
								))}
							</ul>

							{review.impact.affectedPages.length > 0 && (
								<p className="git-impact">
									<AlertTriangle size={13} /> {review.impact.affectedPages.length} página(s) mudam por causa de
									bloco reutilizável e <strong>não aparecem acima</strong>:{' '}
									{review.impact.affectedPages.join(', ')}
								</p>
							)}
						</>
					)}
				</section>

				<section className="git-section">
					<h3>Qualidade</h3>
					{typeof score === 'number' ? (
						<p className={`git-score ${review!.gate.passed ? 'git-score--ok' : 'git-score--bad'}`}>
							{review!.gate.passed ? <Check size={15} /> : <AlertTriangle size={15} />} {score.toFixed(1)}/10
							{review!.gate.findings > 0 && <span> · {review!.gate.findings} apontamento(s)</span>}
						</p>
					) : (
						<p className="git-empty">Nenhuma página de documentação alterada.</p>
					)}
				</section>

				<section className="git-section">
					<h3>Testes de documentação</h3>
					{review!.tests.error ? (
						// A suíte não ter rodado não é aprovação. Dizer isso é o mínimo.
						<p className="git-score git-score--bad">
							<AlertTriangle size={15} /> Não foi possível rodar: {review!.tests.error}
						</p>
					) : review!.tests.total === 0 ? (
						<p className="git-empty">Nenhuma página de documentação alterada.</p>
					) : (
						<>
							<p className={`git-score ${review!.tests.passing ? 'git-score--ok' : 'git-score--bad'}`}>
								{review!.tests.passing ? <Check size={15} /> : <AlertTriangle size={15} />} {review!.tests.passed}{' '}
								passaram
								{review!.tests.failed > 0 && <span> · {review!.tests.failed} falharam</span>}
								{review!.tests.skipped > 0 && <span> · {review!.tests.skipped} pulados</span>}
							</p>
							{review!.tests.failures.length > 0 && (
								<ul className="git-test-failures">
									{review!.tests.failures.map((failure, index) => (
										<li key={`${failure.id}-${index}`}>
											<code>{failure.id}</code> {failure.name}
											{failure.message && <span> — {failure.message}</span>}
											{failure.location && (
												<span className="git-test-where">
													{' '}
													{failure.location.path}
													{failure.location.line ? `:${failure.location.line}` : ''}
												</span>
											)}
										</li>
									))}
								</ul>
							)}
						</>
					)}
				</section>

				<section className="git-section">
					<h3>Pull request</h3>
					<div className="git-row">
						<input
							type="text"
							placeholder="Título"
							value={title}
							disabled={busy}
							onChange={(event) => setTitle(event.target.value)}
						/>
					</div>
					<div className="git-row">
						<textarea
							rows={3}
							placeholder="O que muda e por quê"
							value={description}
							disabled={busy}
							onChange={(event) => setDescription(event.target.value)}
						/>
					</div>
					<div className="git-row">
						<button
							type="button"
							className="btn btn--primary"
							disabled={busy || onDefaultBranch || !review || review.diff.files.length === 0}
							onClick={() => void createPullRequest()}
						>
							{review?.canCreatePullRequest ? 'Criar pull request' : 'Preparar no provedor'}
							<ExternalLink size={13} />
						</button>
					</div>
					{review && !review.canCreatePullRequest && (
						<p className="git-hint">
							Sem `GITHUB_TOKEN` no ambiente, o botão abre o provedor com título, descrição e resumo já
							preenchidos. A revisão e o merge acontecem lá.
						</p>
					)}
				</section>
			</div>
		</div>
	);
}
