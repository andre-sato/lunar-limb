/**
 * Divide a navegação entre o topo e a lateral.
 *
 * O menu do topo lista as **seções** do portal; a barra lateral lista as páginas
 * **da seção aberta**. É o arranjo do portal da OpenAI usado como referência, e
 * evita a repetição de mostrar a árvore inteira duas vezes na mesma tela.
 *
 * Este é o ponto de extensão que a Starlight documenta para alterar dados de
 * rota, e ele roda antes da renderização — por isso dá para mexer em
 * `hasSidebar`, que decide se a coluna existe no layout. Fazer o mesmo com CSS
 * deixaria a coluna reservada e vazia.
 *
 * A árvore completa é guardada em `locals.topNav` **antes** do estreitamento: o
 * cabeçalho precisa dela inteira, e a lateral, só do galho atual.
 */

import { defineRouteMiddleware } from '@astrojs/starlight/route-data';
import { buildTopNav, currentGroupOf, type SidebarEntry } from './top-nav';

export const onRequest = defineRouteMiddleware((context) => {
	const route = context.locals.starlightRoute;
	if (!route) return;

	const fullSidebar = route.sidebar as SidebarEntry[];
	context.locals.topNav = buildTopNav(fullSidebar);

	// Página de capa não tem seção para navegar, e a coluna só ocuparia espaço.
	if (route.entry.data.template === 'splash') {
		route.hasSidebar = false;
		return;
	}

	const group = currentGroupOf(fullSidebar);
	if (!group) {
		route.hasSidebar = false;
		return;
	}

	// O grupo inteiro, e não só os seus filhos: assim a lateral mostra o nome da
	// seção no topo, e o leitor sabe onde está sem precisar olhar o menu.
	route.sidebar = [group] as typeof route.sidebar;
	route.hasSidebar = true;
});
