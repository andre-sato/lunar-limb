---
title: Visão geral
description: Convenções comuns para consumir a API.
sidebar:
  order: 1
tags: [api]
---

Esta seção descreve o contrato técnico da API. Os caminhos e nomes apresentados são exemplos neutros para orientar a documentação de qualquer produto.

## URL base

```text
https://api.suaempresa.com/v1
```

Use HTTPS em todos os ambientes. O segmento de versão (`/v1`) permite evoluir a API sem interromper integrações existentes.

## Formato de dados

Envie e receba JSON com UTF-8. Inclua os cabeçalhos a seguir nas chamadas que enviam um corpo:

```http
Content-Type: application/json
Accept: application/json
```

## Estrutura de resposta

Recursos retornados pela API devem manter nomes de campos previsíveis e identificadores estáveis:

```json
{
  "id": "res_01HXYZ123",
  "status": "active",
  "created_at": "2026-08-12T12:00:00Z"
}
```

Leia sobre [autenticação](/api-reference/authentication/) e [erros](/api-reference/errors/) antes de documentar endpoints específicos.
