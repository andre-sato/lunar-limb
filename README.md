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

Além do site publicado, o projeto inclui um editor Markdown/MDX interno em **`/editor`**, feito com Monaco (o mesmo editor do VS Code) e React.

Funcionalidades desta primeira fase:

- Editor Monaco com syntax highlighting, multi-cursor, Find/Replace e atalhos padrão (tudo nativo do Monaco).
- Preview em tempo real (GitHub-flavored Markdown), com debounce.
- File Explorer sobre `src/content/docs/`, cobrindo as três localidades (raiz `pt-BR`, `en/`, `es/`).
- Criar página (gera o frontmatter mínimo exigido pelo Starlight), excluir página (com confirmação).
- Autosave com debounce de 1s, indicador de estado (`Não salvo` / `Salvando…` / `Salvo` / `Erro`), aviso ao fechar a aba com alterações pendentes.
- Split view / apenas editor / apenas preview, modo Zen (`F11`), tema claro/escuro.

**Como rodar:** `npm install && npm run dev`, depois abra `http://localhost:4321/editor`.

**Limitações desta fase** (previstas para as próximas fases da especificação):
- O preview renderiza Markdown/GFM puro — ainda não resolve componentes MDX/Starlight nem faz scroll-sync com o editor.
- Ainda não há reuso de conteúdo (blocos/páginas reutilizáveis), grafo de referências, busca global nem Command Palette — isso é o escopo da Fase 3 em diante.
- O editor lê e grava diretamente no filesystem via rotas em `src/pages/api/editor/`. Essas rotas são renderizadas sob demanda (`export const prerender = false`) e exigem um servidor Node rodando — funcionam com `astro dev` ou com `node ./dist/server/entry.mjs` (via `@astrojs/node`, modo `standalone`), mas **não** em um host puramente estático (o restante do site continua sendo gerado como HTML estático). Use o editor localmente ou em um servidor interno, não exposto publicamente sem autenticação — ele tem permissão de escrita no repositório.

## Editor de documentação (`/editor`)

O projeto inclui um editor Markdown/MDX interno em `/editor`, feito com Monaco + React.

O editor lê e grava diretamente os arquivos `.md` e `.mdx` em `src/content/docs` através das rotas de API em `src/pages/api/editor/`.

### Como executar

```bash
npm install
npm run dev
```

Depois abra `http://localhost:4321/editor/`.

### Build e preview de produção

O projeto usa `@astrojs/node` com `output: 'server'`, porque as rotas do editor precisam de execução sob demanda para ler e gravar arquivos no filesystem. O Node adapter é a configuração recomendada pelo Astro para esse tipo de rota. 

```bash
npm run build
npm run preview
```

Também é possível iniciar diretamente o servidor standalone gerado:

```bash
node ./dist/server/entry.mjs
```

### Dependências

O projeto utiliza React, `@astrojs/react`, `@astrojs/node` e Monaco. O `package-lock.json` antigo não continha as dependências adicionadas pelo editor, portanto ele foi removido para que o primeiro `npm install` gere um lockfile consistente com o `package.json` atual.


## Clean install

```powershell
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
Remove-Item -Force package-lock.json -ErrorAction SilentlyContinue
npm install
npm run build
npm run dev
```
