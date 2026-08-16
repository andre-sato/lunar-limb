import { useEffect, useState } from 'react';
import { Plus, ToggleLeft, ToggleRight, Trash2, X } from 'lucide-react';
import { fetchVariables, saveVariables } from './api';
import { isValidVariableName, type VariableMap, type VariableValue } from '../../lib/content/variables';

interface VariablesModalProps {
	onClose: () => void;
	/** Chamado após gravar, para o preview reavaliar as condicionais. */
	onSaved: (variables: VariableMap) => void;
}

/**
 * Fase 5 — CRUD das variáveis de conteúdo.
 *
 * Grava em `src/config/content-variables.json`, um arquivo versionado como
 * qualquer outro. Ligar/desligar uma variável muda o que aparece no preview na
 * hora, e no site publicado no próximo build.
 */
export default function VariablesModal({ onClose, onSaved }: VariablesModalProps) {
	const [variables, setVariables] = useState<VariableMap>({});
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [newName, setNewName] = useState('');

	useEffect(() => {
		fetchVariables()
			.then(setVariables)
			.catch((err) => setError(err instanceof Error ? err.message : 'Erro ao carregar variáveis.'))
			.finally(() => setLoading(false));
	}, []);

	function update(name: string, patch: Partial<{ value: VariableValue; description: string }>) {
		setVariables((prev) => ({ ...prev, [name]: { ...prev[name], ...patch } }));
	}

	function remove(name: string) {
		const usedWarning = `Remover a variável "${name}"? Trechos condicionados a ela passam a ficar ocultos.`;
		if (!window.confirm(usedWarning)) return;
		setVariables((prev) => {
			const next = { ...prev };
			delete next[name];
			return next;
		});
	}

	function add() {
		const name = newName.trim();
		if (!name) return;
		if (!isValidVariableName(name)) {
			setError(`Nome inválido: "${name}". Comece com uma letra; use letras, números, "-" e "_".`);
			return;
		}
		if (variables[name]) {
			setError(`A variável "${name}" já existe.`);
			return;
		}
		setVariables((prev) => ({ ...prev, [name]: { value: false } }));
		setNewName('');
		setError(null);
	}

	async function persist() {
		setSaving(true);
		setError(null);
		try {
			const saved = await saveVariables(variables);
			setVariables(saved);
			onSaved(saved);
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Erro ao salvar variáveis.');
			setSaving(false);
		}
	}

	const names = Object.keys(variables).sort();

	return (
		<div className="modal-backdrop" role="presentation" onClick={onClose}>
			<div className="modal modal--variables" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
				<div className="modal-header">
					<h2>Variáveis de conteúdo</h2>
					<button type="button" className="icon-btn" onClick={onClose} title="Fechar">
						<X size={16} />
					</button>
				</div>

				<div className="modal-body">
					<p className="modal-hint">
						Use em uma página <code>.mdx</code> com <code>{'<If flag="nome">…</If>'}</code>, ou no frontmatter com{' '}
						<code>showIf: nome</code> para condicionar a página inteira.
					</p>

					{loading && <p className="reusable-loading">Carregando…</p>}
					{error && <p className="modal-error">{error}</p>}

					{!loading && names.length === 0 && <p className="reusable-empty">Nenhuma variável definida ainda.</p>}

					<div className="variable-list">
						{names.map((name) => {
							const definition = variables[name];
							const isBoolean = typeof definition.value === 'boolean';
							return (
								<div key={name} className="variable-row">
									<div className="variable-head">
										<code className="variable-name">{name}</code>

										{isBoolean ? (
											<button
												type="button"
												className={`variable-toggle${definition.value === true ? ' on' : ''}`}
												onClick={() => update(name, { value: !(definition.value as boolean) })}
												title={definition.value === true ? 'Ligada' : 'Desligada'}
											>
												{definition.value === true ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
												{definition.value === true ? 'ligada' : 'desligada'}
											</button>
										) : (
											<input
												type="text"
												className="variable-value"
												value={definition.value as string}
												onChange={(e) => update(name, { value: e.target.value })}
												placeholder="valor"
											/>
										)}

										<button type="button" className="tree-row-action" onClick={() => remove(name)} title="Remover">
											<Trash2 size={14} />
										</button>
									</div>

									<input
										type="text"
										className="variable-description"
										value={definition.description ?? ''}
										onChange={(e) => update(name, { description: e.target.value })}
										placeholder="Descrição (opcional) — ajuda quem for escrever depois"
									/>
								</div>
							);
						})}
					</div>

					<div className="variable-add">
						<input
							type="text"
							value={newName}
							placeholder="nova-variavel"
							onChange={(e) => setNewName(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault();
									add();
								}
							}}
						/>
						<button type="button" onClick={add}>
							<Plus size={14} /> Adicionar
						</button>
					</div>

					<div className="modal-actions">
						<button type="button" onClick={onClose} disabled={saving}>
							Cancelar
						</button>
						<button type="button" className="primary" onClick={() => void persist()} disabled={saving || loading}>
							{saving ? 'Salvando…' : 'Salvar variáveis'}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
