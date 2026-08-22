---
type: Guide
title: Busca
description: Pagefind, Algolia DocSearch, a busca "warp drive" e o registro do portal como buscador no navegador.
resource: https://docs.suaempresa.com/guides/busca/
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
    resource: src/content/docs/guides/busca.mdx
    title: src/content/docs/guides/busca.mdx no repositório
    last_modified: '2026-08-22T00:41:25.383Z'
audiences:
  - developer
  - product
owner:
  type: team
  id: documentation
---

Dois provedores, escolhidos por ambiente:

| Provedor | Quando | Índice |
| --- | --- | --- |
| **Pagefind** (padrão) | sem credenciais do Algolia | gerado no build, sem serviço externo |
| **Algolia DocSearch** | com `ALGOLIA_APP_ID`, `ALGOLIA_SEARCH_API_KEY` e `ALGOLIA_INDEX_NAME` | hospedado no Algolia |

As credenciais são suas e ficam no ambiente, nunca no repositório. Use a chave
**Search-Only**: ela é pública por natureza, vai para o navegador e só lê o
índice. A chave de Admin escreve no índice e não deve aparecer no cliente.

É tudo ou nada: com uma variável faltando, o portal fica no Pagefind em vez de
carregar um widget que falharia na primeira busca.

Três detalhes que essa troca envolve:

- O `Search` é um override nosso, porque o assistente de documentação fica ao
  lado da busca. Por isso o `starlight-docsearch` avisa no build que não vai
  substituir o componente — é esperado, e a composição está em
  [Search.astro](https://github.com/andre-sato/lunar-limb/blob/master/src/components/Search.astro). Remover o override para calar o
  aviso tiraria o assistente do cabeçalho.
- O Pagefind continua sendo gerado mesmo com o Algolia ativo: a busca "warp"
  (`/warp?q=termo`) consulta aquele índice local.

O índice do Algolia precisa ser alimentado pelo crawler do DocSearch, que é
configurado na conta do Algolia — o portal só consulta.
