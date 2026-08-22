---
type: API Reference
title: Erros
description: Códigos HTTP e estrutura de erros retornados pela API.
resource: https://docs.suaempresa.com/api-reference/errors/
tags:
  - api
  - erros
status: stable
generated:
  by: process:okf-export
  at: '2026-08-22T12:12:38.074Z'
sources:
  - id: repo
    resource: src/content/docs/api-reference/errors.md
    title: src/content/docs/api-reference/errors.md no repositório
    last_modified: '2026-08-22T00:41:25.363Z'
owner:
  type: team
  id: documentation
translations:
  en: /en/api-reference/errors/
  es: /es/api-reference/errors/
---

Erros devem usar códigos HTTP padronizados e um corpo JSON que permita identificar e corrigir o problema.

```json
{
  "error": {
    "code": "invalid_request",
    "message": "O campo email deve conter um endereço válido.",
    "request_id": "req_01HXYZ123"
  }
}
```

| Status | Quando ocorre | Próxima ação |
| --- | --- | --- |
| `400` | A requisição é inválida. | Revise campos, formato e valores enviados. |
| `401` | A credencial não foi reconhecida. | Valide ou renove o token. |
| `403` | A credencial não tem a permissão necessária. | Solicite o escopo adequado. |
| `404` | O recurso não existe ou não está disponível. | Confirme o identificador e o ambiente. |
| `429` | O limite de chamadas foi atingido. | Aplique espera progressiva e tente novamente. |
| `500` | Ocorreu uma falha inesperada na plataforma. | Tente novamente e informe o `request_id` ao suporte. |

**note**
Nunca exponha detalhes internos, segredos ou dados pessoais em mensagens de erro. O `request_id` é a forma segura de correlacionar uma ocorrência com o suporte.
