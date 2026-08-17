# Developer Portal

Template white-label de documentação para desenvolvedores, construído com Astro e Starlight.

O portal separa três tipos de conteúdo:

- **Guias:** instruções orientadas a tarefas e fluxos de integração.
- **Referência de API:** contratos técnicos, autenticação e erros.
- **Changelog:** alterações relevantes para integrações existentes.

Todas as páginas oferecem o menu **Compartilhar com IA**: ele copia o título, URL e conteúdo da página. A lista de clientes e seus destinos pode ser configurada em `src/config/portal.ts`.

O cabeçalho também inclui **Perguntar à documentação** ao lado da busca: um assistente que responde dentro do próprio portal, a partir das páginas publicadas, citando as fontes. Retrieval, guardrails de entrada e de saída e a chamada ao modelo acontecem no servidor — nenhuma chave de provedor chega ao navegador. Sem chave configurada ele opera em modo só-retrieval, devolvendo os trechos encontrados. A chave, o modelo e os limites ficam em **Settings → Chatbot**.

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
- O chatbot não tem streaming: a resposta chega inteira. A classificação de segurança é determinística (padrões), com a interface `SafetyClassifier` pronta para uma camada semântica por modelo. As conversas ficam em memória, com TTL — reiniciar o servidor as descarta, e várias réplicas não as compartilham.
- O resumo de conversa é extrativo (lista as perguntas que saíram da janela), não gerado por modelo.
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

