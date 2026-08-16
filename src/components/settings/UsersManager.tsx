import { useEffect, useMemo, useState } from 'react';
import type { Role } from '../../lib/auth/permissions';

/**
 * Gerência de usuários.
 *
 * Toda ação aqui é apenas um pedido: quem decide é a API. Os botões que este
 * componente esconde são conveniência de UX — a mesma requisição feita por
 * fora do navegador encontra a mesma checagem no servidor.
 */

interface ApiUser {
	id: string;
	name: string;
	email: string;
	role: Role;
	status: 'active' | 'inactive';
	createdAt: string;
	updatedAt: string;
}

interface Props {
	currentUserId: string;
}

const ROLE_LABELS: Record<Role, string> = { viewer: 'Viewer', editor: 'Editor', admin: 'Admin' };
const ROLE_OPTIONS: Role[] = ['viewer', 'editor', 'admin'];

type SortKey = 'name' | 'email' | 'role' | 'status';

/**
 * Texto da confirmação de troca de papel. O que importa para quem decide não é
 * o nome do papel, é o que a pessoa passa a poder fazer.
 */
function roleChangeMessage(from: Role, to: Role): string {
	const gainsEditor = from === 'viewer' && to !== 'viewer';
	const losesEditor = from !== 'viewer' && to === 'viewer';
	const gainsAdmin = to === 'admin' && from !== 'admin';
	const losesAdmin = from === 'admin' && to !== 'admin';

	if (gainsAdmin) return 'Este usuário passará a administrar o portal, incluindo usuários e permissões.';
	if (losesAdmin && losesEditor) return 'Este usuário perderá o acesso ao editor e à administração.';
	if (losesAdmin) return 'Este usuário perderá o acesso à administração, mas continuará podendo editar.';
	if (gainsEditor) return 'Este usuário ganhará acesso ao editor de documentação.';
	if (losesEditor) return 'Este usuário perderá o acesso ao editor de documentação.';
	return 'As permissões deste usuário serão alteradas.';
}

export default function UsersManager({ currentUserId }: Props) {
	const [users, setUsers] = useState<ApiUser[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const [query, setQuery] = useState('');
	const [roleFilter, setRoleFilter] = useState<'all' | Role>('all');
	const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
	const [sortKey, setSortKey] = useState<SortKey>('name');
	const [sortAsc, setSortAsc] = useState(true);

	const [creating, setCreating] = useState(false);
	const [editing, setEditing] = useState<ApiUser | null>(null);
	const [generatedPassword, setGeneratedPassword] = useState<{ email: string; password: string } | null>(null);

	async function load() {
		setLoading(true);
		setError(null);
		try {
			const response = await fetch('/api/admin/users');
			if (!response.ok) throw new Error('Não foi possível carregar os usuários.');
			const body = await response.json();
			setUsers(body.users ?? []);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Erro ao carregar.');
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		void load();
	}, []);

	const visible = useMemo(() => {
		const term = query.trim().toLowerCase();
		const filtered = users.filter((user) => {
			if (roleFilter !== 'all' && user.role !== roleFilter) return false;
			if (statusFilter !== 'all' && user.status !== statusFilter) return false;
			if (!term) return true;
			return user.name.toLowerCase().includes(term) || user.email.toLowerCase().includes(term);
		});

		return filtered.sort((a, b) => {
			const result = String(a[sortKey]).localeCompare(String(b[sortKey]), 'pt-BR');
			return sortAsc ? result : -result;
		});
	}, [users, query, roleFilter, statusFilter, sortKey, sortAsc]);

	function toggleSort(key: SortKey) {
		if (key === sortKey) setSortAsc((value) => !value);
		else {
			setSortKey(key);
			setSortAsc(true);
		}
	}

	const activeAdmins = users.filter((user) => user.role === 'admin' && user.status === 'active').length;

	return (
		<>
			<div className="toolbar">
				<input
					type="search"
					placeholder="Buscar por nome ou e-mail…"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					aria-label="Buscar usuários"
				/>
				<select
					value={roleFilter}
					onChange={(event) => setRoleFilter(event.target.value as 'all' | Role)}
					aria-label="Filtrar por grupo"
				>
					<option value="all">Todos os grupos</option>
					{ROLE_OPTIONS.map((role) => (
						<option key={role} value={role}>
							{ROLE_LABELS[role]}
						</option>
					))}
				</select>
				<select
					value={statusFilter}
					onChange={(event) => setStatusFilter(event.target.value as 'all' | 'active' | 'inactive')}
					aria-label="Filtrar por status"
				>
					<option value="all">Todos os status</option>
					<option value="active">Ativos</option>
					<option value="inactive">Inativos</option>
				</select>
				<div className="toolbar-end">
					<button type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
						+ Adicionar usuário
					</button>
				</div>
			</div>

			{error && <p className="form-error">{error}</p>}

			{generatedPassword && (
				<div className="callout callout--warn">
					<strong>Senha gerada para {generatedPassword.email}</strong>
					<span className="secret-value">{generatedPassword.password}</span>
					<p style={{ margin: '10px 0 0' }}>
						Ela aparece uma única vez — copie agora e repasse por um canal seguro.{' '}
						<button
							type="button"
							className="btn"
							style={{ marginTop: 8 }}
							onClick={() => setGeneratedPassword(null)}
						>
							Entendi
						</button>
					</p>
				</div>
			)}

			<div className="data-table-wrap">
				<table className="data-table">
					<thead>
						<tr>
							<th className="sortable" onClick={() => toggleSort('name')}>
								Nome {sortKey === 'name' ? (sortAsc ? '↑' : '↓') : ''}
							</th>
							<th className="sortable" onClick={() => toggleSort('email')}>
								E-mail {sortKey === 'email' ? (sortAsc ? '↑' : '↓') : ''}
							</th>
							<th className="sortable" onClick={() => toggleSort('role')}>
								Grupo {sortKey === 'role' ? (sortAsc ? '↑' : '↓') : ''}
							</th>
							<th className="sortable" onClick={() => toggleSort('status')}>
								Status {sortKey === 'status' ? (sortAsc ? '↑' : '↓') : ''}
							</th>
							<th />
						</tr>
					</thead>
					<tbody>
						{loading ? (
							<tr>
								<td colSpan={5} className="empty-state">
									Carregando…
								</td>
							</tr>
						) : visible.length === 0 ? (
							<tr>
								<td colSpan={5} className="empty-state">
									Nenhum usuário encontrado com esses filtros.
								</td>
							</tr>
						) : (
							visible.map((user) => (
								<tr key={user.id}>
									<td className="cell-name">
										{user.name}
										{user.id === currentUserId && <span className="you-tag">você</span>}
									</td>
									<td className="cell-email">{user.email}</td>
									<td>
										<span className={`role-badge role-badge--${user.role}`}>{ROLE_LABELS[user.role]}</span>
									</td>
									<td>
										<span className="status-badge">
											<span className={`status-dot${user.status === 'inactive' ? ' status-dot--inactive' : ''}`} />
											{user.status === 'active' ? 'Ativo' : 'Inativo'}
										</span>
									</td>
									<td className="cell-actions">
										<button type="button" className="btn" onClick={() => setEditing(user)}>
											Editar
										</button>
									</td>
								</tr>
							))
						)}
					</tbody>
				</table>
			</div>

			{creating && (
				<CreateUserModal
					onClose={() => setCreating(false)}
					onCreated={(user, password) => {
						setCreating(false);
						if (password) setGeneratedPassword({ email: user.email, password });
						void load();
					}}
				/>
			)}

			{editing && (
				<EditUserModal
					user={editing}
					isSelf={editing.id === currentUserId}
					activeAdmins={activeAdmins}
					onClose={() => setEditing(null)}
					onSaved={() => {
						setEditing(null);
						void load();
					}}
				/>
			)}
		</>
	);
}

// ---------------------------------------------------------------- create

function CreateUserModal({
	onClose,
	onCreated,
}: {
	onClose: () => void;
	onCreated: (user: ApiUser, generatedPassword?: string) => void;
}) {
	const [name, setName] = useState('');
	const [email, setEmail] = useState('');
	const [role, setRole] = useState<Role>('viewer');
	const [status, setStatus] = useState<'active' | 'inactive'>('active');
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	async function submit(event: React.FormEvent) {
		event.preventDefault();
		setError(null);
		setSaving(true);
		try {
			const response = await fetch('/api/admin/users', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name, email, role, status }),
			});
			const body = await response.json().catch(() => ({}));
			if (!response.ok) {
				setError(body.message ?? 'Não foi possível criar o usuário.');
				return;
			}
			onCreated(body.user, body.generatedPassword);
		} catch {
			setError('Não foi possível conectar ao servidor.');
		} finally {
			setSaving(false);
		}
	}

	return (
		<Modal onClose={onClose} title="Adicionar usuário" subtitle="Uma senha será gerada e exibida uma única vez.">
			<form onSubmit={submit}>
				{error && <p className="form-error">{error}</p>}

				<label className="field">
					Nome
					<input value={name} onChange={(event) => setName(event.target.value)} required autoFocus />
				</label>

				<label className="field">
					E-mail
					<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
				</label>

				<label className="field">
					Grupo
					<select value={role} onChange={(event) => setRole(event.target.value as Role)}>
						{ROLE_OPTIONS.map((option) => (
							<option key={option} value={option}>
								{ROLE_LABELS[option]}
							</option>
						))}
					</select>
				</label>

				<label className="field">
					Status
					<select value={status} onChange={(event) => setStatus(event.target.value as 'active' | 'inactive')}>
						<option value="active">Ativo</option>
						<option value="inactive">Inativo</option>
					</select>
				</label>

				<div className="modal-actions">
					<button type="button" className="btn" onClick={onClose} disabled={saving}>
						Cancelar
					</button>
					<button type="submit" className="btn btn--primary" disabled={saving}>
						{saving ? 'Criando…' : 'Criar usuário'}
					</button>
				</div>
			</form>
		</Modal>
	);
}

// ------------------------------------------------------------------ edit

function EditUserModal({
	user,
	isSelf,
	activeAdmins,
	onClose,
	onSaved,
}: {
	user: ApiUser;
	isSelf: boolean;
	activeAdmins: number;
	onClose: () => void;
	onSaved: () => void;
}) {
	const [name, setName] = useState(user.name);
	const [email, setEmail] = useState(user.email);
	const [role, setRole] = useState<Role>(user.role);
	const [status, setStatus] = useState(user.status);
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [confirmingRole, setConfirmingRole] = useState(false);
	const [confirmingDelete, setConfirmingDelete] = useState(false);

	const roleChanged = role !== user.role;

	/**
	 * O servidor é quem impede remover o último admin; este aviso só evita que
	 * a pessoa descubra isso através de um erro.
	 */
	const isLastActiveAdmin = user.role === 'admin' && user.status === 'active' && activeAdmins <= 1;

	async function persist() {
		setError(null);
		setSaving(true);
		try {
			const response = await fetch(`/api/admin/users/${user.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name, email, role, status }),
			});
			const body = await response.json().catch(() => ({}));
			if (!response.ok) {
				setError(body.message ?? 'Não foi possível salvar.');
				setConfirmingRole(false);
				return;
			}
			onSaved();
		} catch {
			setError('Não foi possível conectar ao servidor.');
		} finally {
			setSaving(false);
		}
	}

	async function remove() {
		setError(null);
		setSaving(true);
		try {
			const response = await fetch(`/api/admin/users/${user.id}`, { method: 'DELETE' });
			const body = await response.json().catch(() => ({}));
			if (!response.ok) {
				setError(body.message ?? 'Não foi possível excluir.');
				setConfirmingDelete(false);
				return;
			}
			onSaved();
		} catch {
			setError('Não foi possível conectar ao servidor.');
		} finally {
			setSaving(false);
		}
	}

	function submit(event: React.FormEvent) {
		event.preventDefault();
		// Alterar papel muda o que a pessoa pode fazer: sempre confirma.
		if (roleChanged) setConfirmingRole(true);
		else void persist();
	}

	if (confirmingRole) {
		return (
			<Modal onClose={() => setConfirmingRole(false)} title="Alterar o grupo do usuário?">
				<div className="callout callout--warn">
					{roleChangeMessage(user.role, role)}
					<p style={{ margin: '8px 0 0' }}>
						{ROLE_LABELS[user.role]} → <strong>{ROLE_LABELS[role]}</strong>
					</p>
				</div>
				{error && <p className="form-error">{error}</p>}
				<div className="modal-actions">
					<button type="button" className="btn" onClick={() => setConfirmingRole(false)} disabled={saving}>
						Cancelar
					</button>
					<button type="button" className="btn btn--primary" onClick={() => void persist()} disabled={saving}>
						{saving ? 'Salvando…' : 'Confirmar'}
					</button>
				</div>
			</Modal>
		);
	}

	if (confirmingDelete) {
		return (
			<Modal onClose={() => setConfirmingDelete(false)} title="Excluir usuário?">
				<div className="callout callout--danger">
					<strong>{user.name}</strong> perderá o acesso imediatamente e a conta não poderá ser recuperada.
					<p style={{ margin: '8px 0 0' }}>
						Para apenas remover o acesso mantendo o histórico, prefira desativar o usuário.
					</p>
				</div>
				{error && <p className="form-error">{error}</p>}
				<div className="modal-actions">
					<button type="button" className="btn" onClick={() => setConfirmingDelete(false)} disabled={saving}>
						Cancelar
					</button>
					<button type="button" className="btn btn--danger" onClick={() => void remove()} disabled={saving}>
						{saving ? 'Excluindo…' : 'Excluir'}
					</button>
				</div>
			</Modal>
		);
	}

	return (
		<Modal onClose={onClose} title="Editar usuário" subtitle={user.email}>
			<form onSubmit={submit}>
				{error && <p className="form-error">{error}</p>}

				{isLastActiveAdmin && (
					<div className="callout callout--warn">
						Este é o único administrador ativo. O sistema não permite rebaixá-lo, desativá-lo nem excluí-lo.
					</div>
				)}

				{isSelf && !isLastActiveAdmin && (
					<div className="callout callout--warn">
						Você está editando a própria conta. Rebaixar seu grupo faz você perder o acesso a esta tela.
					</div>
				)}

				<label className="field">
					Nome
					<input value={name} onChange={(event) => setName(event.target.value)} required />
				</label>

				<label className="field">
					E-mail
					<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
				</label>

				<label className="field">
					Grupo
					<select value={role} onChange={(event) => setRole(event.target.value as Role)}>
						{ROLE_OPTIONS.map((option) => (
							<option key={option} value={option}>
								{ROLE_LABELS[option]}
							</option>
						))}
					</select>
				</label>

				<label className="field">
					Status
					<select value={status} onChange={(event) => setStatus(event.target.value as 'active' | 'inactive')}>
						<option value="active">Ativo</option>
						<option value="inactive">Inativo</option>
					</select>
				</label>

				<div className="modal-actions">
					<button
						type="button"
						className="btn btn--danger"
						style={{ marginRight: 'auto' }}
						onClick={() => setConfirmingDelete(true)}
						disabled={saving}
					>
						Excluir
					</button>
					<button type="button" className="btn" onClick={onClose} disabled={saving}>
						Cancelar
					</button>
					<button type="submit" className="btn btn--primary" disabled={saving}>
						{saving ? 'Salvando…' : 'Salvar alterações'}
					</button>
				</div>
			</form>
		</Modal>
	);
}

// ----------------------------------------------------------------- modal

function Modal({
	title,
	subtitle,
	onClose,
	children,
}: {
	title: string;
	subtitle?: string;
	onClose: () => void;
	children: React.ReactNode;
}) {
	useEffect(() => {
		function onKey(event: KeyboardEvent) {
			if (event.key === 'Escape') onClose();
		}
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	}, [onClose]);

	return (
		<div className="modal-overlay" role="presentation" onClick={onClose}>
			<div
				className="modal-card"
				role="dialog"
				aria-modal="true"
				aria-label={title}
				onClick={(event) => event.stopPropagation()}
			>
				<h2>{title}</h2>
				{subtitle && <p className="modal-subtitle">{subtitle}</p>}
				{children}
			</div>
		</div>
	);
}
