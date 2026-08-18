/**
 * Desliga a barra lateral: a navegação passou para o topo.
 *
 * `hasSidebar` é o que faz a Starlight reservar a coluna da esquerda, marcar o
 * `<html>` com `data-has-sidebar` e renderizar o painel. Desligá-lo aqui — no
 * middleware de rota, que é o ponto de extensão documentado para modificar os
 * dados da rota — é diferente de escondê-lo com CSS: a coluna deixa de existir,
 * e o conteúdo ocupa a largura toda sem correção de layout por cima.
 *
 * O `sidebar` continua na rota. Ele é a fonte da navegação do topo — a mesma
 * estrutura derivada das pastas de conteúdo, agora desenhada de outro jeito.
 * Nenhum item de navegação passa a ser escrito à mão.
 */

import { defineRouteMiddleware } from '@astrojs/starlight/route-data';

export const onRequest = defineRouteMiddleware((context) => {
	const route = context.locals.starlightRoute;
	if (!route) return;

	route.hasSidebar = false;
});
