---
type: Guide
title: Atualizações recentes
description: O componente que lista o que mudou, derivado do Git em vez de uma lista mantida à mão.
resource: https://docs.suaempresa.com/guides/atualizacoes-recentes/
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
    resource: src/content/docs/guides/atualizacoes-recentes.mdx
    title: src/content/docs/guides/atualizacoes-recentes.mdx no repositório
    last_modified: '2026-08-22T00:41:25.382Z'
audiences:
  - developer
  - product
owner:
  type: team
  id: documentation
---

[`/atualizacoes`](https://github.com/andre-sato/lunar-limb/blob/master/src/pages/atualizacoes.astro) lista as páginas alteradas nos
últimos 30 dias, da mais recente para a mais antiga, agrupadas por dia.

A data vem do **Git**, não do `mtime`: o `mtime` muda a cada clone ou `npm ci`,
e num servidor de CI todos os arquivos teriam a data de agora. Um clone raso
(`fetch-depth: 1`) não tem histórico — nesse caso a página cai para o sistema de
arquivos e **avisa na tela** que as datas não são as das alterações.

A sugestão de montar a estrutura a partir de um `index` por pasta não se aplica
aqui: só os diretórios de idioma têm um. O agrupamento usa a própria pasta, que
é de onde a Starlight já deriva as seções.
