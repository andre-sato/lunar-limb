/**
 * Serviço de usuários: CRUD e as invariantes que não podem depender da UI.
 *
 * As regras críticas (último admin, unicidade de e-mail, quem pode mudar
 * papel) moram aqui, e não nas rotas. Uma rota nova que chame este serviço
 * herda as proteções; se elas vivessem no handler HTTP, cada rota precisaria
 * lembrar de reimplementá-las.
 */

import { randomUUID } from 'node:crypto';
import { readJson, withFileLock, writeJson } from './store';
import { hashPassword, verifyPassword, generatePassword, checkPasswordPolicy } from './password';
import { can, isRole, type AuthUser, type Role } from './permissions';
import { recordAudit } from './audit';

const FILE = 'users.json';

export type UserStatus = 'active' | 'inactive';

export interface User {
	id: string;
	name: string;
	email: string;
	role: Role;
	status: UserStatus;
	createdAt: string;
	updatedAt: string;
	passwordHash: string;
	/** Marca o admin semeado automaticamente, para a UI pedir a troca da senha. */
	mustChangePassword?: boolean;
}

/** Usuário sem material secreto — é esta forma que sai para a UI e para a API. */
export type PublicUser = Omit<User, 'passwordHash'>;

export type AuthErrorCode =
	| 'not_found'
	| 'email_taken'
	| 'invalid_input'
	| 'forbidden'
	| 'last_admin';

export class AuthError extends Error {
	constructor(
		readonly code: AuthErrorCode,
		message: string
	) {
		super(message);
		this.name = 'AuthError';
	}
}

export function toPublicUser(user: User): PublicUser {
	const { passwordHash: _passwordHash, ...rest } = user;
	return rest;
}

function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateName(name: unknown): string {
	if (typeof name !== 'string' || name.trim().length < 2) {
		throw new AuthError('invalid_input', 'Informe um nome com ao menos 2 caracteres.');
	}
	if (name.trim().length > 120) {
		throw new AuthError('invalid_input', 'O nome pode ter no máximo 120 caracteres.');
	}
	return name.trim();
}

function validateEmail(email: unknown): string {
	if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
		throw new AuthError('invalid_input', 'Informe um e-mail válido.');
	}
	return normalizeEmail(email);
}

function validateRole(role: unknown): Role {
	if (!isRole(role)) throw new AuthError('invalid_input', 'Papel inválido.');
	return role;
}

function validateStatus(status: unknown): UserStatus {
	if (status !== 'active' && status !== 'inactive') {
		throw new AuthError('invalid_input', 'Status inválido.');
	}
	return status;
}

async function readUsers(): Promise<User[]> {
	return readJson<User[]>(FILE, []);
}

export async function listUsers(): Promise<PublicUser[]> {
	const users = await readUsers();
	return users.map(toPublicUser);
}

export async function findUserById(id: string): Promise<PublicUser | null> {
	const users = await readUsers();
	const found = users.find((user) => user.id === id);
	return found ? toPublicUser(found) : null;
}

export async function countUsers(): Promise<{ total: number; byRole: Record<Role, number>; active: number }> {
	const users = await readUsers();
	const byRole: Record<Role, number> = { viewer: 0, editor: 0, admin: 0 };
	let active = 0;
	for (const user of users) {
		byRole[user.role] = (byRole[user.role] ?? 0) + 1;
		if (user.status === 'active') active++;
	}
	return { total: users.length, byRole, active };
}

function activeAdmins(users: readonly User[]): User[] {
	return users.filter((user) => user.role === 'admin' && user.status === 'active');
}

/**
 * O sistema precisa manter ao menos um administrador ativo. Rebaixar,
 * desativar ou excluir o último deles deixaria o portal sem ninguém capaz de
 * gerenciar usuários — sem caminho de volta pela interface.
 */
function assertNotLastActiveAdmin(users: readonly User[], targetId: string): void {
	const admins = activeAdmins(users);
	if (admins.length <= 1 && admins.some((admin) => admin.id === targetId)) {
		throw new AuthError(
			'last_admin',
			'Não é possível concluir: o sistema precisa de ao menos um administrador ativo.'
		);
	}
}

export interface CreateUserInput {
	name: string;
	email: string;
	role: Role;
	status?: UserStatus;
	password?: string;
}

export async function createUser(
	input: CreateUserInput,
	actor: AuthUser
): Promise<{ user: PublicUser; generatedPassword?: string }> {
	if (!can(actor, 'users.create')) {
		throw new AuthError('forbidden', 'Sem permissão para criar usuários.');
	}

	const name = validateName(input.name);
	const email = validateEmail(input.email);
	const role = validateRole(input.role);
	const status = validateStatus(input.status ?? 'active');

	// Criar alguém com papel mais poderoso do que o próprio ator seria escalação
	// de privilégio por via indireta.
	if (!can(actor, 'permissions.manage')) {
		throw new AuthError('forbidden', 'Sem permissão para definir o papel de um usuário.');
	}

	let password = input.password;
	let generated: string | undefined;
	if (password === undefined || password === '') {
		generated = generatePassword();
		password = generated;
	} else {
		const policy = checkPasswordPolicy(password);
		if (!policy.ok) throw new AuthError('invalid_input', policy.message!);
	}

	const passwordHash = await hashPassword(password);

	const created = await withFileLock(FILE, async () => {
		const users = await readUsers();
		if (users.some((user) => normalizeEmail(user.email) === email)) {
			throw new AuthError('email_taken', 'Já existe um usuário com este e-mail.');
		}

		const now = new Date().toISOString();
		const user: User = {
			id: randomUUID(),
			name,
			email,
			role,
			status,
			createdAt: now,
			updatedAt: now,
			passwordHash,
			// Senha gerada por nós é senha de entrega: quem recebe precisa
			// trocá-la, porque ela passou por um canal que não é da pessoa.
			// Senha escolhida por quem cria não tem esse problema.
			mustChangePassword: generated !== undefined,
		};
		users.push(user);
		await writeJson(FILE, users);
		return user;
	});

	await recordAudit({
		actorId: actor.id,
		action: 'USER_CREATED',
		targetId: created.id,
		metadata: { email: created.email, role: created.role },
	});

	return { user: toPublicUser(created), generatedPassword: generated };
}

export interface UpdateUserInput {
	name?: string;
	email?: string;
	role?: Role;
	status?: UserStatus;
	password?: string;
}

export async function updateUser(id: string, patch: UpdateUserInput, actor: AuthUser): Promise<PublicUser> {
	if (!can(actor, 'users.update')) {
		throw new AuthError('forbidden', 'Sem permissão para editar usuários.');
	}

	// A alteração de papel é a operação sensível: exige capacidade própria.
	// Um ator sem ela que envie `role` no corpo recebe 403 em vez de ter o
	// campo silenciosamente ignorado — falhar alto evita a falsa sensação de
	// que a alteração foi aplicada.
	if (patch.role !== undefined && !can(actor, 'permissions.manage')) {
		throw new AuthError('forbidden', 'Sem permissão para alterar o papel de um usuário.');
	}

	const name = patch.name !== undefined ? validateName(patch.name) : undefined;
	const email = patch.email !== undefined ? validateEmail(patch.email) : undefined;
	const role = patch.role !== undefined ? validateRole(patch.role) : undefined;
	const status = patch.status !== undefined ? validateStatus(patch.status) : undefined;

	let passwordHash: string | undefined;
	if (patch.password !== undefined && patch.password !== '') {
		const policy = checkPasswordPolicy(patch.password);
		if (!policy.ok) throw new AuthError('invalid_input', policy.message!);
		passwordHash = await hashPassword(patch.password);
	}

	const { updated, changes } = await withFileLock(FILE, async () => {
		const users = await readUsers();
		const index = users.findIndex((user) => user.id === id);
		if (index === -1) throw new AuthError('not_found', 'Usuário não encontrado.');

		const current = users[index];

		if (email && email !== normalizeEmail(current.email)) {
			if (users.some((user) => user.id !== id && normalizeEmail(user.email) === email)) {
				throw new AuthError('email_taken', 'Já existe um usuário com este e-mail.');
			}
		}

		const losesAdmin = role !== undefined && current.role === 'admin' && role !== 'admin';
		const goesInactive = status === 'inactive' && current.status === 'active';
		if (losesAdmin || goesInactive) {
			assertNotLastActiveAdmin(users, id);
		}

		const next: User = {
			...current,
			name: name ?? current.name,
			email: email ?? current.email,
			role: role ?? current.role,
			status: status ?? current.status,
			passwordHash: passwordHash ?? current.passwordHash,
			updatedAt: new Date().toISOString(),
		};
		if (passwordHash) delete next.mustChangePassword;

		users[index] = next;
		await writeJson(FILE, users);

		return {
			updated: next,
			changes: {
				roleChanged: role !== undefined && role !== current.role ? { from: current.role, to: role } : null,
				statusChanged:
					status !== undefined && status !== current.status ? { from: current.status, to: status } : null,
				passwordChanged: Boolean(passwordHash),
			},
		};
	});

	if (changes.roleChanged) {
		await recordAudit({
			actorId: actor.id,
			action: 'USER_ROLE_CHANGED',
			targetId: id,
			metadata: changes.roleChanged,
		});
	}
	if (changes.statusChanged) {
		await recordAudit({
			actorId: actor.id,
			action: changes.statusChanged.to === 'inactive' ? 'USER_DEACTIVATED' : 'USER_REACTIVATED',
			targetId: id,
		});
	}
	if (!changes.roleChanged && !changes.statusChanged) {
		await recordAudit({
			actorId: actor.id,
			action: 'USER_UPDATED',
			targetId: id,
			metadata: { passwordChanged: changes.passwordChanged },
		});
	}

	return toPublicUser(updated);
}

export async function deleteUser(id: string, actor: AuthUser): Promise<void> {
	if (!can(actor, 'users.delete')) {
		throw new AuthError('forbidden', 'Sem permissão para excluir usuários.');
	}

	const removed = await withFileLock(FILE, async () => {
		const users = await readUsers();
		const target = users.find((user) => user.id === id);
		if (!target) throw new AuthError('not_found', 'Usuário não encontrado.');

		assertNotLastActiveAdmin(users, id);

		await writeJson(
			FILE,
			users.filter((user) => user.id !== id)
		);
		return target;
	});

	await recordAudit({
		actorId: actor.id,
		action: 'USER_DELETED',
		targetId: id,
		metadata: { email: removed.email },
	});
}

/**
 * Verifica credenciais.
 *
 * Retorna `null` indistintamente para e-mail inexistente, senha errada e conta
 * inativa: distinguir os casos na resposta entrega ao atacante a informação de
 * quais e-mails existem.
 */
export async function verifyCredentials(email: unknown, password: unknown): Promise<User | null> {
	if (typeof email !== 'string' || typeof password !== 'string') return null;

	const users = await readUsers();
	const user = users.find((candidate) => normalizeEmail(candidate.email) === normalizeEmail(email));
	if (!user) {
		// Gasta o mesmo tempo de um scrypt real: sem isso, uma resposta rápida
		// denuncia que o e-mail não existe.
		await hashPassword(password);
		return null;
	}

	const valid = await verifyPassword(password, user.passwordHash);
	if (!valid) return null;
	if (user.status !== 'active') return null;

	return user;
}

/**
 * Cria o primeiro administrador quando não há nenhum usuário.
 *
 * Aceita `PORTAL_ADMIN_EMAIL` / `PORTAL_ADMIN_PASSWORD`; sem eles, gera uma
 * senha aleatória e a imprime **uma única vez** no console do servidor. A
 * senha nunca vai para o repositório nem para a interface.
 */
export async function seedInitialAdmin(): Promise<void> {
	await withFileLock(FILE, async () => {
		const users = await readUsers();
		if (users.length > 0) return;

		const email = normalizeEmail(process.env.PORTAL_ADMIN_EMAIL || 'admin@example.com');
		const explicitPassword = process.env.PORTAL_ADMIN_PASSWORD;
		const password = explicitPassword && explicitPassword.length >= 12 ? explicitPassword : generatePassword();

		const now = new Date().toISOString();
		const admin: User = {
			id: randomUUID(),
			name: 'Administrador',
			email,
			role: 'admin',
			status: 'active',
			createdAt: now,
			updatedAt: now,
			passwordHash: await hashPassword(password),
			mustChangePassword: !explicitPassword,
		};

		await writeJson(FILE, [admin]);

		if (!explicitPassword) {
			console.info(
				[
					'',
					'─'.repeat(64),
					' Portal: primeiro administrador criado',
					'',
					`   E-mail: ${email}`,
					`   Senha:  ${password}`,
					'',
					' Esta senha aparece uma única vez. Troque-a após entrar,',
					' ou defina PORTAL_ADMIN_EMAIL/PORTAL_ADMIN_PASSWORD.',
					'─'.repeat(64),
					'',
				].join('\n')
			);
		}
	});
}
