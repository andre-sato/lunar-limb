---
type: Guide
title: API Explorer
description: O console de requisições embutido, derivado da mesma especificação OpenAPI que move o resto do portal.
resource: https://docs.suaempresa.com/guides/api-explorer/
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
    resource: src/content/docs/guides/api-explorer.mdx
    title: src/content/docs/guides/api-explorer.mdx no repositório
    last_modified: '2026-08-22T00:41:25.381Z'
audiences:
  - developer
  - product
owner:
  type: team
  id: documentation
---

A referência de API deixou de ser só leitura: em [`/api-reference/explorer/`](https://github.com/andre-sato/lunar-limb/blob/master/src/content/docs/api-reference/explorer.mdx)
dá para preencher parâmetros, enviar a chamada e ver a resposta.

Os formulários vêm da especificação OpenAPI em `src/schemas/`. Nenhum campo é
escrito à mão — trocar a especificação muda o Explorer e a referência juntos.

| Arquivo | Papel |
| --- | --- |
| `src/lib/api-explorer/model.ts` | Lê o OpenAPI e produz as operações |
| `src/lib/api-explorer/request.ts` | Monta o pedido a partir do formulário |
| `src/lib/api-explorer/snippets.ts` | Gera cURL, JavaScript, Python e Go |
| `src/lib/api-explorer/proxy-policy.ts` | Decide o que o proxy pode buscar |
| `src/pages/api/explorer/request.ts` | O proxy |

### O proxy é a parte que precisa de cuidado

O "Try it" precisa de um proxy porque a maioria das APIs não aceita chamadas de
outro domínio. E um proxy que aceita qualquer URL **é** um SSRF: o servidor do
portal viraria intermediário para tudo que ele alcança, rede interna inclusive.

A regra é a mais estreita que ainda serve: **só os servidores declarados na
especificação**, que é arquivo versionado. Liberar um destino novo exige editar
o arquivo e passar por revisão, não mudar um parâmetro. Além disso: esquema
diferente de HTTP é recusado, credencial embutida na URL é recusada, endereço de
rede interna é recusado mesmo se declarado, e redirecionamento não é seguido.

### Credenciais

Ficam apenas no estado do componente: não vão para `localStorage`, não entram no
histórico de chamadas e não aparecem nos exemplos de código, onde um marcador as
substitui. O log do proxy redige cabeçalhos de credencial pelo nome.

Os exemplos são gerados a partir da **mesma** função que monta o envio. Se
divergissem, o exemplo copiado falharia no terminal depois de funcionar na tela.

### A API de demonstração é real

`src/schemas/portal-api.yaml` descreve endpoints do próprio portal — os que a
interface usa. Uma especificação de exemplo com endpoints inventados
demonstraria a ferramenta e mentiria sobre o produto.
