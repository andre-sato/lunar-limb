---
title: Autenticação
description: Envie credenciais de forma segura em todas as requisições.
sidebar:
  order: 2
tags: [api, seguranca, autenticacao]
owner: Time de Plataforma
audiences: [developer, support]
---

<!-- provenance:
source: portal-api.yaml#/components/securitySchemes
verifiedAt: 2026-08-18
verifiedBy: Time de Plataforma
-->

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

:::audience{type="developer"}
O cabeçalho vale para toda requisição autenticada, inclusive as de leitura. Chaves
não expiram sozinhas: a rotação é feita pelo portal, e a chave antiga continua
válida até ser revogada explicitamente.
:::

:::audience{type="support"}
Se a pessoa relatar erro **401**, confira nesta ordem: se o cabeçalho
`Authorization` está presente, se a chave foi revogada, e se ela pertence ao
ambiente que a pessoa está chamando. Chave de teste em produção devolve 401, e é
a causa mais comum.
:::
