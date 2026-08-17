import { useState } from 'react';
import { AlertCircle, AlertTriangle, Info, Lightbulb, ChevronDown, ChevronUp, Wand2 } from 'lucide-react';
import type { LintFinding, LintResult, Severity } from '../../lib/linter/types';
import { CATEGORY_LABELS } from '../../lib/linter/types';

/**
 * Painel de problemas do linter (§41) e detalhamento da nota (§50).
 *
 * Os findings de severidade `info` ficam de fora da lista: são estatísticas
 * ("3 exemplos de código"), não coisas a corrigir, e poluiriam a leitura de um
 * painel cuja função é dizer o que fazer.
 */

interface LintPanelProps {
	result: LintResult | null;
	running: boolean;
	error: string | null;
	onRevealLine: (line: number) => void;
	/** Aplica uma correção segura no buffer (§43). */
	onApplyFix: (finding: LintFinding) => void;
}

const ICONS: Record<Severity, typeof AlertCircle> = {
	error: AlertCircle,
	warning: AlertTriangle,
	suggestion: Lightbulb,
	info: Info,
};

const SEVERITY_LABEL: Record<Severity, string> = {
	error: 'Erro',
	warning: 'Aviso',
	suggestion: 'Sugestão',
	info: 'Informação',
};

export default function LintPanel({ result, running, error, onRevealLine, onApplyFix }: LintPanelProps) {
	const [open, setOpen] = useState(false);
	const [showBreakdown, setShowBreakdown] = useState(false);

	if (error) return <div className="lint-panel lint-panel--error">{error}</div>;
	if (!result) return null;

	const actionable = result.findings.filter((finding) => finding.severity !== 'info');
	const counts = result.counts;

	const gateClass =
		result.gate === 'fail' ? ' lint-panel--fail' : result.gate === 'warning' ? ' lint-panel--warn' : '';

	return (
		<div className={`lint-panel${gateClass}`}>
			<div className="lint-header">
				<button
					type="button"
					className="lint-score"
					onClick={() => setShowBreakdown((value) => !value)}
					title="Ver a nota por dimensão"
				>
					<strong>{result.score.toFixed(1)}</strong>
					<span>/ 10</span>
					<span className="lint-band">{result.band}</span>
				</button>

				<button type="button" className="lint-toggle" onClick={() => setOpen((value) => !value)}>
					<span>
						{actionable.length === 0
							? 'Nenhum problema'
							: `${actionable.length} problema${actionable.length > 1 ? 's' : ''}`}
					</span>
					{counts.error > 0 && <span className="lint-chip lint-chip--error">{counts.error}</span>}
					{counts.warning > 0 && <span className="lint-chip lint-chip--warning">{counts.warning}</span>}
					{counts.suggestion > 0 && <span className="lint-chip">{counts.suggestion}</span>}
					{running && <span className="lint-running">analisando…</span>}
					{actionable.length > 0 && (open ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
				</button>
			</div>

			{showBreakdown && (
				<div className="lint-breakdown">
					{Object.entries(result.categories).map(([category, value]) => (
						<div key={category} className="lint-breakdown-row">
							<span>{CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS] ?? category}</span>
							<span className="lint-breakdown-bar">
								<span style={{ width: `${value * 10}%` }} />
							</span>
							<span className="lint-breakdown-value">{value.toFixed(1)}</span>
						</div>
					))}
					<div className="lint-breakdown-row lint-breakdown-row--aside">
						<span>Preparo para IA</span>
						<span className="lint-breakdown-bar">
							<span style={{ width: `${result.aiReadiness * 10}%` }} />
						</span>
						<span className="lint-breakdown-value">{result.aiReadiness.toFixed(1)}</span>
					</div>
					<p className="lint-disclaimer">
						Avaliação editorial automatizada, baseada nas regras configuradas. Não verifica se a informação
						técnica está correta.
					</p>
				</div>
			)}

			{open && actionable.length > 0 && (
				<ul className="lint-list">
					{actionable.map((finding) => {
						const Icon = ICONS[finding.severity];
						return (
							<li key={finding.id} className={`lint-item lint-item--${finding.severity}`}>
								<button
									type="button"
									className="lint-item-main"
									onClick={() => onRevealLine(finding.location.startLine)}
									title={`Ir para a linha ${finding.location.startLine}`}
								>
									<Icon size={13} />
									<span className="lint-item-text">
										<span className="lint-message">{finding.message}</span>
										{finding.suggestion && <span className="lint-suggestion">{finding.suggestion}</span>}
										{finding.explanation && <span className="lint-explanation">{finding.explanation}</span>}
									</span>
									<span className="lint-meta">
										<span className="lint-rule">{finding.ruleId}</span>
										<span className="lint-line">L{finding.location.startLine}</span>
									</span>
								</button>

								{/* Correção só aparece quando é mecânica e segura (§43);
								    sugestões subjetivas não têm botão de aplicar. */}
								{finding.fix && (
									<button
										type="button"
										className="lint-fix"
										onClick={() => onApplyFix(finding)}
										title={`Aplicar: ${finding.fix.replacement || '(remover)'}`}
									>
										<Wand2 size={12} />
										Corrigir
									</button>
								)}
							</li>
						);
					})}
				</ul>
			)}

			{open && result.suppressed.length > 0 && (
				<p className="lint-suppressed">
					{result.suppressed.length} ocorrência(s) silenciada(s) por diretiva ou frontmatter.
				</p>
			)}

			<span className="sr-only">{SEVERITY_LABEL.error}</span>
		</div>
	);
}
