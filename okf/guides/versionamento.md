---
type: Guide
title: Versionamento da documentação
description: Versões da documentação, o seletor, o aviso de versão antiga e como uma versão é congelada.
resource: https://docs.suaempresa.com/guides/versionamento/
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
    resource: src/content/docs/guides/versionamento.mdx
    title: src/content/docs/guides/versionamento.mdx no repositório
    last_modified: '2026-08-22T00:41:25.398Z'
audiences:
  - developer
  - product
owner:
  type: team
  id: documentation
---

`versions.yml` é o registro: quais versões existem, em que estado cada uma está
e de que branch ou tag cada uma vem.

```yaml
versions:
  - id: v2
    label: Versão 2
    status: current
    branch: master
  - id: v1
    label: Versão 1
    status: deprecated
    branch: docs/v1
    supersededBy: v2
```

O ciclo de vida vai de `draft` a `archived`, passando por `current`,
`maintained` e `deprecated`. Só pode haver **uma** versão `current` — duas
versões "atuais" é uma pergunta sem resposta para quem chega. `draft` e
`archived` ficam fora do seletor sem sair do registro.

Um registro inválido **derruba o build**, de propósito: id que não serve para
URL, duas versões atuais, sucessora inexistente, branch e tag na mesma versão.
Um seletor que leva a 404 é pior que um build vermelho.

A versão `current` é a raiz do site e não recebe prefixo — `/guides/auth/` é
sempre a atual, e `/v1/guides/auth/` é a antiga. A URL curta é a que se
compartilha, e ela deve continuar apontando para o que vale hoje.

Uma versão `deprecated`, `archived` ou `draft` mostra um aviso no topo da
página, com link para a sucessora quando existe.

### O que está feito e o que não está

Feito: o registro com validação e ciclo de vida, a resolução de versão a partir
da URL, o aviso de versão obsoleta, o redirecionamento opcional, e o
`starlight-versions` alimentado pelo registro em vez de um segundo arquivo.

**Não feito**, e a spec pede: Content Graph, glossário, linter, API Reference,
assistente e MCP ainda não recebem a versão — eles operam sobre o conteúdo atual.
Também não existem a comparação entre versões nem a interface de criação. O
snapshot de conteúdo por versão é do `starlight-versions` e depende do comando
dele; o registro já está pronto para alimentá-lo.
