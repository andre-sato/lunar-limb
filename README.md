# Developer Portal

Template white-label de documentação para desenvolvedores, construído com Astro e Starlight.

O portal separa três tipos de conteúdo:

- **Guias:** instruções orientadas a tarefas e fluxos de integração.
- **Referência de API:** contratos técnicos, autenticação e erros.
- **Changelog:** alterações relevantes para integrações existentes.

Todas as páginas oferecem o menu **Compartilhar com IA**: ele copia o título, URL e conteúdo da página. A lista de clientes e seus destinos pode ser configurada em `src/config/portal.ts`.

O cabeçalho também inclui **Buscar na documentação** ao lado da busca padrão: você escreve a dúvida em linguagem natural e recebe os trechos mais próximos das páginas publicadas, cada um com o link da sua página. **Não há modelo de linguagem envolvido** — nada é redigido, resumido ou inferido, e por isso não há como a interface afirmar algo que a documentação não diga. Um bloco de conteúdo reutilizável aparece com o link da página que o inclui, porque bloco não tem página própria. Trechos por busca, relevância mínima e limite de uso ficam em **Settings → Chatbot**.

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
| `npm run check` | Typecheck de `.astro`, `.ts` e `.tsx` (`astro check`). |
| `npm test` | Roda os testes (Vitest). |
| `npm run docs:lint` | Analisa a documentação e calcula o Quality Score. |
| `npm run docs:asyncapi` | Gera páginas de referência a partir de especificações AsyncAPI. |
| `npm run user:create` | Cria um usuário do portal (ver *Usuários e controle de acesso*). |

> **Comece pelo [Manual completo](src/content/docs/guides/manual.mdx)** (publicado em `/guides/manual/`): recursos do portal e do editor, atalhos de teclado, fluxos de trabalho e casos de uso, com diagramas.

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

**Fase 4 — Content Graph bidirecional:**
- **Grafo de dependências de verdade.** `src/lib/editor/graph-model.ts` (algoritmos puros) + `src/lib/editor/content-graph.ts` (leitura do filesystem) montam um índice de nós (arquivos) e arestas (cada `<ContentBlock>`/`<IncludePage>`, com linha e coluna). O índice é **derivado**: os arquivos continuam sendo a fonte de verdade, nada é persistido em banco.
- **Painel de referências nos dois sentidos.** Acima do editor: *Esta página usa* (com o número da linha de cada tag — clicar leva o cursor até lá) e *Usado por N páginas* (clicar abre a página consumidora). Quando o arquivo aberto é consumido por outros, o painel abre com o aviso de impacto antes de você digitar.
- **Impact analysis com efeito indireto.** Se A usa B e B usa o bloco que você está editando, A também aparece — separado em *diretas* e *indiretas*. Vale para o painel e para o aviso de exclusão.
- **Detecção de ciclo antes da inserção.** O modal *Inserir conteúdo reutilizável* desabilita, com o motivo, qualquer item cuja inserção fecharia um laço. Na Fase 3 isso só aparecia quando o preview quebrava.
- **Problems panel.** Referências quebradas e circulares do arquivo aberto aparecem no rodapé do editor com a linha exata; clicar leva o cursor até ela. Também há badge na toolbar e na status bar.
- **Content Graph (`Ctrl/Cmd + Shift + G`).** Visão global: todos os blocos e páginas que participam do grafo, ordenados por uso, expansíveis para ver *usa* / *usado por* / impacto total; e uma aba de problemas do projeto inteiro — incluindo **conteúdo órfão** (bloco que ninguém consome) e **id duplicado** (`x.md` e `x.mdx` lado a lado).
- **Decoração no Monaco.** Linhas que trazem conteúdo de outro arquivo ganham faixa lateral e hover explicando a origem — dá para distinguir conteúdo local de conteúdo reutilizado sem ler a tag.
- **Testes automatizados** (`npm test`, Vitest): 38 testes cobrindo extração de referências, backlinks, impacto transitivo, ciclos, referências quebradas, ids duplicados e conteúdo órfão — incluindo o caso `A → B, C → B, D → C` da especificação e um teste de integração que monta um repositório de conteúdo em diretório temporário.
- **Exemplos reais no projeto:** `src/content/snippets/{authentication-warning,rate-limit,api-essentials}.*` e a página [Conteúdo reutilizável](src/content/docs/guides/conteudo-reutilizavel.mdx), que documenta a sintaxe **e** a usa (inclusive reuso aninhado: `api-essentials` compõe os outros dois).
- Arquitetura detalhada em [docs/content-graph.md](docs/content-graph.md).

**Fase 5 — Autoria avançada:**
- **Command Palette.** `Ctrl/Cmd + P` abre arquivo por nome; `Ctrl/Cmd + Shift + P` lista comandos (digitar `>` alterna entre os dois modos, como no VS Code). 16 comandos, agrupados por Arquivo / Buscar / Inserir / Conteúdo / Ver.
- **Busca global** (`Ctrl/Cmd + Shift + F`): varre docs e snippets, agrupa por arquivo, destaca a ocorrência e marca o que veio do frontmatter. Clicar leva o cursor à linha exata.
- **Detach:** converte `<ContentBlock id="…" />` de volta em texto local, com confirmação explícita — a página deixa de acompanhar o conteúdo canônico.
- **Git awareness (somente leitura):** badges `M`/`A`/`D`/`U`/`R` no File Explorer e branch + estado do arquivo na status bar. O editor nunca faz commit, stage ou checkout.
- **Vim keybindings:** botão `VIM` na toolbar, com barra de status própria. `monaco-vim` é carregado sob demanda — quem não usa não paga o download. A preferência fica no `localStorage`.
- **Atalhos de formatação:** `Ctrl/Cmd + B` negrito, `Ctrl/Cmd + I` itálico, `Ctrl/Cmd + K` link — envolvem a seleção ou inserem um placeholder. Zen mode também responde a `Ctrl/Cmd + Shift + Z`, além de `F11`.

**Fase 5 — extras:**

1. **Novo arquivo nasce `.mdx`.** O checkbox do modal de nova página já vem marcado, e `Extract → Reusable Content` também passou a criar snippets `.mdx` — isso remove a limitação da Fase 3 em que um snippet precisava ser renomeado à mão para poder reutilizar outro bloco.

2. **Condicionais no texto.** Variáveis definidas em `src/config/content-variables.json` (booleanas ou string) controlam o que aparece:

   ```mdx
   <If flag="beta">Só com a flag `beta` ligada.</If>
   <If flag="beta" not>Só com ela desligada.</If>
   <If flag="plano" equals="enterprise">Só no plano enterprise.</If>
   ```

   Há uma tela para gerenciá-las (`Ctrl/Cmd + Shift + V`), mas o JSON continua versionado em Git e editável à mão. **No site publicado o trecho oculto não vai para o HTML** — não fica escondido por CSS. No preview do editor, ao contrário, ele vira um marcador cinza dizendo qual condição falhou, porque quem escreve precisa ver que há conteúdo condicional ali. Uma variável inexistente **esconde** o trecho (e o editor avisa), para nada vazar por um nome digitado errado.

3. **`visible` no frontmatter.** `visible: false` mantém a página publicada e acessível por URL, mas fora da navegação e da busca. `showIf: <variável>` faz o mesmo condicionado a uma variável (com `!` para inverter). Ambos são traduzidos para `sidebar.hidden` e `pagefind: false` — mecanismos nativos da Starlight, sem renderer proprietário. **Não é controle de acesso**: para esconder de fato o conteúdo, use `<If>`, que não emite o HTML.

   Arquitetura detalhada em [docs/conteudo-condicional.md](docs/conteudo-condicional.md).

**Como rodar:**

```bash
npm install
npm run dev
```

Depois abra `http://localhost:4321/editor/`.

## Usuários e controle de acesso

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

Arquitetura detalhada, incluindo as proteções contra escalação de privilégio e remoção do último admin, em [docs/controle-de-acesso.md](docs/controle-de-acesso.md).

## Documentation Linter e Quality Score

O editor traz um revisor editorial automatizado: analisa cada página, aponta problemas com id estável (`STRUCTURE-001`, `TECH-MKT-001`, …) e calcula uma **nota de 0 a 10** com detalhamento por dimensão — gramática, clareza, concisão, estrutura, technical writing, consistência, acionabilidade, terminologia e legibilidade.

Os problemas aparecem no painel abaixo do editor e sublinhados no Monaco. Correção rápida existe só quando é mecânica; sugestões subjetivas não alteram o texto sozinhas.

A nota **não** é `10 − nº de erros`: cada dimensão é pontuada isoladamente, e o dano é normalizado por tamanho, para uma página longa não ser punida por ser longa. Calibração contra o conteúdo real: 8,9–10,0. Contra um documento escrito de propósito com TODO, linguagem promocional e link sem destino: 4,8.

O style guide fica em `styles/default.yaml`, versionado em Git — limiares, termos proibidos, terminologia canônica, acrônimos conhecidos, severidade e peso por regra. Profiles adicionais herdam com `extends`, e uma página escolhe o seu pelo frontmatter. Regras podem ser silenciadas por linha, por bloco ou por página, e todo silenciamento é registrado.

Na linha de comando e em CI:

```bash
npm run docs:lint
```

`--changed` analisa só o que mudou **mais as páginas consumidoras** dos blocos alterados, usando o Content Graph. Saída `0` aprovado, `1` gate reprovado, `2` configuração, `3` execução.

**Settings → Quality** traz a visão do workspace: nota média, média por dimensão e problemas mais frequentes. Regras e arquitetura em [docs/linter.md](docs/linter.md).

## Feedback de página

No fim de cada página de documentação há um widget **"Esta página foi útil?"** com sim/não e um campo opcional de comentário. A Starlight não traz um componente de feedback nem plugin oficial — o caminho que ela indica é sobrescrever `Footer`, que é o que o projeto faz. As alternativas de mercado são SaaS de terceiros; aqui o retorno dos seus leitores fica no próprio projeto.

O envio é **anônimo**: sem login, sem cookie, sem identificador de visitante. Grava-se caminho, voto, idioma e o comentário; o IP serve só ao limite de envio e não é armazenado.

As respostas ficam em **Settings → Feedback**: proporção de "útil", comentários recentes e **onde mexer primeiro** — páginas com maioria negativa e pelo menos 3 votos, para uma reclamação isolada não mandar o time reescrever conteúdo.

Com a integração do Do11y ligada, o mesmo clique também vira um evento `feedback` no Supabase. Detalhes em [docs/feedback-de-pagina.md](docs/feedback-de-pagina.md).

## Publicação no GitHub Pages

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

A lista fica explícita em [src/config/deploy.ts](src/config/deploy.ts) — quem acrescentar um recurso com API própria decide ali o que acontece com ele no Pages.

### O subcaminho é o detalhe que quebra

Num site de projeto (`usuario.github.io/repositorio/`), o `base` do Astro passa a ser `/repositorio/`. A Astro reescreve o que ela gera — navegação, assets, paginação — mas **não** os links absolutos escritos à mão no Markdown, nem os botões de `hero.actions` do frontmatter. Todos apontariam para a raiz do domínio.

Dois pontos cobrem isso: o rehype [rehype-base-path.ts](src/lib/deploy/rehype-base-path.ts) prefixa os links do corpo, e o override [Hero.astro](src/components/Hero.astro) prefixa os do hero. Foi a validação de links do build que revelou a segunda metade do problema.

Com `PAGES_BASE` diferente de `/`, a validação de links é desligada: ela confere os caminhos como estão na fonte, enquanto o prefixo entra na renderização, e o resultado seria acusar como quebrados links que o HTML final traz corretos. A validação continua valendo no build de raiz — o do desenvolvimento e o do PR.

## Referência de API a partir de especificação

O portal aceita dois formatos de especificação, e cada um tem um caminho próprio porque descrevem coisas diferentes:

| Formato | Como publicar | O que descreve |
| --- | --- | --- |
| **OpenAPI** | `src/schemas/<nome>.yaml` — o `starlight-openapi` gera as páginas no build | Rotas HTTP, verbos, códigos de status |
| **AsyncAPI** | `src/schemas/<nome>.asyncapi.yaml` + `npm run docs:asyncapi` | Canais, mensagens e payloads de sistema orientado a eventos |

Não há conversão entre os dois: um canal Kafka não é um endpoint REST. Misturá-los produziria documentação falsa.

O `astro.config.mjs` só registra o `starlight-openapi` para arquivos que **declaram** `openapi:` ou `swagger:` — filtrar pela extensão não basta. Um AsyncAPI passado ao plugin gera uma página com o título certo e nenhuma operação: falha silenciosa, pior que um erro.

`npm run docs:asyncapi -- --check` falha se a página gerada estiver desatualizada em relação à especificação — serve para CI e para pegar quem editou a página gerada à mão. O mesmo é verificado por teste.

Um exemplo real está no repositório: [`src/schemas/streetlights-kafka.asyncapi.yaml`](src/schemas/streetlights-kafka.asyncapi.yaml) gera [`api-reference/streetlights-kafka.md`](src/content/docs/api-reference/streetlights-kafka.md).

## Plugins da comunidade Starlight

| Plugin | O que acrescenta |
| --- | --- |
| `starlight-links-validator` | Valida todo link e âncora interna no build; link quebrado reprova o build. Complementa o `docs:lint`, que olha qualidade editorial e referências de conteúdo reutilizável. |
| `starlight-view-modes` | Modos de leitura: zen (`/zen-mode/<página>`) e tela cheia. |
| `starlight-videos` | Frontmatter e componentes para páginas de vídeo. |
| `starlight-scroll-to-top` | Botão "voltar ao topo" com anel de progresso. |
| `starlight-tags` | Taxonomia por tags, com páginas de índice em `/tags`. A taxonomia fica em [tags.yml](tags.yml) e aceita rótulos por idioma. |
| `@inox-tools/star-warp` | Busca "warp": `/warp?q=termo` vai direto ao melhor resultado do Pagefind, e `/warp.xml` registra o portal como buscador do navegador (OpenSearch). |

Dois entram **sob condição**, porque exigem conteúdo que só você tem:

- **`starlight-openapi`** ativa sozinho quando existe um schema em `src/schemas/*.yaml|json`. A referência de API deste portal é escrita à mão e não descreve endpoints concretos; inventar um schema para ligar o plugin produziria documentação falsa.
- **`starlight-versions`** ativa quando existe um `versions.json` na raiz (ex.: `["1.0"]`). Cada versão é uma cópia congelada da documentação, gerada pelo comando do próprio plugin.

Cinco itens da lista **não** foram adicionados, e vale o registro do motivo:

| Plugin | Por que não |
| --- | --- |
| `starlight-image-zoom` | Incompatível com o processador Markdown Sätteri do Astro 7 — o próprio plugin aborta o build e aponta o [issue #63](https://github.com/HiDeoo/starlight-image-zoom/issues/63). |
| `starlight-contextual-menu` | Exige `astro@^5`; o projeto está no 7. E duplica o menu "Compartilhar com IA". |
| `starlight-page-actions` | Duplica o que o portal já faz: copiar a página para IA e conversar com o assistente. |
| `starlight-changelogs` | O portal já tem seção de Changelog com páginas próprias; adotar o plugin significaria reestruturar esse conteúdo. |
| `starlight-recipes` | Modela receitas culinárias (ingredientes, porções, cozinha, autores). Nada neste portal tem essa forma. |
| `starlight-fullview-mode` | O modo de tela cheia já vem do `starlight-view-modes`; os dois disputam os mesmos overrides de layout. |
| `starlight-agentready` | **Removido depois de instalado.** Ele não gera nada localmente: a cada build faz um POST do seu domínio para `agentready.it.com` para registrá-lo num índice de IA de terceiros, sem opção de desligar. Publicar o domínio num serviço externo é decisão sua, não efeito colateral de um `npm run build`. |

Três plugins (`view-modes`, `videos`) querem os mesmos pontos de override que o portal já usa (`PageTitle`, `Search`). Em vez de disputá-los, os componentes deles são **compostos** dentro dos nossos — é o que os próprios avisos de build pedem. Os avisos continuam aparecendo porque a Starlight não sabe que a composição foi feita.

## Consulta pelo terminal (MCP Server + CLI)

O diretório [mcp-docs/](mcp-docs/) traz um **Documentation MCP Server** e uma CLI que consultam esta mesma documentação a partir do terminal:

```bash
doc ask "Como funciona o rate limit?"
```

A separação importa: o servidor MCP expõe as ferramentas (`search_docs`, `get_document`, `list_documents`, `find_references`) pelo Model Context Protocol, e a CLI é apenas **um** cliente entre outros — uma IDE ou um agente de IA consomem o mesmo servidor, com o mesmo comportamento e as mesmas validações. O Markdown continua sendo a fonte de verdade: o indexador lê `src/content/docs` e `src/content/snippets`, entende os blocos reutilizáveis e sabe quais páginas consomem cada bloco, então a citação aponta uma página que o leitor pode abrir.

É somente leitura, e funciona sem chave de API (busca lexical e resposta composta dos trechos encontrados). Instalação, configuração e arquitetura em [mcp-docs/README.md](mcp-docs/README.md).

## Analytics da documentação (Do11y)

Em **Settings → Analytics** o portal integra o [Do11y](https://docservable.com/), que captura eventos de engajamento nas páginas e os grava numa tabela do Supabase. Ele detecta referrers de plataformas de IA, então o dashboard mostra quanto da leitura vem de agentes (ChatGPT, Claude, Perplexity…) e quanto vem de pessoas.

A tela reúne visualizações por página, origem das sessões, tipos de evento, dispositivos e eventos por dia, com recorte de 24 h a 90 dias.

**Configuração:** crie a tabela no Supabase (o SQL está na própria tela) e cole as credenciais do projeto. Duas chaves, com papéis distintos:

- a **publishable** vai no HTML do portal — é pública por design, e a política de RLS só permite `insert`;
- a **service_role** é usada só pelo servidor, para ler os eventos. Ela **nunca** é enviada ao navegador nem devolvida por nenhuma rota; a tela mostra apenas os últimos quatro caracteres para confirmar qual chave está gravada.

Alternativamente, por ambiente: `DO11Y_ENABLED`, `DO11Y_SUPABASE_URL`, `DO11Y_SUPABASE_KEY`, `DO11Y_SERVICE_ROLE_KEY`, `DO11Y_TABLE` (têm precedência sobre a tela).

Só as páginas de documentação são medidas — o editor e o dashboard ficam de fora. Arquitetura em [docs/integracao-do11y.md](docs/integracao-do11y.md).

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

### Docker

Há um `Dockerfile` de dois estágios (build + runtime) que empacota o portal como imagem Node 22 Alpine. O container roda como usuário não-root (`node`) e espera um volume persistente em `/app/data`, onde ficam usuários, sessões e auditoria.

**Construir e rodar:**

```bash
docker build -t lunar-limb .
docker run -d --name lunar-limb \
  -p 4321:4321 \
  --env-file .env \
  -v lunar-limb-data:/app/data \
  --restart unless-stopped \
  lunar-limb
```

O portal fica em `http://localhost:4321`.

**Variáveis de ambiente:** o container lê as mesmas variáveis do `.env` (veja [`.env.sample`](.env.sample)) — `AUTH_SECRET`, `PORTAL_ADMIN_EMAIL`, `PORTAL_ADMIN_PASSWORD`, `SITE_URL`, `PORTAL_DATA_DIR` etc. Com `--env-file .env`, basta preencher o arquivo local.

**Volume de dados:** `data/` é o único estado persistente. Remover o volume (`docker volume rm lunar-limb-data`) apaga usuários e sessões e faz o portal semear um novo admin no primeiro request.

**Perda de senha do admin:** como `users.json` guarda só o hash, a senha não é recuperável. Apague o volume e reinicie com `PORTAL_ADMIN_EMAIL`/`PORTAL_ADMIN_PASSWORD` definidas, ou crie outro admin por `npm run user:create`.

> O seed do admin (`PORTAL_ADMIN_EMAIL`/`PORTAL_ADMIN_PASSWORD`) só roda quando não existe nenhum usuário. Depois que `users.json` é criado, mudar essas variáveis não tem efeito.

### Limitações atuais (para as próximas fases da especificação)

- O preview de MDX não executa componentes Astro/Starlight reais (incluindo `<ContentBlock>`/`<IncludePage>` fora do resolver dedicado) — mostra um placeholder com nome e props para componentes genéricos.
- Ainda não há scroll-sync entre editor e preview.
- Resolução de imagem relativa ao pré-visualizar um snippet aberto diretamente (fora de uma página) assume a pasta `content/docs`, então pode ficar imprecisa nesse caso específico.
- Referências quebradas e circulares aparecem no Problems panel e no Content Graph, mas ainda **não bloqueiam o build** em modo strict.
- Mover ou renomear um arquivo quebra as referências a ele (o `id` é o caminho sem extensão) — ainda não há um "rename refactor" que atualize os consumidores.
- O grafo só enxerga a sintaxe que o próprio editor gera (`<ContentBlock id="…" />` / `<IncludePage id="…" />`); referências escritas com props em outra ordem ou `id` vindo de expressão ficam de fora.
- `<If>` só funciona em `.mdx` (é JSX); em `.md` a tag vira texto literal.
- As variáveis são resolvidas em **build time** — mudar uma variável exige novo build para o site publicado refletir. No dev server, salvar variáveis recarrega a página do editor (o JSON é importado pelo build).
- `showIf` aceita uma variável só, com negação opcional; não há expressões booleanas compostas.
- A busca global varre o conteúdo a cada consulta, sem índice — adequado ao volume de um portal, não a dezenas de milhares de arquivos.
- Git awareness é somente leitura: nenhum commit, stage ou checkout parte do editor.
- A leitura da documentação é pública por decisão de produto: gatear as páginas exigiria desligar o prerender da Starlight, o que desativa a busca Pagefind. Conteúdo que não pode ser lido por qualquer um não deve estar no portal.
- Não há "esqueci minha senha" nem tela de perfil: a redefinição é feita por um admin em Settings → Users. `mustChangePassword` é devolvido no login, mas não há tela que force a troca antes de continuar.
- A busca conversacional devolve trechos, não respostas redigidas: quem sintetiza é o leitor. A relevância vem de BM25 sobre o mesmo índice do MCP Server, então ela acerta nome de campo, erro e comando melhor do que pergunta conceitual. As conversas ficam em memória, com TTL — reiniciar o servidor as descarta, e várias réplicas não as compartilham.
- Usuários e sessões ficam em JSON local, adequado a uma instalação; várias réplicas precisariam de um store compartilhado. O limitador de tentativas de login também é por processo.

### Dependências

O projeto utiliza React, `@astrojs/react`, `@astrojs/node`, Monaco, `remark-mdx` e `js-yaml`. A Fase 5 adiciona `monaco-vim` como única dependência de runtime nova; as de desenvolvimento (`vitest`, `typescript`, `@astrojs/check`) vieram na Fase 4. Rode `npm install` sempre que o `package.json` mudar.

> `astro check` depende de uma API programática que o compilador nativo do TypeScript 7 ainda não expõe, por isso o projeto fixa `typescript@^6` em devDependencies.

## Clean install

Se o `node_modules`/lockfile ficarem inconsistentes com o `package.json` (por exemplo depois de puxar uma versão nova do editor):

```powershell
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
Remove-Item -Force package-lock.json -ErrorAction SilentlyContinue
npm install
npm run build
npm run dev
```

