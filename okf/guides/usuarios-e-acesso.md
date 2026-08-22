---
type: Guide
title: Usuários e controle de acesso
description: Os três papéis do portal, o primeiro acesso, criação de usuários pela linha de comando e como a autorização é aplicada.
resource: https://docs.suaempresa.com/guides/usuarios-e-acesso/
tags:
  - guia
  - seguranca
  - portal
status: stable
generated:
  by: process:okf-export
  at: '2026-08-22T12:12:38.074Z'
verified:
  - by: human:mestre
    at: '2026-08-19T00:00:00.000Z'
stale_after: '2027-02-15T00:00:00.000Z'
sources:
  - id: repo
    resource: src/content/docs/guides/usuarios-e-acesso.mdx
    title: src/content/docs/guides/usuarios-e-acesso.mdx no repositório
    last_modified: '2026-08-22T00:41:25.398Z'
audiences:
  - developer
  - product
owner:
  type: team
  id: documentation
---

O portal tem três grupos. A leitura da documentação é pública; editar e administrar exigem entrar.

| | viewer | editor | admin |
| --- | :-: | :-: | :-: |
| Ler e pesquisar a documentação | ✓ | ✓ | ✓ |
| Ver "Editar esta página" e abrir o editor | | ✓ | ✓ |
| Criar, editar e excluir páginas | | ✓ | ✓ |
| Acessar Settings, gerenciar usuários e papéis | | | ✓ |

**Primeiro acesso.** Sem nenhum usuário cadastrado, o primeiro request cria um administrador e imprime a senha **uma única vez** no console do servidor. Para definir as credenciais você mesmo:

```bash
PORTAL_ADMIN_EMAIL=voce@empresa.com PORTAL_ADMIN_PASSWORD=uma-senha-longa npm run dev
```

**Usuário mestre.** Esta instalação já tem um admin chamado **Mestre**, com o e-mail `mestre@lunar-limb.local`, criado para abrir o `/settings`. A senha foi gerada e exibida uma única vez no console: no disco existe só o hash, e não há como o portal mostrá-la novamente. Perdida a senha, ou outro admin a redefine em Settings → Users, ou se cria um novo usuário.

Para criar usuários pela linha de comando:

```bash
npm run user:create -- --email pessoa@empresa.com --name "Nome" --role editor
```

`--role` aceita `viewer`, `editor` ou `admin` (padrão `admin`). Sem `--password`, a senha é gerada e mostrada uma vez — preferível a passá-la como argumento, que fica no histórico do shell. Toda senha gerada por nós entra marcada como provisória, e o login devolve `mustChangePassword`; a troca é feita em Settings → Users. O portal **não** bloqueia a navegação até que ela aconteça: o aviso é informativo.

O comando existe porque criar o primeiro admin pela tela exigiria já ser admin. Ele não amplia privilégio nenhum — quem tem o sistema de arquivos do servidor já tem controle total.

Em produção, defina também `AUTH_SECRET` (≥ 32 caracteres). Sem ela, uma chave é gerada em `data/secret`, o que funciona localmente mas não sobrevive a várias réplicas. `PORTAL_DATA_DIR` move o diretório de dados — útil para subir uma instância de verificação sem tocar nos usuários reais.

**Onde ficam os dados.** Usuários, sessões e auditoria vivem em `data/*.json`, que é **ignorado pelo Git** — hash de senha, token de sessão e chave HMAC não vão para o repositório. O conteúdo continua sendo Markdown/MDX versionado: usuários não são conteúdo.

**Como a autorização é aplicada.** O código pergunta por capacidade (`can(user, 'users.update')`), nunca por nome de grupo, e um único middleware protege `/editor/*`, `/settings/*` e as APIs. O botão "Editar esta página" é uma *server island*: a página é estática, mas o botão é renderizado sob demanda no servidor — um viewer nunca recebe esse HTML. Ainda assim, quem barra o acesso é o middleware, não o botão escondido.

Arquitetura detalhada, incluindo as proteções contra escalação de privilégio e remoção do último admin, em [docs/controle-de-acesso.md](https://github.com/andre-sato/lunar-limb/blob/master/docs/controle-de-acesso.md).
