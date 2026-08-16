import { useState } from 'react';
import { AlertCircle, AlertTriangle, ChevronDown, ChevronUp, Info, CircleCheck } from 'lucide-react';
import type { ContentProblem, ProblemSeverity } from './types';

interface ProblemsPanelProps {
	problems: ContentProblem[];
	/** Move o cursor do Monaco para a linha do problema, quando ele tem linha. */
	onRevealLine: (line: number) => void;
}

const ICONS: Record<ProblemSeverity, typeof AlertCircle> = {
	error: AlertCircle,
	warning: AlertTriangle,
	info: Info,
};

const KIND_LABEL: Record<ContentProblem['kind'], string> = {
	'broken-reference': 'Referência quebrada',
	'circular-reference': 'Referência circular',
	'duplicate-id': 'Id duplicado',
	'unused-content': 'Conteúdo sem uso',
};

/**
 * Fase 4 — Problems panel (§35 da especificação), restrito ao arquivo aberto.
 * Referências quebradas e ciclos aparecem aqui com a linha exata; clicar leva
 * o cursor até lá. A visão global equivalente fica no modal do grafo.
 */
export default function ProblemsPanel({ problems, onRevealLine }: ProblemsPanelProps) {
	const [open, setOpen] = useState(false);

	const errors = problems.filter((problem) => problem.severity === 'error');
	if (problems.length === 0) return null;

	return (
		<div className={`problems-panel${errors.length > 0 ? ' problems-panel--error' : ''}`}>
			<button type="button" className="problems-header" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
				{errors.length > 0 ? <AlertCircle size={13} /> : <CircleCheck size={13} />}
				<span>
					Problemas ({problems.length})
					{errors.length > 0 && <strong> · {errors.length} erro{errors.length > 1 ? 's' : ''}</strong>}
				</span>
				{open ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
			</button>

			{open && (
				<ul className="problems-list">
					{problems.map((problem, index) => {
						const Icon = ICONS[problem.severity];
						return (
							<li key={`${problem.kind}-${index}`} className={`problem problem--${problem.severity}`}>
								<Icon size={13} />
								<span className="problem-kind">{KIND_LABEL[problem.kind]}</span>
								<span className="problem-message">{problem.message}</span>
								{problem.location && (
									<button
										type="button"
										className="reference-line-btn"
										onClick={() => onRevealLine(problem.location!.line)}
										title="Ir para a linha"
									>
										L{problem.location.line}
									</button>
								)}
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}
