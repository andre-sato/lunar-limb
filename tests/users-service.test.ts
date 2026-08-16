import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Testes do serviço de usuários contra o filesystem de verdade.
 *
 * O store resolve `data/` a partir de `process.cwd()` no momento em que o
 * módulo carrega, então cada teste roda num diretório temporário próprio e
 * reimporta os módulos. Isso exercita a escrita atômica e o lock de arquivo em
 * vez de um mock deles — que é justamente onde erros de concorrência moram.
 */

const originalCwd = process.cwd();
const tempDirs: string[] = [];

type UsersModule = typeof import('../src/lib/auth/users');

async function freshModule(): Promise<UsersModule> {
	const dir = await mkdtemp(path.join(tmpdir(), 'portal-auth-'));
	tempDirs.push(dir);
	process.chdir(dir);
	vi.resetModules();
	return import('../src/lib/auth/users');
}

const adminActor = { id: 'actor-admin', role: 'admin' as const, status: 'active' as const };
const editorActor = { id: 'actor-editor', role: 'editor' as const, status: 'active' as const };
const viewerActor = { id: 'actor-viewer', role: 'viewer' as const, status: 'active' as const };

let users: UsersModule;

beforeEach(async () => {
	users = await freshModule();
});

afterAll(async () => {
	process.chdir(originalCwd);
	await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('criação de usuário', () => {
	it('cria e devolve uma senha gerada uma única vez', async () => {
		const { user, generatedPassword } = await users.createUser(
			{ name: 'Ana Souza', email: 'ana@example.com', role: 'editor' },
			adminActor
		);

		expect(user.name).toBe('Ana Souza');
		expect(user.role).toBe('editor');
		expect(user.status).toBe('active');
		expect(generatedPassword).toBeTruthy();
		expect(generatedPassword!.length).toBeGreaterThanOrEqual(16);

		// O hash nunca sai do serviço.
		expect((user as Record<string, unknown>).passwordHash).toBeUndefined();
	});

	it('normaliza o e-mail e recusa duplicata em outro caixa', async () => {
		await users.createUser({ name: 'Ana', email: 'Ana@Example.com', role: 'viewer' }, adminActor);

		await expect(
			users.createUser({ name: 'Outra', email: 'ana@example.com', role: 'viewer' }, adminActor)
		).rejects.toMatchObject({ code: 'email_taken' });
	});

	it('recusa e-mail e nome inválidos', async () => {
		await expect(
			users.createUser({ name: 'Ana', email: 'sem-arroba', role: 'viewer' }, adminActor)
		).rejects.toMatchObject({ code: 'invalid_input' });

		// Nome curto demais.
		await expect(
			users.createUser({ name: 'A', email: 'a@example.com', role: 'viewer' }, adminActor)
		).rejects.toMatchObject({ code: 'invalid_input' });
	});

	it('recusa papel inválido', async () => {
		await expect(
			users.createUser({ name: 'Ana', email: 'a@example.com', role: 'superadmin' as never }, adminActor)
		).rejects.toMatchObject({ code: 'invalid_input' });
	});

	it('bloqueia editor e viewer de criar usuários', async () => {
		await expect(
			users.createUser({ name: 'Ana', email: 'a@example.com', role: 'viewer' }, editorActor)
		).rejects.toMatchObject({ code: 'forbidden' });

		await expect(
			users.createUser({ name: 'Ana', email: 'a@example.com', role: 'viewer' }, viewerActor)
		).rejects.toMatchObject({ code: 'forbidden' });
	});

	it('recusa senha fraca quando informada explicitamente', async () => {
		await expect(
			users.createUser({ name: 'Ana', email: 'a@example.com', role: 'viewer', password: '123' }, adminActor)
		).rejects.toMatchObject({ code: 'invalid_input' });
	});
});

describe('escalação de privilégio', () => {
	it('editor não consegue alterar o papel de ninguém', async () => {
		const { user } = await users.createUser(
			{ name: 'Ana', email: 'ana@example.com', role: 'viewer' },
			adminActor
		);

		await expect(users.updateUser(user.id, { role: 'admin' }, editorActor)).rejects.toMatchObject({
			code: 'forbidden',
		});

		// E o papel realmente não mudou no disco.
		const after = await users.findUserById(user.id);
		expect(after!.role).toBe('viewer');
	});

	it('viewer não consegue editar usuários', async () => {
		const { user } = await users.createUser(
			{ name: 'Ana', email: 'ana@example.com', role: 'viewer' },
			adminActor
		);

		await expect(users.updateUser(user.id, { name: 'Outro nome' }, viewerActor)).rejects.toMatchObject({
			code: 'forbidden',
		});
	});

	it('campos fora da lista branca não viram promoção', async () => {
		const { user } = await users.createUser(
			{ name: 'Ana', email: 'ana@example.com', role: 'viewer' },
			adminActor
		);

		// `id` e `createdAt` não são editáveis; só o que o serviço conhece é aplicado.
		await users.updateUser(
			user.id,
			{ name: 'Ana Maria', id: 'outro-id', createdAt: '1999-01-01' } as never,
			adminActor
		);

		const after = await users.findUserById(user.id);
		expect(after!.id).toBe(user.id);
		expect(after!.createdAt).toBe(user.createdAt);
		expect(after!.name).toBe('Ana Maria');
	});
});

describe('proteção do último administrador', () => {
	async function seedSingleAdmin() {
		const { user } = await users.createUser(
			{ name: 'Root', email: 'root@example.com', role: 'admin' },
			adminActor
		);
		return user;
	}

	it('impede rebaixar o último admin ativo', async () => {
		const root = await seedSingleAdmin();

		await expect(users.updateUser(root.id, { role: 'editor' }, adminActor)).rejects.toMatchObject({
			code: 'last_admin',
		});
	});

	it('impede desativar o último admin ativo', async () => {
		const root = await seedSingleAdmin();

		await expect(users.updateUser(root.id, { status: 'inactive' }, adminActor)).rejects.toMatchObject({
			code: 'last_admin',
		});
	});

	it('impede excluir o último admin ativo', async () => {
		const root = await seedSingleAdmin();

		await expect(users.deleteUser(root.id, adminActor)).rejects.toMatchObject({ code: 'last_admin' });
	});

	it('permite rebaixar quando existe outro admin ativo', async () => {
		const first = await seedSingleAdmin();
		await users.createUser({ name: 'Segundo', email: 'dois@example.com', role: 'admin' }, adminActor);

		const updated = await users.updateUser(first.id, { role: 'editor' }, adminActor);
		expect(updated.role).toBe('editor');
	});

	it('um segundo admin inativo não conta como reserva', async () => {
		const first = await seedSingleAdmin();
		await users.createUser(
			{ name: 'Reserva', email: 'tres@example.com', role: 'admin', status: 'inactive' },
			adminActor
		);

		await expect(users.updateUser(first.id, { status: 'inactive' }, adminActor)).rejects.toMatchObject({
			code: 'last_admin',
		});
	});
});

describe('autenticação', () => {
	it('aceita a senha correta e rejeita a errada', async () => {
		await users.createUser(
			{ name: 'Ana', email: 'ana@example.com', role: 'editor', password: 'senha-bem-longa-123' },
			adminActor
		);

		expect(await users.verifyCredentials('ana@example.com', 'senha-bem-longa-123')).toBeTruthy();
		expect(await users.verifyCredentials('ana@example.com', 'senha-errada-123456')).toBeNull();
	});

	it('aceita e-mail em qualquer caixa', async () => {
		await users.createUser(
			{ name: 'Ana', email: 'ana@example.com', role: 'editor', password: 'senha-bem-longa-123' },
			adminActor
		);

		expect(await users.verifyCredentials('ANA@EXAMPLE.COM', 'senha-bem-longa-123')).toBeTruthy();
	});

	it('recusa usuário inativo mesmo com a senha certa', async () => {
		await users.createUser(
			{
				name: 'Ana',
				email: 'ana@example.com',
				role: 'editor',
				status: 'inactive',
				password: 'senha-bem-longa-123',
			},
			adminActor
		);

		expect(await users.verifyCredentials('ana@example.com', 'senha-bem-longa-123')).toBeNull();
	});

	it('não distingue e-mail inexistente de senha errada', async () => {
		expect(await users.verifyCredentials('ninguem@example.com', 'qualquer-coisa-123')).toBeNull();
	});

	it('recusa entradas que não são string', async () => {
		expect(await users.verifyCredentials(null, undefined)).toBeNull();
		expect(await users.verifyCredentials({}, [])).toBeNull();
	});
});

describe('contagem e seed', () => {
	it('conta por papel e status', async () => {
		await users.createUser({ name: 'Ana', email: 'a@example.com', role: 'viewer' }, adminActor);
		await users.createUser({ name: 'Bruno', email: 'b@example.com', role: 'viewer' }, adminActor);
		await users.createUser({ name: 'Célia', email: 'c@example.com', role: 'editor' }, adminActor);
		await users.createUser(
			{ name: 'Diego', email: 'd@example.com', role: 'admin', status: 'inactive' },
			adminActor
		);

		const counts = await users.countUsers();
		expect(counts.total).toBe(4);
		expect(counts.byRole).toEqual({ viewer: 2, editor: 1, admin: 1 });
		expect(counts.active).toBe(3);
	});

	it('semeia um admin quando não há usuário nenhum', async () => {
		process.env.PORTAL_ADMIN_EMAIL = 'chefe@example.com';
		process.env.PORTAL_ADMIN_PASSWORD = 'uma-senha-bem-longa';

		await users.seedInitialAdmin();

		const list = await users.listUsers();
		expect(list).toHaveLength(1);
		expect(list[0].email).toBe('chefe@example.com');
		expect(list[0].role).toBe('admin');
		expect(await users.verifyCredentials('chefe@example.com', 'uma-senha-bem-longa')).toBeTruthy();

		delete process.env.PORTAL_ADMIN_EMAIL;
		delete process.env.PORTAL_ADMIN_PASSWORD;
	});

	it('não semeia de novo quando já existe alguém', async () => {
		await users.createUser({ name: 'Ana', email: 'a@example.com', role: 'admin' }, adminActor);
		await users.seedInitialAdmin();

		expect(await users.listUsers()).toHaveLength(1);
	});
});

describe('escritas concorrentes', () => {
	it('não perde usuários criados em paralelo', async () => {
		// Sem o lock por arquivo, o read-modify-write de cada criação
		// sobrescreveria o das outras e sobraria só a última.
		await Promise.all(
			Array.from({ length: 8 }, (_, index) =>
				users.createUser(
					{ name: `Usuário ${index}`, email: `u${index}@example.com`, role: 'viewer' },
					adminActor
				)
			)
		);

		expect(await users.listUsers()).toHaveLength(8);
	});
});
