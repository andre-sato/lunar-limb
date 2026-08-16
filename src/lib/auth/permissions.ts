/**
 * Camada central de autorização.
 *
 * Módulo puro, sem I/O: é o único lugar que decide o que cada papel pode
 * fazer. Tanto a UI quanto o middleware e as rotas de API consultam este
 * arquivo — não existe regra de permissão espalhada por componente.
 *
 * O código sempre pergunta por **capacidade** (`can(user, 'users.update')`),
 * nunca por nome de papel (`user.role === 'admin'`). É o que permitirá criar
 * papéis novos ("Technical Writer", "Support") mexendo só na tabela abaixo.
 */

export const ROLES = ['viewer', 'editor', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
	'docs.read',
	'docs.create',
	'docs.update',
	'docs.delete',
	'editor.access',
	'users.read',
	'users.create',
	'users.update',
	'users.delete',
	'permissions.manage',
	'settings.access',
	'audit.read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const VIEWER_PERMISSIONS: readonly Permission[] = ['docs.read'];

const EDITOR_PERMISSIONS: readonly Permission[] = [
	...VIEWER_PERMISSIONS,
	'docs.create',
	'docs.update',
	'docs.delete',
	'editor.access',
];

const ADMIN_PERMISSIONS: readonly Permission[] = [
	...EDITOR_PERMISSIONS,
	'users.read',
	'users.create',
	'users.update',
	'users.delete',
	'permissions.manage',
	'settings.access',
	'audit.read',
];

/**
 * A matriz de permissões. Cada papel é um superconjunto do anterior hoje, mas
 * nada no mecanismo depende disso — um papel futuro pode ter qualquer
 * combinação.
 */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
	viewer: VIEWER_PERMISSIONS,
	editor: EDITOR_PERMISSIONS,
	admin: ADMIN_PERMISSIONS,
};

/** Identidade mínima que a autorização precisa conhecer. */
export interface AuthUser {
	id: string;
	role: Role;
	status: 'active' | 'inactive';
}

export function isRole(value: unknown): value is Role {
	return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export function isPermission(value: unknown): value is Permission {
	return typeof value === 'string' && (PERMISSIONS as readonly string[]).includes(value);
}

/**
 * Pergunta central do sistema.
 *
 * Usuário ausente (anônimo) ou inativo não tem capacidade nenhuma — desativar
 * alguém precisa cortar o acesso mesmo que a sessão dele ainda exista.
 */
export function can(user: AuthUser | null | undefined, permission: Permission): boolean {
	if (!user) return false;
	if (user.status !== 'active') return false;
	return ROLE_PERMISSIONS[user.role]?.includes(permission) ?? false;
}

export function canAll(user: AuthUser | null | undefined, permissions: readonly Permission[]): boolean {
	return permissions.every((permission) => can(user, permission));
}

export function canAny(user: AuthUser | null | undefined, permissions: readonly Permission[]): boolean {
	return permissions.some((permission) => can(user, permission));
}

export function permissionsFor(role: Role): readonly Permission[] {
	return ROLE_PERMISSIONS[role] ?? [];
}

/**
 * Agrupamento usado pela tela "Roles & Permissions". Fica aqui, junto da
 * matriz, para uma permissão nova não passar despercebida pela tela.
 */
export const PERMISSION_GROUPS: ReadonlyArray<{
	label: string;
	permissions: ReadonlyArray<{ permission: Permission; label: string }>;
}> = [
	{
		label: 'Documentação',
		permissions: [
			{ permission: 'docs.read', label: 'Ler' },
			{ permission: 'docs.create', label: 'Criar' },
			{ permission: 'docs.update', label: 'Editar' },
			{ permission: 'docs.delete', label: 'Excluir' },
		],
	},
	{
		label: 'Editor',
		permissions: [{ permission: 'editor.access', label: 'Acessar' }],
	},
	{
		label: 'Usuários',
		permissions: [
			{ permission: 'users.read', label: 'Ler' },
			{ permission: 'users.create', label: 'Criar' },
			{ permission: 'users.update', label: 'Editar' },
			{ permission: 'users.delete', label: 'Excluir' },
		],
	},
	{
		label: 'Permissões',
		permissions: [{ permission: 'permissions.manage', label: 'Gerenciar' }],
	},
	{
		label: 'Configurações',
		permissions: [
			{ permission: 'settings.access', label: 'Acessar' },
			{ permission: 'audit.read', label: 'Ver auditoria' },
		],
	},
];

export const ROLE_LABELS: Readonly<Record<Role, string>> = {
	viewer: 'Viewer',
	editor: 'Editor',
	admin: 'Admin',
};

export const ROLE_DESCRIPTIONS: Readonly<Record<Role, string>> = {
	viewer: 'Lê e pesquisa a documentação.',
	editor: 'Cria e mantém a documentação no editor.',
	admin: 'Controla quem pode fazer o quê.',
};
