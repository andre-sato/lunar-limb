/**
 * Converte a árvore da sidebar em itens de um menu horizontal.
 *
 * A navegação continua vindo das pastas de conteúdo (`autogenerate`): este
 * módulo só muda a **forma**. Um grupo vira um item com submenu; um link solto
 * vira um item simples.
 *
 * Duas decisões que a forma horizontal impõe, e que a lateral não tinha:
 *
 * **Profundidade.** A lateral podia aninhar sem limite, empilhando na vertical.
 * Um menu suspenso com submenus dentro de submenus é difícil de operar com
 * mouse e pior ainda com teclado. Aqui a árvore é achatada em dois níveis: o
 * subgrupo vira um título dentro do painel, e os links dele sobem para a lista.
 *
 * **Item atual.** Na lateral, a página aberta ficava destacada onde estivesse.
 * No topo, o destaque precisa subir até o item de primeiro nível — é ele que
 * está visível.
 */

/** Formato mínimo do que a Starlight entrega em `starlightRoute.sidebar`. */
export interface SidebarLink {
	type: 'link';
	label: string;
	href: string;
	isCurrent: boolean;
	badge?: { text: string; variant?: string } | undefined;
}

export interface SidebarGroup {
	type: 'group';
	label: string;
	entries: SidebarEntry[];
	badge?: { text: string; variant?: string } | undefined;
}

export type SidebarEntry = SidebarLink | SidebarGroup;

export interface NavLink {
	label: string;
	href: string;
	isCurrent: boolean;
	/** Título do subgrupo de onde o link veio, quando havia um. */
	group?: string;
	badge?: string;
}

export interface NavItem {
	label: string;
	/** Presente quando o item é um link direto, sem submenu. */
	href?: string;
	/** Links do submenu, já achatados em um nível. */
	links: NavLink[];
	/** `true` quando a página aberta é este item ou está dentro dele. */
	isCurrent: boolean;
}

function isGroup(entry: SidebarEntry): entry is SidebarGroup {
	return entry.type === 'group';
}

/**
 * Achata um grupo em uma lista de links, guardando de qual subgrupo cada um
 * veio para o painel poder mostrar os títulos.
 */
function flatten(entries: readonly SidebarEntry[], group?: string): NavLink[] {
	const links: NavLink[] = [];

	for (const entry of entries) {
		if (isGroup(entry)) {
			// O rótulo do subgrupo mais interno é o que informa: um caminho
			// inteiro ("Guias › Avançado › Webhooks") não cabe num menu.
			links.push(...flatten(entry.entries, entry.label));
			continue;
		}

		links.push({
			label: entry.label,
			href: entry.href,
			isCurrent: entry.isCurrent,
			group,
			badge: entry.badge?.text,
		});
	}

	return links;
}

export function buildTopNav(sidebar: readonly SidebarEntry[]): NavItem[] {
	const items: NavItem[] = [];

	for (const entry of sidebar) {
		if (!isGroup(entry)) {
			items.push({
				label: entry.label,
				href: entry.href,
				links: [],
				isCurrent: entry.isCurrent,
			});
			continue;
		}

		const links = flatten(entry.entries);
		// Grupo vazio não vira botão: abriria um painel sem nada dentro.
		if (links.length === 0) continue;

		items.push({
			label: entry.label,
			links,
			isCurrent: links.some((link) => link.isCurrent),
		});
	}

	return items;
}

/**
 * Agrupa os links de um item pelos títulos de subgrupo, preservando a ordem em
 * que apareceram. Links sem subgrupo formam o primeiro bloco, sem título.
 */
export function sectionsOf(item: NavItem): { title?: string; links: NavLink[] }[] {
	const sections: { title?: string; links: NavLink[] }[] = [];

	for (const link of item.links) {
		const last = sections[sections.length - 1];
		if (last && last.title === link.group) {
			last.links.push(link);
			continue;
		}
		sections.push({ title: link.group, links: [link] });
	}

	return sections;
}

/**
 * O grupo de primeiro nível que contém a página aberta.
 *
 * É o que a barra lateral passa a mostrar: com o menu no topo cuidando das
 * seções, a coluna da esquerda serve para navegar **dentro** da seção atual.
 * Mostrar a árvore inteira nos dois lugares seria repetir a mesma informação e
 * gastar a altura da tela com seções que o leitor não está lendo.
 *
 * Devolve `null` quando a página não pertence a nenhum grupo — a capa, uma
 * página solta na raiz. Aí não há seção para navegar, e a coluna não aparece.
 */
export function currentGroupOf(sidebar: readonly SidebarEntry[]): SidebarGroup | null {
	for (const entry of sidebar) {
		if (!isGroup(entry)) continue;
		if (containsCurrent(entry.entries)) return entry;
	}
	return null;
}

function containsCurrent(entries: readonly SidebarEntry[]): boolean {
	return entries.some((entry) =>
		isGroup(entry) ? containsCurrent(entry.entries) : entry.isCurrent
	);
}
