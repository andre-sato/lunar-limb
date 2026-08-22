---
type: Guide
title: Publicação no GitHub Pages
description: O workflow de publicação, o caminho base e o que muda entre o site estático e o modo servidor.
resource: https://docs.suaempresa.com/guides/publicacao-no-github-pages/
tags:
  - guia
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
    resource: src/content/docs/guides/publicacao-no-github-pages.mdx
    title: src/content/docs/guides/publicacao-no-github-pages.mdx no repositório
    last_modified: '2026-08-22T00:41:25.391Z'
audiences:
  - developer
  - product
owner:
  type: team
  id: documentation
---

O portal tem duas naturezas no mesmo repositório: um **site de documentação**, que é HTML estático, e uma **aplicação** — editor, login, Settings, chat, feedback —, que precisa de um servidor Node. O GitHub Pages serve arquivos, não processos, então o que se publica lá é a primeira metade.

O workflow [deploy-docs.yml](.github/workflows/deploy-docs.yml) faz isso a cada push no branch principal. Antes do primeiro deploy, em **Settings → Pages** do repositório, defina *Source* como **GitHub Actions**.

| Variável do repositório | Para quê | Padrão |
| --- | --- | --- |
| `SITE_URL` | URL pública; o sitemap e o registro OpenSearch precisam dela absoluta | `https://<owner>.github.io/<repo>` |
| `PAGES_BASE` | Subcaminho do site de projeto. Use `/` em site de usuário/organização ou domínio próprio | nome do repositório |

Localmente:

```bash
npm run build:pages
```

O comando constrói com `PORTAL_TARGET=pages` e confere o pacote em `dist/client`.

### O que não vai ao ar, e por quê

`PORTAL_TARGET=pages` **não renderiza** os componentes que dependem de servidor, em vez de publicá-los quebrados: uma ilha de servidor no Pages busca `/_server-islands/…` e recebe 404, o widget de feedback aceita o clique e falha no POST, o chat abre e não responde. Botão que não funciona é pior que botão ausente, porque o leitor não sabe que o problema não é dele.

A lista fica explícita em [src/config/deploy.ts](https://github.com/andre-sato/lunar-limb/blob/master/src/config/deploy.ts) — quem acrescentar um recurso com API própria decide ali o que acontece com ele no Pages.

### O subcaminho é o detalhe que quebra

Num site de projeto (`usuario.github.io/repositorio/`), o `base` do Astro passa a ser `/repositorio/`. A Astro reescreve o que ela gera — navegação, assets, paginação — mas **não** os links absolutos escritos à mão no Markdown, nem os botões de `hero.actions` do frontmatter. Todos apontariam para a raiz do domínio.

Dois pontos cobrem isso: o rehype [rehype-base-path.ts](https://github.com/andre-sato/lunar-limb/blob/master/src/lib/deploy/rehype-base-path.ts) prefixa os links do corpo, e o override [Hero.astro](https://github.com/andre-sato/lunar-limb/blob/master/src/components/Hero.astro) prefixa os do hero. Foi a validação de links do build que revelou a segunda metade do problema.

Com `PAGES_BASE` diferente de `/`, a validação de links é desligada: ela confere os caminhos como estão na fonte, enquanto o prefixo entra na renderização, e o resultado seria acusar como quebrados links que o HTML final traz corretos. A validação continua valendo no build de raiz — o do desenvolvimento e o do PR.
