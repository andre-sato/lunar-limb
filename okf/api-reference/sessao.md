---
type: API Reference
title: Sessão
description: Como abrir e encerrar uma sessão no portal, o que o cookie carrega e por que não existe token de portador.
resource: https://docs.suaempresa.com/api-reference/sessao/
tags:
  - api
  - seguranca
  - autenticacao
status: stable
generated:
  by: process:okf-export
  at: '2026-08-22T12:12:38.074Z'
verified:
  - by: human:mestre
    at: '2026-08-19T00:00:00.000Z'
stale_after: '2026-11-17T00:00:00.000Z'
sources:
  - id: repo
    resource: src/content/docs/api-reference/sessao.md
    title: src/content/docs/api-reference/sessao.md no repositório
    last_modified: '2026-08-22T00:41:25.364Z'
audiences:
  - developer
  - support
owner:
  type: team
  id: platform
---

<!-- provenance:
source: src/pages/api/auth/login.ts
source: src/pages/api/auth/logout.ts
verified: 2026-08-19
by: mestre
-->

O portal autentica por **cookie de sessão**, não por token de portador. A escolha tem uma consequência prática que vale saber antes de escrever qualquer código: o navegador envia a credencial sozinho, e um SDK rodando fora do navegador precisa guardar o cookie por conta própria.

## Abrir a sessão

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "mestre@lunar-limb.local",
  "password": "sua-senha"
}
```

Resposta de sucesso:

```json
{
  "user": {
    "id": "usr_1",
    "email": "mestre@lunar-limb.local",
    "role": "admin"
  },
  "mustChangePassword": false
}
```

O cookie `portal_session` vem no cabeçalho `Set-Cookie`, marcado `HttpOnly` e `SameSite=Lax`. **Ele não é legível por JavaScript**, e isso é deliberado: um token que a página consegue ler é um token que um script injetado consegue exfiltrar.

### `mustChangePassword`

Senha gerada pelo portal — no primeiro acesso ou por `npm run user:create` — entra marcada como provisória. O login devolve `mustChangePassword: true`, e a troca acontece em Settings → Users.

O portal **não** bloqueia a navegação até que ela aconteça. O aviso é informativo, e o motivo é que travar a navegação de alguém que acabou de receber acesso costuma terminar numa senha anotada em outro lugar.

### Códigos

| Código | Quando |
| --- | --- |
| `200` | Sessão criada. |
| `400` | Corpo sem `email` ou sem `password`. |
| `401` | Credencial inválida, **ou** usuário inativo. |
| `429` | Tentativas demais a partir do mesmo endereço. |

O `401` não distingue "e-mail não existe" de "senha errada". A distinção seria conveniente para quem digitou errado e útil demais para quem está testando uma lista de e-mails.

## Encerrar a sessão

```http
POST /api/auth/logout
```

Não há corpo. A resposta é `204`, e o cookie volta expirado.

O encerramento invalida a sessão **no servidor**, e não apenas no navegador: apagar o cookie do lado do cliente deixaria o token válido para quem já o tivesse copiado.

## O que fica registrado

Toda abertura e todo encerramento entram na trilha de auditoria como `SESSION_STARTED` e `SESSION_ENDED`, com o identificador do usuário e o instante. Tentativa recusada entra como `SESSION_DENIED`.

O log guarda **o tipo do evento e quem o causou** — nunca a senha tentada, nunca o endereço de origem.

## Fora do navegador

O API Explorer roda no mesmo domínio, então o cookie acompanha a chamada quando você já está autenticado. Um cliente fora do navegador precisa guardar o `Set-Cookie` e reenviá-lo:

```bash
curl -c cookies.txt -X POST https://portal.exemplo.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"pessoa@empresa.com","password":"..."}'

curl -b cookies.txt https://portal.exemplo.com/api/auth/me
```

O [SDK gerado](/guides/sdk.md) ainda não cobre este fluxo: a especificação OpenAPI descreve o esquema `sessionCookie` como `apiKey in: cookie`, e o SDK deliberadamente não envia credencial por cookie — forjá-lo quebraria a sessão de quem já está autenticado no navegador. É uma limitação declarada, não um esquecimento.
