/**
 * Registro de versões da documentação (§3, §6, §7).
 *
 * Este módulo é a **fonte única** sobre quais versões existem, em que estado
 * cada uma está e a que branch ou tag ela corresponde. Content Graph, glossário,
 * linter, assistente e MCP leem daqui — nenhum deles inventa a sua própria noção
 * de versão.
 *
 * Por que um arquivo e não configuração espalhada: uma versão obsoleta muda o
 * que o leitor vê, o que o linter cobra e o que o assistente responde. Essas
 * três coisas não podem discordar, e a única forma de garantir isso é elas
 * lerem a mesma linha do mesmo arquivo.
 *
 * O ciclo de vida vem da spec e a ordem importa:
 *
 *     draft → current → maintained → deprecated → archived
 *
 * `current` é a versão que o portal mostra por padrão. Só pode haver uma —
 * duas versões "atuais" é uma pergunta sem resposta para quem chega.
 */

import yaml from 'js-yaml';

export const LIFECYCLE = ['draft', 'current', 'maintained', 'deprecated', 'archived'] as const;
export type VersionStatus = (typeof LIFECYCLE)[number];

export interface DocVersion {
	/** Identificador estável, usado na URL: `v2`. */
	id: string;
	/** Rótulo exibido no seletor. */
	label: string;
	status: VersionStatus;
	/** Branch que contém o conteúdo desta versão. */
	branch?: string;
	/** Tag, quando a versão é um ponto congelado em vez de uma branch viva. */
	tag?: string;
	/** Versão sugerida a quem chegar numa obsoleta (§17). */
	supersededBy?: string;
	/** `true` redireciona a versão obsoleta para a sugerida (§17). */
	redirect?: boolean;
}

export interface VersionRegistry {
	versions: DocVersion[];
	/** A versão `current`. `null` quando o registro está vazio. */
	current: DocVersion | null;
	/** Versões que aparecem no seletor: tudo menos `draft` e `archived`. */
	selectable: DocVersion[];
}

export class VersionRegistryError extends Error {}

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

function asString(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

/**
 * Interpreta o registro.
 *
 * Valida cedo e com mensagem: um erro aqui derruba o build, e derrubar o build
 * com "versão inválida" é muito melhor que publicar um seletor que leva a 404.
 */
export function parseRegistry(raw: string): VersionRegistry {
	if (raw.trim() === '') return { versions: [], current: null, selectable: [] };

	let loaded: unknown;
	try {
		loaded = yaml.load(raw);
	} catch (error) {
		throw new VersionRegistryError(
			`Registro de versões inválido: ${error instanceof Error ? error.message : error}`
		);
	}

	const list = (loaded as { versions?: unknown })?.versions;
	if (list === undefined) return { versions: [], current: null, selectable: [] };
	if (!Array.isArray(list)) throw new VersionRegistryError('`versions` precisa ser uma lista.');

	const versions: DocVersion[] = [];
	const seen = new Set<string>();

	for (const entry of list) {
		if (!entry || typeof entry !== 'object') {
			throw new VersionRegistryError('Cada versão precisa ser um objeto.');
		}

		const raw = entry as Record<string, unknown>;
		const id = asString(raw.id);

		if (id === '') throw new VersionRegistryError('Versão sem `id`.');
		if (!ID_PATTERN.test(id)) {
			throw new VersionRegistryError(
				`Id inválido: "${id}". Use letras, números, ponto, hífen ou sublinhado — ele vai para a URL.`
			);
		}
		if (seen.has(id.toLowerCase())) {
			throw new VersionRegistryError(`Versão duplicada: "${id}".`);
		}
		seen.add(id.toLowerCase());

		const status = asString(raw.status) || 'maintained';
		if (!LIFECYCLE.includes(status as VersionStatus)) {
			throw new VersionRegistryError(
				`Estado desconhecido em "${id}": "${status}". Use ${LIFECYCLE.join(', ')}.`
			);
		}

		const branch = asString(raw.branch);
		const tag = asString(raw.tag);
		if (branch && tag) {
			// Uma versão vem de um lugar só; duas origens é ambiguidade que só
			// aparece no dia em que as duas divergirem.
			throw new VersionRegistryError(`"${id}" declara branch e tag ao mesmo tempo. Escolha uma.`);
		}

		versions.push({
			id,
			label: asString(raw.label) || id,
			status: status as VersionStatus,
			branch: branch || undefined,
			tag: tag || undefined,
			supersededBy: asString(raw.supersededBy) || undefined,
			redirect: raw.redirect === true,
		});
	}

	const currents = versions.filter((version) => version.status === 'current');
	if (currents.length > 1) {
		throw new VersionRegistryError(
			`Mais de uma versão marcada como "current": ${currents.map((version) => version.id).join(', ')}.`
		);
	}
	if (versions.length > 0 && currents.length === 0) {
		throw new VersionRegistryError('Nenhuma versão marcada como "current".');
	}

	// Uma versão obsoleta que aponta para outra precisa apontar para uma que
	// exista, senão o aviso manda o leitor a lugar nenhum.
	for (const version of versions) {
		if (version.supersededBy && !seen.has(version.supersededBy.toLowerCase())) {
			throw new VersionRegistryError(
				`"${version.id}" aponta para "${version.supersededBy}", que não está no registro.`
			);
		}
		if (version.redirect && !version.supersededBy) {
			throw new VersionRegistryError(`"${version.id}" pede redirecionamento sem dizer para onde.`);
		}
	}

	return {
		versions,
		current: currents[0] ?? null,
		// `draft` ainda não é pública e `archived` deixou de ser: nenhuma das duas
		// entra no seletor, embora continuem no registro e acessíveis por URL.
		selectable: versions.filter(
			(version) => version.status !== 'draft' && version.status !== 'archived'
		),
	};
}

// ---------------------------------------------------------------------------
// Resolução a partir da URL (§5)
// ---------------------------------------------------------------------------

export interface ResolvedPath {
	/** A versão identificada no caminho, ou a atual quando não há prefixo. */
	version: DocVersion | null;
	/** O caminho sem o prefixo de versão. */
	path: string;
	/** `true` quando a versão veio escrita na URL. */
	explicit: boolean;
}

/**
 * Separa versão e caminho.
 *
 * `/v1/guides/auth/` → versão `v1`, caminho `/guides/auth/`.
 * `/guides/auth/` → versão atual, caminho `/guides/auth/`.
 *
 * Sem prefixo é a versão atual, e não "sem versão": a documentação sempre
 * descreve alguma versão, e fingir o contrário é o que produz a pergunta
 * "isto ainda vale para o que eu uso?".
 */
export function resolvePath(pathname: string, registry: VersionRegistry): ResolvedPath {
	const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`;
	const [, first = '', ...rest] = normalized.split('/');

	const match = registry.versions.find((version) => version.id.toLowerCase() === first.toLowerCase());
	if (match) {
		return { version: match, path: `/${rest.join('/')}`, explicit: true };
	}

	return { version: registry.current, path: normalized, explicit: false };
}

/** Caminho de uma página numa versão. A atual não recebe prefixo. */
export function versionedPath(path: string, version: DocVersion, registry: VersionRegistry): string {
	const clean = path.startsWith('/') ? path : `/${path}`;
	if (registry.current && version.id === registry.current.id) return clean;
	return `/${version.id}${clean}`;
}

// ---------------------------------------------------------------------------
// Ciclo de vida (§7, §17)
// ---------------------------------------------------------------------------

export interface VersionNotice {
	kind: 'deprecated' | 'archived' | 'draft';
	message: string;
	/** Para onde mandar o leitor, quando há sucessora. */
	href?: string;
	label?: string;
}

/**
 * O aviso que a versão merece, ou `null` quando não há o que avisar.
 *
 * A mensagem diz o que é verdade e o que fazer — não "atenção" genérico. Quem
 * chega numa versão obsoleta precisa saber que ela é obsoleta **e** para onde ir.
 */
export function noticeFor(
	version: DocVersion | null,
	registry: VersionRegistry,
	path = '/'
): VersionNotice | null {
	if (!version) return null;

	const successor = version.supersededBy
		? registry.versions.find((candidate) => candidate.id === version.supersededBy)
		: registry.current;

	const target =
		successor && successor.id !== version.id
			? { href: versionedPath(path, successor, registry), label: successor.label }
			: {};

	switch (version.status) {
		case 'deprecated':
			return {
				kind: 'deprecated',
				message: `A documentação da ${version.label} está obsoleta e não recebe mais correções.`,
				...target,
			};
		case 'archived':
			return {
				kind: 'archived',
				message: `A ${version.label} está arquivada. Ela permanece no ar para consulta histórica.`,
				...target,
			};
		case 'draft':
			return {
				kind: 'draft',
				message: `A ${version.label} é um rascunho: o conteúdo ainda muda e pode não corresponder ao produto.`,
			};
		default:
			return null;
	}
}

/** Para onde redirecionar, quando a versão pede (§17). */
export function redirectFor(
	version: DocVersion | null,
	registry: VersionRegistry,
	path = '/'
): string | null {
	if (!version?.redirect || !version.supersededBy) return null;

	const successor = registry.versions.find((candidate) => candidate.id === version.supersededBy);
	return successor ? versionedPath(path, successor, registry) : null;
}
