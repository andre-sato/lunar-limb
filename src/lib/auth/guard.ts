/**
 * Mapa rota → permissões exigidas.
 *
 * Módulo puro para poder ser testado sem subir servidor: os testes de
 * autorização exercitam esta tabela diretamente, e não a aparência dos
 * componentes React.
 *
 * O desenho é **default-deny por prefixo**: qualquer caminho sob `/api/admin/`
 * exige permissão administrativa mesmo que ninguém tenha adicionado uma regra
 * específica para ele. Criar uma rota nova não a torna pública por
 * esquecimento — o pior caso é ela exigir permissão demais, que aparece na
 * hora, em vez de permissão de menos, que passa silenciosa.
 */

import { canAll, type AuthUser, type Permission } from './permissions';

export type Decision =
	| { kind: 'allow' }
	/** Ninguém autenticado: 401 na API, redirecionamento para login nas páginas. */
	| { kind: 'authenticate'; required: readonly Permission[] }
	/** Autenticado, mas sem a capacidade: 403. */
	| { kind: 'forbid'; required: readonly Permission[] };

type Method = string;

interface Rule {
	/** Casa o caminho exato ou qualquer coisa abaixo dele. */
	prefix: string;
	/** Permissões exigidas em qualquer método. */
	base: readonly Permission[];
	/** Permissões adicionais por método HTTP. */
	byMethod?: Readonly<Record<string, readonly Permission[]>>;
}

/**
 * Lista branca de métodos seguros. É o complemento que importa: qualquer coisa
 * fora daqui conta como escrita. Enumerar os métodos de escrita, em vez dos de
 * leitura, deixaria um método incomum cair no caso permissivo.
 */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Rotas públicas dentro de um prefixo protegido. Mantido curto de propósito —
 * cada entrada aqui é uma exceção à regra de negação.
 */
const PUBLIC_PATHS: readonly string[] = ['/api/auth/login', '/api/auth/logout', '/api/auth/me'];

const RULES: readonly Rule[] = [
	// Área administrativa.
	{
		prefix: '/settings',
		base: ['settings.access'],
	},
	{
		prefix: '/api/admin/users',
		base: ['settings.access'],
		byMethod: {
			GET: ['users.read'],
			POST: ['users.create'],
			PATCH: ['users.update'],
			PUT: ['users.update'],
			DELETE: ['users.delete'],
		},
	},
	{
		prefix: '/api/admin/audit',
		base: ['settings.access', 'audit.read'],
	},
	{
		prefix: '/api/admin/analytics',
		base: ['settings.access', 'analytics.read'],
	},
	{
		prefix: '/api/admin/quality',
		base: ['settings.access', 'analytics.read'],
	},
	{
		// A leitura do feedback é analytics: reaproveita a capacidade em vez de
		// criar uma permissão quase idêntica.
		prefix: '/api/admin/feedback',
		base: ['settings.access', 'analytics.read'],
	},
	{
		prefix: '/api/admin/integrations',
		base: ['settings.access'],
		byMethod: {
			GET: ['integrations.manage'],
			// Escrever a configuração e testar a conexão manipulam credenciais.
			PUT: ['integrations.manage'],
			POST: ['integrations.manage'],
		},
	},
	// Qualquer outra rota administrativa futura.
	{
		prefix: '/api/admin',
		base: ['settings.access', 'permissions.manage'],
	},

	// Editor: a interface e as APIs que leem/escrevem conteúdo.
	{
		prefix: '/editor',
		base: ['editor.access'],
	},
	{
		// Analisar um documento é leitura, ainda que use POST por causa do
		// corpo. Sem esta regra, cairia no caso geral de `/api/editor` e
		// exigiria `docs.create` para rodar o linter.
		prefix: '/api/editor/lint',
		base: ['editor.access'],
	},
	{
		prefix: '/api/editor',
		base: ['editor.access'],
		byMethod: {
			POST: ['docs.create'],
			PUT: ['docs.update'],
			PATCH: ['docs.update'],
			DELETE: ['docs.delete'],
		},
	},
];

function matchesPrefix(pathname: string, prefix: string): boolean {
	if (pathname === prefix) return true;
	// Trailing slash do Astro: `/settings/` casa com a regra de `/settings`.
	if (pathname === `${prefix}/`) return true;
	return pathname.startsWith(`${prefix}/`);
}

/** Remove trailing slash (exceto na raiz) para as comparações ficarem estáveis. */
export function normalizePath(pathname: string): string {
	if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
	return pathname;
}

/**
 * Permissões exigidas por um caminho + método. Array vazio = rota pública.
 */
export function requiredPermissions(pathname: string, method: Method = 'GET'): readonly Permission[] {
	const path = normalizePath(pathname);
	if (PUBLIC_PATHS.includes(path)) return [];

	const rule = RULES.find((candidate) => matchesPrefix(path, candidate.prefix));
	if (!rule) return [];

	const upperMethod = method.toUpperCase();
	const extra = rule.byMethod?.[upperMethod] ?? [];

	// Um método de escrita sem regra explícita não deve cair no caso base de
	// leitura: exige-se ao menos o mesmo que um PUT exigiria.
	if (!READ_METHODS.has(upperMethod) && extra.length === 0 && rule.byMethod) {
		const fallback = rule.byMethod['PUT'] ?? rule.byMethod['POST'] ?? [];
		return dedupe([...rule.base, ...fallback]);
	}

	return dedupe([...rule.base, ...extra]);
}

function dedupe(permissions: readonly Permission[]): readonly Permission[] {
	return [...new Set(permissions)];
}

export function isProtected(pathname: string, method: Method = 'GET'): boolean {
	return requiredPermissions(pathname, method).length > 0;
}

/**
 * Decisão de acesso para uma requisição.
 *
 * A distinção entre `authenticate` e `forbid` importa: quem não entrou merece
 * uma tela de login, quem entrou e não tem a capacidade merece um 403 honesto
 * em vez de ser mandado para o login de novo, num laço.
 */
export function authorize(
	user: AuthUser | null | undefined,
	pathname: string,
	method: Method = 'GET'
): Decision {
	const required = requiredPermissions(pathname, method);
	if (required.length === 0) return { kind: 'allow' };
	if (!user || user.status !== 'active') return { kind: 'authenticate', required };
	if (canAll(user, required)) return { kind: 'allow' };
	return { kind: 'forbid', required };
}
