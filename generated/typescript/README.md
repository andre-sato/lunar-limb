# @lunar-limb/api-client

Cliente TypeScript de **API do portal**, gerado a partir da especificação OpenAPI.

| | |
| --- | --- |
| Versão do SDK | `1.0.0` |
| Versão da API | `1.0.0` |
| Recursos | 4 |
| Modelos | 12 |

> Gerado automaticamente. Alterações feitas à mão são perdidas na próxima geração —
> mude a especificação OpenAPI.

## Instalação

```bash
npm install @lunar-limb/api-client
```

## Configuração

```ts
import { ApiClient } from '@lunar-limb/api-client';

const client = new ApiClient({
  baseUrl: "/api",
  timeoutMs: 30_000,
});
```

## Autenticação

```ts
const client = new ApiClient({ apiKey: process.env.API_KEY });
```

Credenciais vêm do ambiente e nunca são gravadas no código gerado.

## Quickstart

```ts
await client.autenticacao.getCurrentUser();
```

## Recursos

### `client.autenticacao`

- `getCurrentUser()` — `GET /auth/me`

### `client.documentacao`

- `searchDocumentation()` — `POST /chat/message`
- `sendFeedback()` — `POST /feedback`

### `client.qualidade`

- `lintContent()` — `POST /editor/lint`

### `client.workflow`

- `listBranches()` — `GET /editor/git/branches`

## Erros

Toda falha vira uma subclasse de `ApiError`, com `statusCode` e `response` preservados:

```ts
import { NotFoundError } from '@lunar-limb/api-client';

try {
  await client.users.get({ id: "123" });
} catch (error) {
  if (error instanceof NotFoundError) { /* … */ }
}
```

## O que este SDK não cobre

A especificação não permitiu representar tudo. O gerador registra o que ficou de fora
em vez de gerar código que parece completo e falha em produção:

- 1 operação(ões) não declaram schema de resposta 2xx; o método devolve `unknown` em vez de um tipo inventado.
