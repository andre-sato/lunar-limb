---
type: API Reference
title: Experimente a API
description: Monte a chamada, envie e veja a resposta sem sair da página — os formulários vêm da própria especificação OpenAPI.
resource: https://docs.suaempresa.com/api-reference/explorer/
tags:
  - api
  - guia
status: stable
generated:
  by: process:okf-export
  at: '2026-08-22T12:12:38.074Z'
verified:
  - by: human:mestre
    at: '2026-08-18T00:00:00.000Z'
stale_after: '2026-11-16T00:00:00.000Z'
sources:
  - id: repo
    resource: src/content/docs/api-reference/explorer.mdx
    title: src/content/docs/api-reference/explorer.mdx no repositório
    last_modified: '2026-08-22T00:41:25.363Z'
owner:
  type: team
  id: documentation
---

Os formulários desta página não foram escritos à mão. Cada campo vem de
`src/schemas/portal-api.yaml`,
a mesma especificação que gera a referência — mudar a especificação muda os dois.

**A API é a do próprio portal**
Os endpoints abaixo existem e respondem: são os que a interface do portal usa.
Preferimos isso a inventar uma API de exemplo, que demonstraria a ferramenta e
mentiria sobre o produto.

Quase todos exigem sessão. Como o Explorer roda no mesmo domínio, o cookie
acompanha a chamada quando você está autenticado — não é preciso preencher
credencial nenhuma.

## Quem está autenticado

O caminho mais curto para ver a ferramenta funcionando. Autenticado, responde
`200` com o seu usuário; sem sessão, `401`.

## Buscar na documentação

O mesmo mecanismo do assistente da barra lateral, agora com o corpo da
requisição visível. Edite a pergunta e envie.

## Analisar um texto

Cole um Markdown no corpo e receba a nota, o veredito do quality gate e os
apontamentos com linha e coluna. É o linter do portal exposto como API.

## O que acontece por trás

A chamada não sai do seu navegador direto para a API: ela passa por um proxy do
portal, porque a maioria das APIs não aceita chamadas de outro domínio.

Esse proxy é estreito de propósito. Ele só alcança os servidores **declarados na
especificação**, que é um arquivo versionado no repositório: liberar um destino
novo exige editar o arquivo e passar por revisão, não mudar um parâmetro da
chamada. Endereços de rede interna são recusados mesmo que alguém os declare, e
um redirecionamento para outro host não é seguido.

## Sobre a sua credencial

Quando um endpoint pede credencial, ela fica **apenas nesta aba**: não é salva,
não entra no histórico de chamadas recentes e não aparece nos exemplos de
código, onde é substituída por um marcador. Recarregar a página a apaga.

Os exemplos de código são gerados a partir da mesma requisição que o botão
**Enviar** monta. Se os dois divergissem, o exemplo viraria uma armadilha:
funcionaria na tela e falharia no terminal de quem copiou.

## Chamando fora do portal

O Explorer monta a requisição para você, mas o contrato é o mesmo de qualquer
cliente. A busca conversacional, por exemplo:

```http
POST /api/chat/message
Content-Type: application/json
Cookie: portal_session=<sua-sessão>

{
  "message": "como autenticar na API"
}
```

A resposta traz o resumo, os trechos e as fontes:

```json
{
  "message": "A autenticação usa o cabeçalho Authorization.",
  "excerpts": [],
  "sources": [],
  "empty": false
}
```

Os códigos possíveis são `200`, `401` quando não há sessão e `429` no limite de
uso.
