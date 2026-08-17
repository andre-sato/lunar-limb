---
title: Authentication
description: How the API authenticates requests
---

A autenticação da API usa OAuth 2.0.

## OAuth Flow

O fluxo com PKCE tem quatro passos:

1. O cliente pede um authorization code.
2. A pessoa se autentica.
3. O cliente troca o code por um access token.
4. O token vai no header Authorization.

```typescript
const token = await authenticate();
client.setToken(token);
```

## Expiração

O access token expira em 3600 segundos.
