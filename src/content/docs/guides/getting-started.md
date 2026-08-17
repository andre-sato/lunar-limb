---
title: Comece por aqui
description: Faça a primeira chamada à API em poucos minutos.
sidebar:
  order: 1
---

Este guia apresenta o fluxo mínimo de integração. Os exemplos usam valores de demonstração para que o portal possa ser adaptado a qualquer produto.

## 1. Crie uma credencial

No ambiente da sua empresa, crie uma chave de API ou um token de acesso com as permissões necessárias. Não exponha essa credencial em aplicações executadas no navegador.

## 2. Defina a URL base

A URL padrão do template está em `src/config/portal.ts`:

```ts title="src/config/portal.ts"
apiBaseUrl: 'https://api.suaempresa.com/v1'
```

Substitua-a pelo endereço da sua API antes de publicar a documentação.

## 3. Faça uma requisição autenticada

```bash
curl https://api.suaempresa.com/v1/resources \
  --header "Authorization: Bearer SUA_CHAVE_DE_API" \
  --header "Accept: application/json"
```

Uma resposta bem-sucedida retorna um status `200` e um corpo JSON. Consulte a [referência de API](/api-reference/overview/) para convenções, autenticação e erros.

## Próximos passos

- [Personalize o portal](/guides/configure-your-portal/) com a identidade da sua empresa.
- [Publique documentação](/guides/publish-documentation/) para novos recursos e versões.
