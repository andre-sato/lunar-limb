---
title: Branches do repositório
description: O endpoint que lista as branches locais para o editor, e por que ele nunca escreve no repositório.
sidebar:
  order: 5
tags: [api, editor, portal]
owner: Time de Plataforma
audiences: [developer]
documentation:
  bindings:
    - type: api
      id: GET /api/editor/git/branches
governance:
  owner:
    type: team
    id: platform
  reviewer:
    type: team
    id: documentation
  review:
    interval: 90d
    at: 2026-08-19
    by: mestre
---

<!-- provenance:
source: portal-api.yaml#/paths/~1editor~1git~1branches/get
verified: 2026-08-19
by: mestre
-->

Lista as branches locais do repositório, indicando a atual e a padrão. É o que preenche o seletor de branch na barra de status do [editor](/guides/editor/).

Exige sessão e a permissão `editor.access`.

## Requisição

```http
GET /api/editor/git/branches
Cookie: portal_session=<sua-sessão>
```

## Resposta

```json
{
  "current": "master",
  "defaultBranch": "main",
  "branches": [
    { "name": "master", "ahead": 1, "behind": 0 },
    { "name": "main", "ahead": 0, "behind": 0 }
  ]
}
```

| Campo | Descrição |
| --- | --- |
| `current` | Branch em que o repositório está agora. |
| `defaultBranch` | Branch padrão, detectada do remoto quando existe. |
| `branches[].ahead` | Commits à frente do remoto. |
| `branches[].behind` | Commits atrás do remoto. |

`ahead` e `behind` vêm como `0` quando não há remoto configurado — é o caso de um clone local, e não uma branch sincronizada.

## Só leitura

Este endpoint **não** cria, troca nem apaga branch. Ele responde uma pergunta.

As operações que escrevem no repositório vivem em rotas próprias, cada uma com o seu registro de auditoria: `BRANCH_CREATED`, `BRANCH_SWITCHED`, `BRANCH_RENAMED`, `BRANCH_DELETED`. Trocar de branch muda o que o editor inteiro mostra para todo mundo que estiver com ele aberto — não é o tipo de coisa que deve acontecer como efeito colateral de uma listagem.

## Códigos

| Código | Quando |
| --- | --- |
| `200` | Lista devolvida. |
| `401` | Sem sessão. |
| `403` | Sem a permissão `editor.access`. |
| `503` | O diretório não é um repositório Git. |

O `503` é deliberado: um portal rodando fora de um repositório não está com defeito, ele só não tem o que listar. Devolver uma lista vazia faria parecer que o repositório existe e não tem branches.

## Como o editor usa

O [workflow de Git](/guides/workflow-de-git/) parte daqui: a barra de status mostra a branch atual e o estado do arquivo aberto, e o botão de preparar pull request compara a branch atual com a padrão que este endpoint informou.
