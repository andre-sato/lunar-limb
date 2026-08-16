---
title: Aviso de rate limit
description: Limite padrão de requisições por minuto, reutilizado nas páginas de API.
---

> **Rate limit:** 600 requisições por minuto por credencial. Ao ultrapassar o limite, a API responde `429 Too Many Requests` com o cabeçalho `Retry-After` indicando quantos segundos esperar.
