---
title: Erros
description: Códigos HTTP e estrutura de erros retornados pela API.
sidebar:
  order: 3
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

:::note
Nunca exponha detalhes internos, segredos ou dados pessoais em mensagens de erro. O `request_id` é a forma segura de correlacionar uma ocorrência com o suporte.
:::
