# MCP Tools

As quatro ferramentas da primeira versão. Todas são **somente leitura** (§18).

## search_docs

Busca trechos relevantes, combinando busca lexical e semântica.

```json
{ "query": "Como funciona OAuth?", "limit": 5, "source": "api-reference" }
```

Campos opcionais: `limit` (1–20, padrão 5), `source` (prefixo de caminho),
`repository`, `language` (`pt-BR`, `en`, `es`), `content_type`
(`documentation`, `code`, `table`).

```json
{
  "results": [
    {
      "title": "Authentication",
      "path": "api-reference/authentication.md",
      "section": "OAuth Flow",
      "content": "Document: Authentication…",
      "score": 0.94,
      "url": "/api-reference/authentication/#oauth-flow",
      "matched_by": "hybrid",
      "used_by": []
    }
  ],
  "injection_detected": false,
  "request_id": "a1b2c3d4e5f6"
}
```

`matched_by` diz se o resultado veio do lexical, do vetorial ou de ambos — é o
que torna o `doc search` útil para depurar o retrieval.

`used_by` só é preenchido para conteúdo reutilizável: um bloco não tem página
própria, então quem deve ser citado são as páginas que o consomem.

`score` é normalizado pelo melhor resultado da própria consulta, então o primeiro
colocado vale sempre 1.0. É proposital: o valor absoluto do BM25 não tem escala
comparável entre consultas.

## get_document

Conteúdo completo de um documento. Use quando o trecho de `search_docs` não tiver
contexto suficiente.

```json
{ "path": "api-reference/authentication.md" }
```

```json
{
  "path": "api-reference/authentication.md",
  "title": "Authentication",
  "content": "…",
  "metadata": {
    "repository": "default",
    "language": "pt-BR",
    "kind": "page",
    "url": "/api-reference/authentication/",
    "updated_at": "2026-08-17T10:00:00+00:00",
    "content_hash": "9f2c…",
    "used_by": []
  },
  "injection_detected": false
}
```

Caminho absoluto, `..` ou byte nulo são recusados. Além disso, só documentos
presentes no índice são entregues — a segunda barreira não depende da primeira.

## list_documents

```json
{ "prefix": "api-reference" }
```

```json
{ "documents": ["api-reference/authentication.md", "api-reference/errors.md"] }
```

Prefixo vazio lista tudo.

## find_references

Documentos relacionados, em três direções:

```json
{ "path": "api-reference/overview.md" }
```

```json
{
  "references": [
    { "path": "rate-limit.md", "type": "includes" },
    { "path": "api-reference/payments.md", "type": "related" }
  ]
}
```

| Tipo | Significado |
| --- | --- |
| `includes` | Blocos de conteúdo reutilizável que esta página inclui. |
| `included_by` | Páginas que incluem este bloco (quando o caminho é um bloco). |
| `related` | Páginas que compartilham um mesmo bloco com esta. |

`related` aqui tem significado estrutural, não estatístico: duas páginas são
relacionadas porque reutilizam o mesmo conteúdo canônico, e não porque um modelo
achou os textos parecidos.

## Erros

Uma tool que falha de forma prevista devolve `{"error": "…", "request_id": "…"}`
em vez de derrubar a sessão:

- índice ausente, vazio ou em formato antigo — a mensagem traz o comando a rodar;
- documento inexistente;
- argumentos inválidos.

## Futuras

`get_section`, `search_code_examples`, `search_adrs`, `search_api`,
`find_dependents`, `get_changelog`.

Ferramentas de escrita (`create_documentation_draft`, `create_issue`,
`create_pull_request`) ficam para uma fase separada, e devem viver em um servidor
distinto ou atrás de uma capacidade explícita — nunca misturadas às de leitura.
