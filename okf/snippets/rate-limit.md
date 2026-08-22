---
type: Content Snippet
title: Aviso de rate limit
description: Limite padrão de requisições por minuto, reutilizado nas páginas de API.
status: stable
generated:
  by: process:okf-export
  at: '2026-08-22T12:12:38.074Z'
sources:
  - id: repo
    resource: src/content/snippets/rate-limit.md
    title: src/content/snippets/rate-limit.md no repositório
    last_modified: '2026-08-22T00:41:25.405Z'
owner:
  type: team
  id: documentation
---

> **Rate limit:** 600 requisições por minuto por credencial. Ao ultrapassar o limite, a API responde `429 Too Many Requests` com o cabeçalho `Retry-After` indicando quantos segundos esperar.
