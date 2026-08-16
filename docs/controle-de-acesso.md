# Controle de acesso

Autenticação, autorização e administração de usuários do portal.

A regra que organiza tudo:

> **A UI controla a experiência; o backend controla a segurança.**
> Esconder um botão nunca é autorização.

---

## 1. Autenticação × autorização

São camadas separadas, em arquivos separados:

| Pergunta | Camada | Onde |
| --- | --- | --- |
| Quem é o usuário? | Autenticação | `lib/auth/sessions.ts`, `lib/auth/users.ts` |
| O que ele pode fazer? | Autorização | `lib/auth/permissions.ts`, `lib/auth/guard.ts` |
| Isto está sendo aplicado? | Enforcement | `src/middleware.ts` |

A autenticação é local (e-mail + senha), mas isolada atrás de
`verifyCredentials` e `resolveSession`. Trocar por um provedor externo (OIDC,
SAML) significa reimplementar esses dois pontos — a autorização não muda.

---

## 2. Capacidades, não papéis

O código nunca pergunta pelo nome do grupo:

```ts
// não
if (user.role === 'admin') { … }

// sim
if (can(user, 'users.update')) { … }
```

`ROLE_PERMISSIONS` em `lib/auth/permissions.ts` é a única fonte dessa resposta,
consultada pela UI, pelo middleware e pelos serviços. Criar um papel novo
("Technical Writer", "Support") é acrescentar uma linha nessa tabela — nenhum
mecanismo muda.

Papéis iniciais:

| | viewer | editor | admin |
| --- | :-: | :-: | :-: |
| `docs.read` | ✓ | ✓ | ✓ |
| `docs.create` / `update` / `delete` | | ✓ | ✓ |
| `editor.access` | | ✓ | ✓ |
| `users.read` / `create` / `update` / `delete` | | | ✓ |
| `permissions.manage` | | | ✓ |
| `settings.access` / `audit.read` | | | ✓ |

Um usuário **inativo** não tem capacidade nenhuma, qualquer que seja o papel:
`can()` verifica o status antes da tabela.

---

## 3. O ponto único de enforcement

Todo request sob demanda passa por `src/middleware.ts`, que consulta
`authorize(user, pathname, method)`. Nenhuma página ou endpoint precisa lembrar
de se proteger.

```text
Request
  ↓
resolveSession(cookie) → locals.user      (autenticação)
  ↓
authorize(user, path, method)             (autorização)
  ↓
allow  → next()
authenticate → 401 (API) | /login?next=…  (páginas)
forbid → 403 (API) | rewrite('/403')      (páginas)
```

A distinção entre `authenticate` e `forbid` é proposital: quem nunca entrou
recebe uma tela de login; quem entrou e não tem a capacidade recebe um 403
honesto, em vez de ser mandado ao login num laço.

### Default-deny por prefixo

`lib/auth/guard.ts` casa por prefixo, não por rota exata. Um endpoint novo em
`/api/admin/qualquer-coisa` já nasce exigindo permissão administrativa, mesmo
que ninguém tenha escrito uma regra para ele. O pior caso passa a ser exigir
permissão **demais** — que aparece na primeira tentativa — em vez de permissão
de menos, que passa silenciosa.

Pelo mesmo motivo, os métodos **de leitura** é que são enumerados
(`GET`/`HEAD`/`OPTIONS`); qualquer outro conta como escrita.

---

## 4. Páginas de documentação e server islands

As páginas de documentação são **pré-renderizadas** e públicas. Isso é uma
escolha de produto (leitura sem login) e uma restrição técnica: desativar o
prerender desativa o Pagefind, que é a busca do portal.

Arquivo estático não passa por middleware e não conhece o usuário. Então o
botão "Editar esta página" e o bloco de conta na sidebar são **server islands**
(`server:defer`): a página é estática, mas esses fragmentos são renderizados sob
demanda, no servidor, já com o cookie da sessão.

```text
/guides/authentication            (HTML estático, público, indexado)
   └── <EditThisPage server:defer />
          ↓ requisição própria, passa pelo middleware
       viewer   → resposta vazia   (0 bytes)
       editor   → o botão
```

Isso satisfaz a exigência de que o botão **não seja renderizado** para quem não
pode editar: não há CSS escondendo nada, nem JavaScript decidindo no cliente. O
HTML do viewer nunca contém o botão.

O que de fato barra o acesso continua sendo o middleware em `/editor/*`. A
island controla a experiência; o middleware controla a segurança.

---

## 5. Onde ficam os dados

Conteúdo e identidade têm donos diferentes:

| | Fonte de verdade | Versionado |
| --- | --- | --- |
| Documentação | `src/content/**` (Markdown/MDX) | sim |
| Usuários, sessões, auditoria | `data/*.json` | **não** (`.gitignore`) |

O princípio arquitetural do projeto continua intacto: Markdown/MDX é a fonte de
verdade **do conteúdo**. Usuários não são conteúdo, e hash de senha, token de
sessão e chave HMAC não podem ir para o repositório.

- `data/users.json` — usuários e hashes scrypt
- `data/sessions.json` — SHA-256 dos tokens (nunca o token)
- `data/audit.json` — eventos, limitado a 5000
- `data/secret` — chave HMAC, gerada se `AUTH_SECRET` não estiver definida

Escritas são atômicas (temporário + `rename`) e serializadas por um lock por
arquivo — sem ele, dois `PATCH` simultâneos perderiam uma das alterações.

---

## 6. Senhas e sessões

**Senhas**: scrypt (`node:crypto`, sem dependência nova), salt aleatório de 16
bytes, parâmetros gravados junto do hash para poderem ser endurecidos depois.
Comparação com `timingSafeEqual`.

**Sessões**: o cookie carrega só um token aleatório de 256 bits; o estado fica
no servidor, e o que vai para o disco é o SHA-256 do token. Isso é o que permite
encerrar uma sessão de verdade — um token autocontido (JWT) exigiria lista de
revogação.

O cookie é `HttpOnly`, `SameSite=Lax` e `Secure` fora de desenvolvimento.

**O papel e o status são relidos do disco a cada requisição**, nunca tirados do
cookie. É por isso que desativar um usuário ou rebaixar seu papel vale
imediatamente, sem esperar a sessão expirar. Além disso, mudanças de papel,
status ou senha encerram as sessões abertas do alvo.

---

## 7. Proteções específicas

**Escalação de privilégio.** Alterar papel exige `permissions.manage`. Um ator
sem essa capacidade que envie `role` no corpo recebe 403 — o campo não é
silenciosamente ignorado, porque ignorar dá a falsa impressão de que a alteração
foi aplicada. As rotas também usam lista branca de campos: `id`, `createdAt` e
`passwordHash` não entram, mesmo se enviados.

**Último administrador.** Rebaixar, desativar ou excluir o último admin ativo é
recusado com 409. A regra vive no serviço, não na rota, para qualquer chamador
herdá-la. Um admin inativo não conta como reserva.

**Enumeração de usuários.** Login responde a mesma mensagem para e-mail
inexistente, senha errada e conta inativa — e gasta o mesmo tempo, executando um
scrypt mesmo quando o e-mail não existe.

**Força bruta.** Limitador por IP em memória (10 tentativas / 15 min). Não
substitui um limitador na borda, mas inviabiliza o ataque online.

**CSRF.** `SameSite=Lax` mais a checagem de origem do próprio Astro para
métodos que não são de leitura. O logout é `POST`, não link: um `GET` que destrói
sessão pode ser disparado por um `<img>` em página de terceiros.

**Redirecionamento aberto.** O `?next=` do login só aceita caminhos internos.
Sem isso, o login viraria trampolim de phishing partindo do domínio legítimo.

---

## 8. Auditoria

Eventos administrativos e de conteúdo no mesmo log, porque a pergunta depois de
um incidente — "quem mudou isso e quando?" — não distingue os dois.

```text
USER_CREATED · USER_UPDATED · USER_ROLE_CHANGED
USER_DEACTIVATED · USER_REACTIVATED · USER_DELETED
SESSION_STARTED · SESSION_ENDED · SESSION_DENIED
DOCUMENT_CREATED · DOCUMENT_UPDATED · DOCUMENT_DELETED
```

`recordAudit` nunca lança: perder o registro de uma desativação é ruim, mas
deixar o usuário ativo porque o log falhou é pior.

---

## 9. Primeiro acesso

Sem nenhum usuário, o primeiro request cria um administrador:

- com `PORTAL_ADMIN_EMAIL` / `PORTAL_ADMIN_PASSWORD`, se definidos;
- senão, gera uma senha aleatória e a imprime **uma única vez** no console do
  servidor.

Em produção, defina `AUTH_SECRET` (≥ 32 caracteres). Sem ela, uma chave é gerada
em `data/secret` — o que funciona em desenvolvimento, mas não sobrevive a várias
réplicas.

---

## 10. Limites conhecidos

- **Não há controle de acesso à leitura**: a documentação é pública por decisão
  de produto. Conteúdo que não pode ser lido por qualquer um não deve estar aqui.
- **Sem "esqueci minha senha"**: a redefinição é feita por um admin, na tela de
  usuários.
- **Sem perfil próprio**: o usuário não edita os próprios dados.
- **Sessões e usuários em JSON**: adequado para uma instalação; várias réplicas
  precisariam de um store compartilhado. As interfaces de `users.ts` e
  `sessions.ts` são o ponto de troca.
- **O limitador de login é por processo**, não distribuído.
