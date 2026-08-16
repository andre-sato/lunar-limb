import { describe, it, expect } from 'vitest';
import {
	can,
	canAll,
	permissionsFor,
	ROLE_PERMISSIONS,
	PERMISSIONS,
	PERMISSION_GROUPS,
	type AuthUser,
	type Permission,
	type Role,
} from '../src/lib/auth/permissions';
import { authorize, requiredPermissions, isProtected, normalizePath } from '../src/lib/auth/guard';

function user(role: Role, status: 'active' | 'inactive' = 'active'): AuthUser {
	return { id: `${role}-1`, role, status };
}

const viewer = user('viewer');
const editor = user('editor');
const admin = user('admin');

describe('matriz de permissões', () => {
	// A tabela da especificação (§12), transcrita como teste. Se alguém mexer
	// na matriz sem intenção, é aqui que aparece.
	const matrix: Array<[Permission, boolean, boolean, boolean]> = [
		['docs.read', true, true, true],
		['docs.create', false, true, true],
		['docs.update', false, true, true],
		['docs.delete', false, true, true],
		['editor.access', false, true, true],
		['users.read', false, false, true],
		['users.create', false, false, true],
		['users.update', false, false, true],
		['users.delete', false, false, true],
		['permissions.manage', false, false, true],
		['settings.access', false, false, true],
		['audit.read', false, false, true],
	];

	it.each(matrix)('%s → viewer=%s editor=%s admin=%s', (permission, v, e, a) => {
		expect(can(viewer, permission)).toBe(v);
		expect(can(editor, permission)).toBe(e);
		expect(can(admin, permission)).toBe(a);
	});

	it('cobre todas as permissões declaradas', () => {
		expect(matrix.map(([permission]) => permission).sort()).toEqual([...PERMISSIONS].sort());
	});

	it('expõe cada permissão em algum grupo da tela de Roles', () => {
		const shown = PERMISSION_GROUPS.flatMap((group) => group.permissions.map((entry) => entry.permission));
		expect([...shown].sort()).toEqual([...PERMISSIONS].sort());
	});

	it('nega tudo para anônimo', () => {
		for (const permission of PERMISSIONS) {
			expect(can(null, permission)).toBe(false);
			expect(can(undefined, permission)).toBe(false);
		}
	});

	it('nega tudo para usuário inativo, inclusive admin', () => {
		const suspended = user('admin', 'inactive');
		for (const permission of PERMISSIONS) {
			expect(can(suspended, permission)).toBe(false);
		}
	});

	it('editor é superconjunto de viewer, admin de editor', () => {
		for (const permission of permissionsFor('viewer')) {
			expect(ROLE_PERMISSIONS.editor).toContain(permission);
		}
		for (const permission of permissionsFor('editor')) {
			expect(ROLE_PERMISSIONS.admin).toContain(permission);
		}
	});

	it('canAll exige todas as permissões', () => {
		expect(canAll(editor, ['docs.read', 'editor.access'])).toBe(true);
		expect(canAll(editor, ['docs.read', 'users.read'])).toBe(false);
	});
});

describe('guard — mapeamento de rotas', () => {
	it('trata documentação como pública', () => {
		expect(requiredPermissions('/guides/authentication')).toEqual([]);
		expect(requiredPermissions('/')).toEqual([]);
		expect(isProtected('/en/api-reference/errors')).toBe(false);
	});

	it('protege o editor e tudo abaixo dele', () => {
		expect(requiredPermissions('/editor')).toContain('editor.access');
		expect(requiredPermissions('/editor/guides/authentication')).toContain('editor.access');
	});

	it('protege settings e tudo abaixo dele', () => {
		expect(requiredPermissions('/settings')).toContain('settings.access');
		expect(requiredPermissions('/settings/users')).toContain('settings.access');
		expect(requiredPermissions('/settings/roles')).toContain('settings.access');
	});

	it('normaliza a barra final', () => {
		expect(normalizePath('/settings/')).toBe('/settings');
		expect(requiredPermissions('/settings/')).toContain('settings.access');
		expect(requiredPermissions('/editor/')).toContain('editor.access');
	});

	it('exige permissão de escrita conforme o método na API do editor', () => {
		expect(requiredPermissions('/api/editor/file', 'GET')).toEqual(['editor.access']);
		expect(requiredPermissions('/api/editor/file', 'PUT')).toEqual(['editor.access', 'docs.update']);
		expect(requiredPermissions('/api/editor/file', 'POST')).toEqual(['editor.access', 'docs.create']);
		expect(requiredPermissions('/api/editor/file', 'DELETE')).toEqual(['editor.access', 'docs.delete']);
	});

	it('exige a permissão correspondente em cada método de usuários', () => {
		expect(requiredPermissions('/api/admin/users', 'GET')).toContain('users.read');
		expect(requiredPermissions('/api/admin/users', 'POST')).toContain('users.create');
		expect(requiredPermissions('/api/admin/users/abc', 'PATCH')).toContain('users.update');
		expect(requiredPermissions('/api/admin/users/abc', 'DELETE')).toContain('users.delete');
	});

	it('deixa o login e o logout públicos', () => {
		expect(requiredPermissions('/api/auth/login', 'POST')).toEqual([]);
		expect(requiredPermissions('/api/auth/logout', 'POST')).toEqual([]);
		expect(requiredPermissions('/api/auth/me', 'GET')).toEqual([]);
	});

	it('default-deny: rota administrativa desconhecida já nasce protegida', () => {
		// Não existe regra para este caminho; ele não pode ser público por isso.
		const required = requiredPermissions('/api/admin/uma-rota-que-ainda-nao-existe', 'POST');
		expect(required.length).toBeGreaterThan(0);
		expect(can(editor, required[0])).toBe(false);
	});

	it('método de escrita sem regra própria não cai no caso de leitura', () => {
		// Um método exótico numa rota com regras por método precisa exigir ao
		// menos o mesmo que um PUT.
		const required = requiredPermissions('/api/editor/file', 'PROPPATCH');
		expect(required).toContain('docs.update');
	});
});

describe('guard — decisões por papel', () => {
	it('viewer: 403 no editor, no settings e nas APIs de escrita', () => {
		expect(authorize(viewer, '/editor').kind).toBe('forbid');
		expect(authorize(viewer, '/editor/guides/authentication').kind).toBe('forbid');
		expect(authorize(viewer, '/settings').kind).toBe('forbid');
		expect(authorize(viewer, '/api/editor/file', 'PUT').kind).toBe('forbid');
		expect(authorize(viewer, '/api/admin/users', 'POST').kind).toBe('forbid');
		expect(authorize(viewer, '/api/admin/users/x', 'PATCH').kind).toBe('forbid');
	});

	it('viewer: documentação continua liberada', () => {
		expect(authorize(viewer, '/guides/authentication').kind).toBe('allow');
	});

	it('editor: entra no editor e escreve documento, mas não em settings', () => {
		expect(authorize(editor, '/editor').kind).toBe('allow');
		expect(authorize(editor, '/editor/guides/authentication').kind).toBe('allow');
		expect(authorize(editor, '/api/editor/file', 'PUT').kind).toBe('allow');
		expect(authorize(editor, '/api/editor/file', 'DELETE').kind).toBe('allow');

		expect(authorize(editor, '/settings').kind).toBe('forbid');
		expect(authorize(editor, '/api/admin/users', 'GET').kind).toBe('forbid');
		expect(authorize(editor, '/api/admin/users', 'POST').kind).toBe('forbid');
		expect(authorize(editor, '/api/admin/users/x', 'PATCH').kind).toBe('forbid');
	});

	it('admin: acesso completo', () => {
		expect(authorize(admin, '/editor').kind).toBe('allow');
		expect(authorize(admin, '/settings').kind).toBe('allow');
		expect(authorize(admin, '/api/editor/file', 'PUT').kind).toBe('allow');
		expect(authorize(admin, '/api/admin/users', 'POST').kind).toBe('allow');
		expect(authorize(admin, '/api/admin/users/x', 'PATCH').kind).toBe('allow');
		expect(authorize(admin, '/api/admin/audit', 'GET').kind).toBe('allow');
	});

	it('anônimo recebe "authenticate" e não "forbid"', () => {
		// A distinção importa: mandar para o login quem nunca entrou, e não
		// devolver 403 sem caminho de saída.
		expect(authorize(null, '/editor').kind).toBe('authenticate');
		expect(authorize(null, '/settings').kind).toBe('authenticate');
		expect(authorize(null, '/api/editor/file', 'PUT').kind).toBe('authenticate');
	});

	it('usuário desativado perde o acesso mesmo mantendo o papel', () => {
		const suspendedAdmin = user('admin', 'inactive');
		expect(authorize(suspendedAdmin, '/settings').kind).toBe('authenticate');
		expect(authorize(suspendedAdmin, '/editor').kind).toBe('authenticate');
	});
});

describe('cenários de API da especificação (§46)', () => {
	// viewer → PUT document → 403 ; editor → 200 ; admin → 200 ; etc.
	const cases: Array<[string, AuthUser, string, string, 'allow' | 'forbid']> = [
		['viewer → PUT document', viewer, '/api/editor/file', 'PUT', 'forbid'],
		['editor → PUT document', editor, '/api/editor/file', 'PUT', 'allow'],
		['admin  → PUT document', admin, '/api/editor/file', 'PUT', 'allow'],
		['viewer → POST user', viewer, '/api/admin/users', 'POST', 'forbid'],
		['editor → POST user', editor, '/api/admin/users', 'POST', 'forbid'],
		['admin  → POST user', admin, '/api/admin/users', 'POST', 'allow'],
		['viewer → PATCH user role', viewer, '/api/admin/users/abc', 'PATCH', 'forbid'],
		['editor → PATCH user role', editor, '/api/admin/users/abc', 'PATCH', 'forbid'],
		['admin  → PATCH user role', admin, '/api/admin/users/abc', 'PATCH', 'allow'],
	];

	it.each(cases)('%s', (_label, actor, path, method, expected) => {
		expect(authorize(actor, path, method).kind).toBe(expected);
	});
});
