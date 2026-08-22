---
type: Guide
title: Consulta pelo terminal (MCP)
description: O servidor MCP e a CLI que expõem a documentação para agentes e para o terminal.
resource: https://docs.suaempresa.com/guides/mcp/
tags:
  - guia
  - ia
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
    resource: src/content/docs/guides/mcp.mdx
    title: src/content/docs/guides/mcp.mdx no repositório
    last_modified: '2026-08-22T00:41:25.391Z'
audiences:
  - developer
  - product
owner:
  type: team
  id: documentation
---

O diretório [mcp-docs/](mcp-docs/) traz um **Documentation MCP Server** e uma CLI que consultam esta mesma documentação a partir do terminal:

```bash
doc ask "Como funciona o rate limit?"
```

A separação importa: o servidor MCP expõe as ferramentas (`search_docs`, `get_document`, `list_documents`, `find_references`) pelo Model Context Protocol, e a CLI é apenas **um** cliente entre outros — uma IDE ou um agente de IA consomem o mesmo servidor, com o mesmo comportamento e as mesmas validações. O Markdown continua sendo a fonte de verdade: o indexador lê `src/content/docs` e `src/content/snippets`, entende os blocos reutilizáveis e sabe quais páginas consomem cada bloco, então a citação aponta uma página que o leitor pode abrir.

É somente leitura, e funciona sem chave de API (busca lexical e resposta composta dos trechos encontrados). Instalação, configuração e arquitetura em [mcp-docs/README.md](mcp-docs/README.md).
