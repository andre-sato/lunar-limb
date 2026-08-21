import { useEffect, useMemo, useState } from 'react';
import { validateSidebar } from '../../lib/editor/sidebar-validate';

/**
 * Organizar a navegação (issue #11, opção A).
 *
 * Arrastar reordena **os dados da barra lateral**, não os arquivos. A diferença
 * é a razão de a tela existir assim: o caminho de uma página vem do disco, então
 * mover `guides/sdk.mdx` para outra pasta trocaria `/guides/sdk/` por outra URL
 * e quebraria links internos, links externos e as referências de conteúdo
 * reutilizável. Reordenar dados não muda URL nenhuma.
 *
 * Arrastar é mouse. Cada item também tem botões de mover — subir, descer e
 * trocar de grupo —, porque um recurso que só funciona arrastando exclui quem
 * navega por teclado e quem usa leitor de tela.
 */

interface Group {
	label: { 'pt-BR': string; en: string; es: string };
	collapsed: boolean;
	items: string[];
}

interface Issue {
	code: string;
	message: string;
	severity: 'error' | 'warning';
}

interface Payload {
	config: { guides: Group[] };
	available: string[];
	hidden: string[];
	titles: Record<string, string>;
	validation: { valid: boolean; issues: Issue[]; orphans: string[] };
}

interface Props {
	onClose: () => void;
}

interface Drag {
	group: number;
	index: number;
}

export default function SidebarOrganizerModal({ onClose }: Props) {
	const [groups, setGroups] = useState<Group[] | null>(null);
	const [titles, setTitles] = useState<Record<string, string>>({});
	const [available, setAvailable] = useState<string[]>([]);
	const [hidden, setHidden] = useState<string[]>([]);
	const [issues, setIssues] = useState<Issue[]>([]);
	const [drag, setDrag] = useState<Drag | null>(null);
	const [status, setStatus] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		fetch('/api/editor/sidebar')
			.then((response) => response.json() as Promise<Payload>)
			.then((data) => {
				setGroups(data.config.guides);
				setTitles(data.titles);
				setAvailable(data.available);
				setHidden(data.hidden ?? []);
				setIssues(data.validation.issues);
			})
			.catch(() => setStatus('Não foi possível carregar a navegação.'));
	}, []);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onClose();
		};
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	}, [onClose]);

	/**
	 * O veredito do estado atual, pela **mesma função que o servidor roda**.
	 *
	 * Antes o formulário só olhava páginas órfãs, e por isso deixava clicar em
	 * Salvar com um grupo vazio — o `PUT` recusava, e a pessoa só descobria
	 * depois. Duas validações divergem; esta é uma só, rodando dos dois lados.
	 */
	const live = useMemo(
		() => (groups ? validateSidebar({ guides: groups }, available, new Set(hidden)) : null),
		[groups, available, hidden]
	);

	const orphans = live?.orphans ?? [];
	const errors = (live?.issues ?? issues).filter((issue) => issue.severity === 'error');

	function move(from: Drag, toGroup: number, toIndex: number) {
		setGroups((current) => {
			if (!current) return current;
			const next = current.map((group) => ({ ...group, items: [...group.items] }));
			const [slug] = next[from.group].items.splice(from.index, 1);
			// Tirar antes de inserir muda o índice de destino quando o movimento é
			// para baixo dentro do mesmo grupo.
			const target = from.group === toGroup && from.index < toIndex ? toIndex - 1 : toIndex;
			next[toGroup].items.splice(Math.max(0, target), 0, slug);
			return next;
		});
		setStatus(null);
	}

	function renameGroup(index: number, locale: keyof Group['label'], value: string) {
		setGroups((current) =>
			current?.map((group, position) =>
				position === index ? { ...group, label: { ...group.label, [locale]: value } } : group
			) ?? current
		);
	}

	async function save() {
		if (!groups) return;
		setSaving(true);
		setStatus(null);

		try {
			const response = await fetch('/api/editor/sidebar', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ guides: groups }),
			});
			const data = await response.json();

			if (!response.ok) {
				setIssues(data.validation?.issues ?? [{ code: 'ERRO', message: 'Não foi possível salvar.', severity: 'error' }]);
				setStatus('Não salvo: corrija os problemas abaixo.');
				return;
			}

			setIssues(data.validation?.issues ?? []);
			setStatus(data.notice ?? 'Salvo.');
		} catch {
			setStatus('Falha de rede ao salvar.');
		} finally {
			setSaving(false);
		}
	}

	if (!groups) {
		return (
			<div className="modal-backdrop" onClick={onClose}>
				<div className="modal modal--wide" onClick={(event) => event.stopPropagation()}>
					<p className="modal-hint">{status ?? 'Carregando…'}</p>
				</div>
			</div>
		);
	}

	return (
		<div className="modal-backdrop" onClick={onClose}>
			<div
				className="modal modal--wide sidebar-organizer"
				role="dialog"
				aria-modal="true"
				aria-labelledby="sidebar-organizer-title"
				onClick={(event) => event.stopPropagation()}
			>
				<div className="modal-header">
					<h2 id="sidebar-organizer-title">Organizar a navegação</h2>
					<button type="button" className="icon-btn" onClick={onClose} title="Fechar" aria-label="Fechar">
						×
					</button>
				</div>

				<p className="modal-hint">
					Arrastar reordena a <strong>barra lateral</strong>, não os arquivos. Nenhuma URL muda — e é
					por isso que a organização vive em dados, e não em pastas.
				</p>

				{errors.length > 0 && (
					<ul className="modal-error sidebar-organizer__issues" role="alert">
						{errors.map((issue, index) => (
							<li key={`${issue.code}-${index}`}>
								<code>{issue.code}</code> {issue.message}
							</li>
						))}
					</ul>
				)}

				{orphans.length > 0 && (
					<p className="modal-error" role="status">
						{orphans.length} página(s) fora de qualquer grupo — elas sumiriam da navegação:{' '}
						{orphans.map((slug) => titles[slug] ?? slug).join(', ')}
					</p>
				)}

				<div className="modal-body sidebar-organizer__groups">
					{groups.map((group, groupIndex) => (
						<section key={groupIndex} className="sidebar-organizer__group">
							<header>
								<input
									value={group.label['pt-BR']}
									onChange={(event) => renameGroup(groupIndex, 'pt-BR', event.target.value)}
									aria-label={`Nome do grupo ${groupIndex + 1} em português`}
								/>
								<label>
									<input
										type="checkbox"
										checked={!group.collapsed}
										onChange={(event) =>
											setGroups((current) =>
												current?.map((entry, position) =>
													position === groupIndex ? { ...entry, collapsed: !event.target.checked } : entry
												) ?? current
											)
										}
									/>{' '}
									aberto
								</label>
								<span className="sidebar-organizer__count">{group.items.length}</span>
							</header>

							<ul
								onDragOver={(event) => event.preventDefault()}
								onDrop={(event) => {
									event.preventDefault();
									if (drag) move(drag, groupIndex, group.items.length);
									setDrag(null);
								}}
							>
								{group.items.map((slug, itemIndex) => (
									<li
										key={slug}
										draggable
										onDragStart={() => setDrag({ group: groupIndex, index: itemIndex })}
										onDragOver={(event) => event.preventDefault()}
										onDrop={(event) => {
											event.preventDefault();
											event.stopPropagation();
											if (drag) move(drag, groupIndex, itemIndex);
											setDrag(null);
										}}
									>
										<span className="sidebar-organizer__handle" aria-hidden="true">
											⠿
										</span>
										<span className="sidebar-organizer__title">{titles[slug] ?? slug}</span>
										<code>{slug}</code>

										{/* Arrastar é mouse. Estes botões são o mesmo movimento por teclado. */}
										<span className="sidebar-organizer__moves">
											<button
												type="button"
												disabled={itemIndex === 0}
												onClick={() => move({ group: groupIndex, index: itemIndex }, groupIndex, itemIndex - 1)}
												aria-label={`Subir ${titles[slug] ?? slug}`}
											>
												↑
											</button>
											<button
												type="button"
												disabled={itemIndex === group.items.length - 1}
												onClick={() => move({ group: groupIndex, index: itemIndex }, groupIndex, itemIndex + 2)}
												aria-label={`Descer ${titles[slug] ?? slug}`}
											>
												↓
											</button>
											<select
												value={groupIndex}
												onChange={(event) =>
													move({ group: groupIndex, index: itemIndex }, Number(event.target.value), 0)
												}
												aria-label={`Mover ${titles[slug] ?? slug} para outro grupo`}
											>
												{groups.map((target, index) => (
													<option key={index} value={index}>
														{target.label['pt-BR']}
													</option>
												))}
											</select>
										</span>
									</li>
								))}
							</ul>
						</section>
					))}
				</div>

				{status && <p className="modal-hint sidebar-organizer__status">{status}</p>}

				<div className="modal-actions">
					<button type="button" onClick={onClose}>
						Fechar
					</button>
					<button
						type="button"
						className="primary"
						onClick={save}
						disabled={saving || live?.valid === false}
						title={live?.valid === false ? 'Corrija os problemas antes de salvar.' : undefined}
					>
						{saving ? 'Salvando…' : 'Salvar'}
					</button>
				</div>
			</div>
		</div>
	);
}
