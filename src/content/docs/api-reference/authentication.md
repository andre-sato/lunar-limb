---
title: Autenticação
description: Envie credenciais de forma segura em todas as requisições.
sidebar:
  order: 2
---

Use o cabeçalho `Authorization` para enviar um token de acesso em chamadas à API.

```http
Authorization: Bearer SUA_CHAVE_DE_API
```

## Exemplo

```bash
curl https://api.suaempresa.com/v1/resources \
  --header "Authorization: Bearer SUA_CHAVE_DE_API" \
  --header "Accept: application/json"
```

## Boas práticas

- Armazene segredos em um cofre ou em variáveis de ambiente.
- Use tokens diferentes para desenvolvimento, homologação e produção.
- Limite permissões e faça rotação periódica das chaves.
- Revogue a credencial imediatamente se houver suspeita de exposição.

Uma credencial ausente, inválida ou sem permissão deve retornar `401` ou `403`. Veja todos os [códigos de erro](/api-reference/errors/).
