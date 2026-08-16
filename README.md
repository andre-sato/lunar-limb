# Developer Portal

Template white-label de documentação para desenvolvedores, construído com Astro e Starlight.

O portal separa três tipos de conteúdo:

- **Guias:** instruções orientadas a tarefas e fluxos de integração.
- **Referência de API:** contratos técnicos, autenticação e erros.
- **Changelog:** alterações relevantes para integrações existentes.

Todas as páginas oferecem o menu **Compartilhar com IA**: ele copia o título, URL e conteúdo da página. A lista de clientes e seus destinos pode ser configurada em `src/config/portal.ts`.

O cabeçalho também inclui um **Ask AI** ao lado da busca. Ele abre uma interface de conversa, prepara a pergunta com o contexto da página e transfere esse contexto ao cliente de IA selecionado.

## Idiomas

Português (Brasil) é o idioma nativo, sem prefixo de URL. As traduções completas ficam disponíveis em `/en/` e `/es/`, com o seletor de idioma nativo do Starlight. Para manter a associação entre idiomas, crie páginas com o mesmo caminho relativo em `src/content/docs/`, `src/content/docs/en/` e `src/content/docs/es/`.

## Personalização

Edite `src/config/portal.ts` para definir a empresa, o título do portal, a descrição, a URL base da API e o e-mail de suporte. As cores ficam em `src/styles/custom.css`.

## Estrutura de conteúdo

```text
src/content/docs/
├── api-reference/  # Contratos e convenções da API
├── changelog/      # Alterações por versão ou data
├── guides/         # Tutoriais e tarefas de integração
└── index.mdx       # Página inicial
```

Arquivos Markdown e MDX dentro de `src/content/docs/` são publicados automaticamente pelo Starlight. A navegação das três áreas é gerada a partir desses diretórios.

## Comandos

| Comando | Ação |
| --- | --- |
| `npm install` | Instala as dependências. |
| `npm run dev` | Inicia o ambiente de desenvolvimento. |
| `npm run build` | Gera a versão de produção em `dist/`. |
| `npm run preview` | Visualiza localmente a versão de produção. |

## Editor de documentação (`/editor`)

Além do site publicado, o projeto inclui um editor Markdown/MDX interno em **`/editor`**, feito com Monaco (o mesmo editor do VS Code) e React. Ele lê e grava diretamente os arquivos `.md`/`.mdx` em `src/content/docs` através das rotas de API em `src/pages/api/editor/`.

**Fase 1 — Editor básico:**
- Editor Monaco com syntax highlighting, multi-cursor, Find/Replace e atalhos padrão (tudo nativo do Monaco).
- Preview em tempo real, com debounce.
- File Explorer sobre `src/content/docs/`, cobrindo as três localidades (raiz `pt-BR`, `en/`, `es/`).
- Criar página (gera o frontmatter mínimo exigido pelo Starlight), excluir página (com confirmação).
- Autosave com debounce de 1s, indicador de estado (`Não salvo` / `Salvando…` / `Salvo` / `Erro`), aviso ao fechar a aba com alterações pendentes.
- Split view / apenas editor / apenas preview, modo Zen (`F11`), tema claro/escuro.

**Fase 2 — Markdown/MDX:**
- **MDX de verdade:** arquivos `.mdx` são parseados com `remark-mdx` (JSX, `{expressões}`, `import`/`export`) em vez de tratados como Markdown puro. Componentes JSX (`<Aside>`, `<Tabs>` etc.) aparecem no preview como uma caixa com o nome/props do componente, com o conteúdo interno (Markdown) renderizado normalmente — o editor **não executa** componentes React/Astro reais (isso exigiria rodar o pipeline de build do Astro dentro da rota de preview).
- **Frontmatter visual:** painel recolhível acima do editor com os campos `title`, `description`, `sidebar.label` e `sidebar.order`. Qualquer outro campo do frontmatter (customizado ou não coberto pelo formulário) é preservado intacto ao editar pelos campos visuais.
- **Imagens:** caminhos relativos de imagem (`![](../assets/foo.png)`) são resolvidos a partir da pasta do arquivo aberto e servidos por `GET /api/editor/asset`, escopado a `src/`. Imagens que não existem ficam com uma borda tracejada no preview em vez de um ícone quebrado do navegador.
- **Validação/erro de sintaxe:** erros de parsing do Markdown/MDX (JSX mal formado, YAML inválido no frontmatter, etc.) aparecem tanto no preview quanto como marcador vermelho na linha correspondente do Monaco, com o motivo do erro.
- GFM completo (tabelas, task lists, strikethrough, autolinks) — já coberto desde a Fase 1 via `remark-gfm`.

**Fase 3 — Reuso de conteúdo:**
- **Conteúdo reutilizável de verdade, não só no editor.** `src/content/snippets/*.md|mdx` é uma nova collection (registrada em `src/content.config.ts`). Um bloco é referenciado com `<ContentBlock id="..." />`; uma página inteira, com `<IncludePage id="..." />`. Esses componentes existem em `src/components/content/` e usam `getEntry`/`render` do `astro:content` — funcionam no **site publicado de verdade**, não são um truque só do preview.
- **Resolver no preview.** `src/lib/editor/remark-resolve-reusable.ts` é a contraparte do preview: ao encontrar `<ContentBlock>`/`<IncludePage>`, resolve e insere o conteúdo referenciado inline (recursivamente, então um bloco pode incluir outro), com detecção de referência circular e de id inexistente — ambos aparecem como um aviso inline no preview em vez de derrubar a página inteira.
- **Só funciona em `.mdx`.** `<ContentBlock>`/`<IncludePage>` são JSX — arquivos `.md` puros não têm esse conceito. O editor bloqueia Inserir/Extrair em páginas `.md` com uma mensagem explicando isso; crie a página como `.mdx` (checkbox no modal de nova página) para usar reuso de conteúdo.
- **Insert Reusable Content** (ícone de peça de quebra-cabeça na toolbar): busca por título/id entre blocos e páginas existentes, insere a tag e — se ainda não existir — adiciona automaticamente a linha `import ContentBlock from '.../ContentBlock.astro'` no topo do arquivo. O autor nunca precisa saber que isso é necessário.
- **Extract → Reusable Content** (ícone de tesoura): pega a seleção atual no Monaco, cria `src/content/snippets/<id>.md` com ela, e substitui a seleção por `<ContentBlock id="..." />` (com o import, se preciso).
- **Painel de referências:** abaixo do frontmatter, mostra o que a página atual usa e por quantas páginas ela é usada (clicável, navega direto).
- **Impact analysis ao excluir:** apagar um bloco/página referenciado por outras mostra quem depende dele antes de confirmar, em vez de quebrar silenciosamente.
- **File Explorer** agora tem duas árvores empilhadas: "Documentação" e "Conteúdo reutilizável".

**Como rodar:**

```bash
npm install
npm run dev
```

Depois abra `http://localhost:4321/editor/`.

### Build e preview de produção

O projeto usa `@astrojs/node` com `output: 'server'`, porque as rotas do editor precisam de execução sob demanda para ler e gravar arquivos no filesystem.

```bash
npm run build
npm run preview
```

Também é possível iniciar diretamente o servidor standalone gerado:

```bash
node ./dist/server/entry.mjs
```

### Limitações atuais (para as próximas fases da especificação)

- O preview de MDX não executa componentes Astro/Starlight reais (incluindo `<ContentBlock>`/`<IncludePage>` fora do resolver dedicado) — mostra um placeholder com nome e props para componentes genéricos.
- Ainda não há scroll-sync entre editor e preview.
- Extract sempre cria o snippet como `.md`; se ele mesmo precisar reutilizar outro bloco (reuso aninhado), é preciso renomear manualmente para `.mdx` — ainda não há um comando "converter para .mdx" na interface.
- Resolução de imagem relativa ao pré-visualizar um snippet aberto diretamente (fora de uma página) assume a pasta `content/docs`, então pode ficar imprecisa nesse caso específico.
- Detecção de referência circular acontece no preview (ao renderizar) e ao excluir (impact analysis) — ainda não há uma checagem no momento de inserir, nem um bloqueio de build.
- Não há Detach (transformar referência de volta em texto local), grafo visual (`Content Graph Index`), busca global nem Command Palette — isso é o escopo da Fase 4/5.
- O editor não tem autenticação própria. Não o exponha publicamente sem colocar algo na frente (ele tem permissão de escrita no repositório) — use-o localmente ou em um servidor interno.

### Dependências

O projeto utiliza React, `@astrojs/react`, `@astrojs/node`, Monaco, `remark-mdx` e `js-yaml`. A Fase 3 não adiciona nenhuma dependência nova além dessas. Rode `npm install` sempre que o `package.json` mudar.

## Clean install

Se o `node_modules`/lockfile ficarem inconsistentes com o `package.json` (por exemplo depois de puxar uma versão nova do editor):

```powershell
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
Remove-Item -Force package-lock.json -ErrorAction SilentlyContinue
npm install
npm run build
npm run dev
```

