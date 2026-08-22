---
type: Guide
title: Navegação
description: Sidebar, breadcrumbs, paginação, índice da página, tags e as decisões que mantêm a navegação previsível.
resource: https://docs.suaempresa.com/guides/navegacao/
tags:
  - guia
  - portal
status: stable
generated:
  by: process:okf-export
  at: '2026-08-22T12:12:38.074Z'
verified:
  - by: human:mestre
    at: '2026-08-19T00:00:00.000Z'
stale_after: '2027-02-15T00:00:00.000Z'
sources:
  - id: repo
    resource: src/content/docs/guides/navegacao.mdx
    title: src/content/docs/guides/navegacao.mdx no repositório
    last_modified: '2026-08-22T00:41:25.391Z'
audiences:
  - developer
  - product
owner:
  type: team
  id: documentation
---

O menu fica no topo, não numa coluna lateral, e é montado a partir da mesma
árvore que a Starlight gera das pastas de conteúdo: cada pasta de primeiro nível
vira um item, e as páginas de dentro formam o submenu. Nenhum item é escrito à
mão — criar uma página basta para ela aparecer.

A barra lateral continua existindo, mostrando **só a seção aberta** — o arranjo
do portal da OpenAI usado como referência. O topo diz onde você pode ir; a
lateral, onde você está. Mostrar a árvore inteira nos dois lugares repetiria a
mesma informação e gastaria a altura da tela com seções que não estão sendo
lidas.

O estreitamento acontece em [route-middleware.ts](https://github.com/andre-sato/lunar-limb/blob/master/src/lib/nav/route-middleware.ts),
pelo ponto de extensão que a Starlight documenta para modificar dados de rota. A
árvore completa é guardada em `locals.topNav` antes do corte: o cabeçalho precisa
dela inteira, a lateral só do galho atual. Páginas fora de qualquer seção — a
capa — não têm lateral, e aí `hasSidebar` é desligado de fato, o que é diferente
de esconder com CSS: a coluna deixa de ser reservada.

Dois efeitos que vieram junto e precisaram de decisão:

- **Profundidade.** A lateral aninhava sem limite; um menu suspenso dentro de
  outro é difícil de operar com mouse e pior com teclado. A árvore é achatada em
  dois níveis, e o subgrupo vira um título dentro do painel. A lógica está em
  [top-nav.ts](https://github.com/andre-sato/lunar-limb/blob/master/src/lib/nav/top-nav.ts), separada do componente para ser testável.
- **Medida de leitura.** Sem barra lateral, a Starlight aplica a medida larga que
  reserva para páginas de capa — 1080px de linha na documentação. O CSS do
  projeto devolve a medida normal às páginas sem hero.

O menu funciona sem JavaScript: cada submenu é um `<details>`. O script só
acrescenta o que o HTML não dá — fechar ao clicar fora, fechar com `Esc`
devolvendo o foco, e manter um submenu aberto por vez.
