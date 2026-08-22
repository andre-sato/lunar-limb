---
type: Guide
title: Referência de API a partir de especificação
description: Páginas de referência geradas de OpenAPI e AsyncAPI, e por que o portal exige que a especificação se declare.
resource: https://docs.suaempresa.com/guides/referencia-de-api/
tags:
  - guia
  - api
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
    resource: src/content/docs/guides/referencia-de-api.mdx
    title: src/content/docs/guides/referencia-de-api.mdx no repositório
    last_modified: '2026-08-22T00:41:25.391Z'
audiences:
  - developer
  - product
owner:
  type: team
  id: documentation
---

O portal aceita dois formatos de especificação, e cada um tem um caminho próprio porque descrevem coisas diferentes:

| Formato | Como publicar | O que descreve |
| --- | --- | --- |
| **OpenAPI** | `src/schemas/<nome>.yaml` — o `starlight-openapi` gera as páginas no build | Rotas HTTP, verbos, códigos de status |
| **AsyncAPI** | `src/schemas/<nome>.asyncapi.yaml` + `npm run docs:asyncapi` | Canais, mensagens e payloads de sistema orientado a eventos |

Não há conversão entre os dois: um canal Kafka não é um endpoint REST. Misturá-los produziria documentação falsa.

O `astro.config.mjs` só registra o `starlight-openapi` para arquivos que **declaram** `openapi:` ou `swagger:` — filtrar pela extensão não basta. Um AsyncAPI passado ao plugin gera uma página com o título certo e nenhuma operação: falha silenciosa, pior que um erro.

`npm run docs:asyncapi -- --check` falha se a página gerada estiver desatualizada em relação à especificação — serve para CI e para pegar quem editou a página gerada à mão. O mesmo é verificado por teste.

Um exemplo real está no repositório: [`src/schemas/streetlights-kafka.asyncapi.yaml`](https://github.com/andre-sato/lunar-limb/blob/master/src/schemas/streetlights-kafka.asyncapi.yaml) gera [`api-reference/streetlights-kafka.md`](https://github.com/andre-sato/lunar-limb/blob/master/src/content/docs/api-reference/streetlights-kafka.md).
