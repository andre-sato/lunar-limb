---
type: Guide
title: Comece por aqui
description: Faça a primeira chamada à API em poucos minutos.
resource: https://docs.suaempresa.com/guides/getting-started/
tags:
  - guia
  - api
  - autenticacao
status: stable
generated:
  by: process:okf-export
  at: '2026-08-22T12:12:38.074Z'
sources:
  - id: repo
    resource: src/content/docs/guides/getting-started.md
    title: src/content/docs/guides/getting-started.md no repositório
    last_modified: '2026-08-22T00:41:25.387Z'
owner:
  type: team
  id: documentation
translations:
  en: /en/guides/getting-started/
  es: /es/guides/getting-started/
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

Uma resposta bem-sucedida retorna um status `200` e um corpo JSON. Consulte a [referência de API](/api-reference/overview.md) para convenções, autenticação e erros.

## Próximos passos

- [Personalize o portal](/guides/configure-your-portal.md) com a identidade da sua empresa.
- [Publique documentação](/guides/publish-documentation.md) para novos recursos e versões.
