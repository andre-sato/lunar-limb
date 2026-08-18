# Developer Portal

Template white-label de documentação para desenvolvedores, construído com Astro e Starlight.

O portal separa três tipos de conteúdo:

- **Guias:** instruções orientadas a tarefas e fluxos de integração.
- **Referência de API:** contratos técnicos, autenticação e erros.
- **Changelog:** alterações relevantes para integrações existentes.

Todas as páginas oferecem o menu **Compartilhar com IA**: ele copia o título, URL e conteúdo da página. A lista de clientes e seus destinos pode ser configurada em `src/config/portal.ts`.

A barra lateral traz **Fale com o chatbot**, aberto: você escreve a dúvida em linguagem natural e recebe uma resposta com as fontes. Sem chave de provedor no ambiente — que é o padrão — ele devolve os trechos das páginas e um resumo extrativo, sem redigir nada. Com `ANTHROPIC_API_KEY`, o mesmo pipeline redige a resposta a partir desses trechos, atravessando os guardrails descritos em *Assistente de documentação*. Um bloco de conteúdo reutilizável aparece com o link da página que o inclui, porque bloco não tem página própria.

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
| `npm run docs:test` | Testes de documentação: links, âncoras, referências e exemplos de API. |
| `npm run docs:health` | Observabilidade: dimensões, SLOs, orçamento, histórico e regressões. |
| `npm run twin` | Digital Twin: cobertura, não documentados, obsoletos, impacto. |
| `npm run contract` | Contract Testing: o exemplo representa o contrato de verdade? |
| `npm run gaps` | Gap Mining: o que as pessoas procuram e não encontram. |
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

## Testes de documentação

O linter pergunta "isto está bem escrito?". A suíte de testes pergunta "isto **funciona**?" — e é a pergunta que o linter nunca responde. Um link para uma página inexistente passa em qualquer regra de estilo; um exemplo de resposta que não bate mais com o schema está impecavelmente redigido.

```bash
npm run docs:test
```

Três perfis, do mais barato ao mais caro: `quick` (padrão — links, âncoras, Content Graph, sem rede), `--standard` (mais exemplos de API e estrutura de snippets) e `--strict` (mais links externos, com rede). `--changed` restringe ao que o Git aponta, `--file <caminho>` a uma página, `--json` serve CI. Saída `0` aprovado, `1` falha, `2` opção inválida, `3` execução.

As regras: `DOC-LINK-001` link interno para página inexistente, `DOC-LINK-002` âncora inexistente (a âncora do link passa pela mesma normalização dos títulos, acento incluído), `DOC-GRAPH-001` referência quebrada no Content Graph, `DOC-API-003` exemplo que envelheceu em relação ao schema, `DOC-SNIPPET-001` blocos marcados como executáveis, `DOC-LINK-003` link externo morto.

**Duas decisões que valem explicação.** A primeira: a execução de snippets **não** é ligada por padrão. Rodar código vindo de arquivo de conteúdo é execução arbitrária — quem escreve documentação passaria a rodar qualquer coisa na máquina de quem testa, e em CI é porta aberta. O que roda é a verificação estrutural; cada bloco aparece como pulado dizendo isso. A segunda: `403` e `429` em link externo não reprovam. Sites bloqueiam robôs, e transformar isso em falha ensina a equipe a ignorar o relatório inteiro — só `404`, `410` e `5xx` são evidência de link morto.

Teste pulado não reprova e também não conta como passado: aparece no relatório com o motivo. A tela de revisão do editor roda o perfil `standard` sobre os arquivos do PR, mostra as falhas com arquivo e linha, e as leva para o corpo do pull request. Quando a suíte não consegue rodar, a tela diz isso — não "aprovado". Guia em [/guides/testes-de-documentacao/](src/content/docs/guides/testes-de-documentacao.mdx).

## Análise de impacto

O Content Graph responde "quem usa o quê" — informação. O Impact Engine responde "se eu mudar isso, o que preciso revisar?" — decisão. Ele aparece no editor (painel de referências, botão **Impacto**, sob demanda e antes de salvar) e na revisão do PR, cujo corpo passa a trazer contagem por severidade, Impact Score, escopo estimado, quebras de contrato de API e checklist.

Quatro severidades: 🔴 crítico é o que pode **invalidar** a documentação (endpoint removido, bloco incluído que deixou de existir), 🟠 alto provavelmente exige revisão, 🟡 médio é potencialmente relevante, 🟢 baixo não tem impacto funcional. `critical` fica reservado ao que torna o texto publicado falso, não ao que dá trabalho — classificar tudo como crítico é o mesmo que não classificar nada. A severidade cai com a distância no grafo.

**Dependência indireta é a razão de o motor existir.** `guides/conteudo-reutilizavel.mdx` inclui `api-essentials`, que inclui `authentication-warning`; editar o último altera o texto publicado da página, e **não existe aresta entre os dois**. A contagem de um salto que havia antes respondia "nenhuma página afetada" — com convicção e errada. O relatório mostra por onde o impacto passou, porque "revise esta página" sem o caminho é um palpite pedindo confiança.

O diff de API compara a especificação **interpretada**, não o texto: reordenar chaves do YAML são vinte linhas no `git diff` e mudança nenhuma, renomear um parâmetro é uma linha e quebra total. Renome é reconhecido como renome (`id → userId`) quando lugar, tipo e obrigatoriedade batem. São quebra: operação removida, parâmetro removido/renomeado/com tipo novo/que passou a obrigatório, corpo obrigatório, autenticação diferente, URL base diferente, resposta `2xx` que saiu. Não são: operação nova, opcional novo, obrigatório que relaxou, resposta nova, depreciação. A ligação página↔operação vem primeiro do que é **declarado** (`<TryIt schema=… operation=…/>`) e só depois do caminho literal no texto.

O Impact Score (0–100) traz **cada fator com os pontos e o motivo** — um número que ninguém consegue conferir é o tipo de métrica que a equipe ignora na terceira vez que discorda da intuição. Sem consequência apurada o score é zero, inclusive o fator de tamanho: um PR que só mexe em `astro.config.mjs` não tem nada a revisar na documentação. No checklist entra só o que se consegue conferir — uma página, uma operação, um termo; "revisar a documentação" não é item de checklist. Guia em [/guides/analise-de-impacto/](src/content/docs/guides/analise-de-impacto.mdx).

## Confiança e proveniência

Toda afirmação importante da documentação deveria ter evidência. Uma página pode dizer "chaves de API expiram em 90 dias" sem que exista em lugar nenhum o registro de onde isso veio, quem confirmou e quando — enquanto for verdade ninguém nota, e quando deixar de ser ninguém descobre.

**O limite do selo, primeiro, porque é o que o impede de virar conforto falso.** "Verificado" quer dizer que a evidência citada **existe e confere** onde é possível comparar: o endpoint existe na especificação, o arquivo e a linha existem no código, o id de teste existe na suíte. **Não** quer dizer que a frase é verdadeira.

A proveniência é declarada no próprio conteúdo, versionada no Git — em banco separado ela divergiria do conteúdo no primeiro `git revert`, e divergindo deixa de ser evidência. Duas granularidades: bloco `provenance:` no frontmatter para a página, comentário antes do parágrafo para a afirmação. Em `.md` o comentário é `<!-- -->`; em `.mdx` é `{/* */}`, porque MDX tenta ler comentário HTML como JSX e o build falha.

Quatro estados. **Verificado** (a evidência confere e a confirmação está no prazo), **vencido** (confere, confirmação passou do prazo), **não verificado** (declarado sem data, ou nunca confirmado), **evidência inválida** (não confere). Duas regras que decidem casos reais: evidência inválida com data de ontem continua inválida — a data só documenta que a conferência não olhou o que devia; e evidência que confere mas nunca foi confirmada não é "verificada", porque ninguém assinou embaixo.

O prazo padrão fica em `trust.yml`: 180 dias, que é o que uma equipe consegue honrar. Prazo curto transforma o portal num mar de avisos amarelos que ninguém lê; prazo longo deixa a página envelhecer exibindo selo de verificada.

O **Trust Score** (0–100) combina validade da fonte, cobertura por teste, frescor e responsável. Página sem afirmação recebe zero — dar nota cheia à ausência de evidência premiaria o que a camada existe para corrigir. Ele aparece **ao lado** do Quality Score em Settings → Quality, nunca dentro: misturar os dois faria uma página impecavelmente escrita e sem evidência parecer pior do que é.

No **assistente**, a confiança ajusta a relevância sem substituí-la, e conteúdo vencido não é escondido — é a melhor informação que o portal tem, e a resposta sai com o aviso na frente, não no rodapé. No **MCP**, `get_document` devolve `trust` com `checked: "declaracao"`: o leitor Python lê o que a página declara e confere a data, mas não resolve evidência, e por isso nunca reporta `invalid`. Guia em [/guides/confianca-e-proveniencia/](src/content/docs/guides/confianca-e-proveniencia.mdx).

## Observabilidade e SLOs

O linter mede escrita, a suíte mede comportamento, o Impact Engine mede consequência, o Trust mede evidência, o Twin mede cobertura, o Contract mede fidelidade ao contrato. Nenhum deles responde à pergunta de segunda-feira: **a documentação está saudável, e o que fazemos primeiro?** É o que **Settings → Health** e `npm run docs:health` montam.

**Ela não mede nada de novo** — e isso é requisito, não estilo. Quando a camada foi estendida para observabilidade, o cálculo próprio de cobertura de API que ela tinha foi **removido** e substituído pela consulta ao Digital Twin: duas contas para o mesmo número divergem na primeira mudança, e aí ninguém sabe qual acreditar.

Dez dimensões: qualidade, integridade de contrato, cobertura, frescor, confiabilidade, confiança, preparo para IA, consistência, cobertura de testes e acessibilidade. Cada uma mostra **de onde o número veio**. O Health Score é do portal inteiro e não substitui o Quality Score, que continua sendo a nota por página.

**Não medido não é zero.** Dimensão sem dado fica fora da média e entra no SLO como *em risco*, nunca como violação — não se viola um alvo que não foi aferido.

**A idade sozinha não determina obsolescência**, e essa é a regra que separa um indicador útil de um mar de vermelho. Uma página com 200 dias e nenhum sinal de divergência continua atual; a suspeita começa depois de um ano. O que empurra para obsoleta é evidência: contrato quebrado, proveniência que não confere, a API mudando depois da última edição. Uma página editada ontem com contrato quebrado fica vermelha; uma de dois anos, correta e muito lida, fica verde — e o relatório diz por quê.

O **error budget** mostra quanto **resta**, não quanto se gastou: "40% restante" leva a decisão diferente de "3 de 5". Orçamento zero é caso normal — link morto e contrato quebrado não têm cota.

O **snapshot** é a única coisa que esta camada persiste, porque histórico não se deriva; ele guarda números e o commit, nunca conteúdo. A regressão compara com a medição mais **próxima** do alvo e lista só as dimensões que pioraram. Os commits correlacionados são **candidatos**, não causa: a documentação também degrada quando o produto muda e ninguém mexe nela.

`npm run docs:health -- check` serve ao CI (sai com 1 em SLO violado; risco não reprova, senão a equipe afrouxa os alvos até tudo ficar verde), e o PR mostra `antes → depois` — dizendo quando não há base de comparação, em vez de exibir `-0`. Guia em [/guides/observabilidade/](src/content/docs/guides/observabilidade.mdx).

## Documentação adaptativa

Uma fonte de verdade, várias experiências: a mesma página serve a quem programa, a quem atende cliente e a quem opera, **sem duplicar arquivo** — `authentication-developer.md` e `authentication-support.md` divergem no terceiro mês e ninguém percebe qual está certo.

**O limite vem antes da funcionalidade.** Personalização de documentação erra sempre escondendo, então aqui nada é removido: o conteúdo de outra audiência fica recolhido num `<details>` com rótulo, dentro do documento, alcançável por teclado, anunciado por leitor de tela e encontrável pelo Ctrl+F. Vale igual para navegação e recomendações — elas reordenam e destacam, nunca tiram item da lista. É diferente do `<If>` que já existe: aquele resolve em build e **apaga** o trecho, que é o certo para conteúdo interno; aqui o objetivo é publicar tudo e mudar só a ênfase.

As audiências (`developer`, `support`, `product`, `operations`, `ai-agent`) são declaradas no frontmatter, e o conteúdo específico usa `:::audience{type="support"}`. O bloco nasce **aberto**: sem JavaScript a página aparece inteira, porque adaptação é melhoria progressiva. Audiência escrita errada no atributo não faz o texto sumir — perder conteúdo por erro de digitação seria a pior falha possível desta camada.

Quem lê escolhe o perfil na barra lateral; nada é inferido por comportamento, porque adivinhar o papel de alguém e reorganizar a documentação sobre o palpite erra em silêncio. `?audience=support` no link tem precedência sobre o cookie, para "veja isto na visão de suporte" funcionar para quem já tem preferência salva. Sem contexto, a documentação é a de sempre.

No fim da página, **Você também pode precisar de**, montada do Content Graph, das tags e do contexto — cada item dizendo por que apareceu, e restrita ao mesmo idioma. No **assistente**, o contexto entra como enquadramento (recorte e tom), nunca como permissão: a autorização continua acontecendo antes, e nenhuma informação necessária é omitida por parecer de outro perfil. No **MCP**, `search_docs` aceita `audience` e `version`, descarta só o que foi escrito explicitamente para outro público e **recusa** audiência desconhecida em vez de ignorá-la. As analytics registram a distribuição por perfil — contadores, nada mais — e alimentam o Health Center. Guia em [/guides/documentacao-adaptativa/](src/content/docs/guides/documentacao-adaptativa.mdx).

## Digital Twin

O Content Graph responde "quem usa o quê" dentro da documentação. O Twin sobe um nível e responde sobre o **produto**: o que está documentado, o que a documentação descreve e não existe mais, e o que quebra se um endpoint mudar.

**Ele não é fonte de verdade.** A fonte continua sendo o Git — Markdown, OpenAPI, código. O Twin é derivado a cada análise e não persiste nada; se discordar do repositório, quem está errado é o grafo.

O grafo de código desta base é **exato**, não heurístico: a Astro mapeia arquivo para rota de forma determinística, então `src/pages/api/auth/me.ts` que exporta `GET` implementa `GET /api/auth/me`. Cada relação registra se foi `declared` (alguém escreveu a ligação, como um `<TryIt/>`) ou `derived` (convenção) — as duas erram de formas diferentes, e misturá-las impediria julgar o quanto confiar no relatório.

Duas perguntas simétricas com severidades diferentes: **implementação sem documentação** é dívida certa; **documentação sem implementação** é *potencialmente* obsoleta, porque a página pode descrever comportamento histórico, versão anterior, conceito ou algo planejado — um veredito automático aqui viraria alarme falso.

Medir o portal expôs dois defeitos de modelagem que só aparecem com dados reais. `GET /auth/me` da especificação e `GET /api/auth/me` do código eram **dois** endpoints, ambos "não documentados", até o prefixo do servidor entrar na identidade. E as 45 rotas internas do editor derrubavam a cobertura para **6%** — um número que qualquer equipe aprende a ignorar; elas continuam no grafo e saíram da conta via `twin.yml`, com a exceção de que endpoint declarado numa especificação é público por definição.

`npm run twin -- coverage --min 90` serve ao CI (sai com 1 abaixo do mínimo, 0 quando não há o que medir), e a cobertura entra no corpo do PR. **Settings → Intelligence** traz tudo em tabela — um grafo de centenas de nós é bonito na captura de tela e inútil para achar o endpoint que ninguém documentou. Guia em [/guides/digital-twin/](src/content/docs/guides/digital-twin.mdx).

## Contratos de documentação

A Documentation Test Suite pergunta "este exemplo **funciona**?". Esta camada pergunta "este exemplo representa o **contrato** de verdade?". O caso que separa as duas: a API exige `amount` e `currency`, a documentação mostra só `amount` — o exemplo até roda, e está incompleto em relação ao contrato.

Verifica método, caminho, parâmetros, códigos de status, autenticação, requisição, resposta e exemplos de código. A comparação com o schema corre nos **dois sentidos**, e o segundo é o que quase nenhuma ferramenta faz: campo que o exemplo mostra e o contrato não tem. É assim que documentação envelhece sem quebrar — ela continua exibindo um campo que a API removeu, e todo teste de execução continua passando. Numa requisição, campo a mais é aviso; numa resposta é quebra, porque a página está prometendo ao leitor um dado que não vem.

A associação página↔contrato vem do **Digital Twin** (§25: esta camada não mantém grafo próprio), com `contract:` no frontmatter quando a inferência não basta. Contrato sem página fica **desconhecido**, nunca válido: ele não está certo, está sem documentação — e contá-lo como válido inflaria o score com endpoints que ninguém documentou. No score, `unknown` fica fora da conta e `warning` conta como verificado sem contar como bom.

No merge, **só `invalid` bloqueia** (`failOnBreaking` em `contracts.yml`). Travar merge por aviso leva a equipe a desligar o portão inteiro. Para APIs sem OpenAPI completo há baseline declarável, que é o caminho de adoção gradual.

Rodar contra o portal expôs um defeito que nenhum teste sintético pegaria: em JavaScript `$` não casa antes de `
` e `.` não consome `
`, então a extração de cabeçalhos HTTP devolvia lista vazia em **todo** arquivo de um checkout no Windows — que é como este repositório está. Guia em [/guides/contratos-de-documentacao/](src/content/docs/guides/contratos-de-documentacao.mdx).

## Lacunas de documentação

Saber que uma página teve dez mil acessos não diz o que falta. Esta camada pergunta **que informação as pessoas procuram e não encontram**, cruzando busca, assistente, MCP, feedback, contratos e o Digital Twin num backlog priorizado — em Settings → Gaps e em `npm run gaps`.

**Publicar não é resolver**, e é a regra que dá sentido ao resto. `start` registra o sinal de hoje como linha de base; depois de publicar, `resolve` compara — e **recusa** se as consultas e as respostas sem lastro não caíram pelo menos dois terços. Não se exige queda a zero: a pergunta continua sendo feita mesmo quando a resposta existe.

Seis tipos, cada um levando a uma ação diferente: falta documentação, incompleta, desatualizada (quando o Twin ou o Contract acusam divergência), pouco clara, difícil de achar (mexer na navegação, não no texto) e contraditória. O score combina demanda, falha do assistente, cobertura baixa, insatisfação e contrato quebrado — este último pesando muito, porque documentação que diverge do produto é **pior** que ausente: ela leva a pessoa a errar com confiança.

Rodar contra o portal expôs dois erros de medição que só aparecem com dados reais. **Cobertura não é relevância de busca**: o BM25 normaliza pelo melhor resultado, então "como rotacionar a chave de API" — assunto sobre o qual não existe uma linha aqui — foi classificada como *difícil de achar* com 100% de cobertura; agora o que se mede é a presença dos termos da pergunta nas páginas. E o agrupamento precisava de **dois** conjuntos de termos: a interseção admite variações no grupo, mas medir cobertura por ela reduzia "rotacionar a chave de api" a `chave, api`, que o portal documenta.

A privacidade segue a decisão anterior: texto das perguntas desligado por padrão, e mesmo ligado só a pergunta **sem resposta**, sem quem perguntou, truncada e com credenciais redigidas. Desligado, a camada funciona com os sinais estruturais e diz na primeira linha que está trabalhando com menos. Guia em [/guides/lacunas-de-documentacao/](src/content/docs/guides/lacunas-de-documentacao.mdx).

## Feedback de página

No fim de cada página de documentação há um widget **"Esta página foi útil?"** com sim/não e um campo opcional de comentário. A Starlight não traz um componente de feedback nem plugin oficial — o caminho que ela indica é sobrescrever `Footer`, que é o que o projeto faz. As alternativas de mercado são SaaS de terceiros; aqui o retorno dos seus leitores fica no próprio projeto.

O envio é **anônimo**: sem login, sem cookie, sem identificador de visitante. Grava-se caminho, voto, idioma e o comentário; o IP serve só ao limite de envio e não é armazenado.

As respostas ficam em **Settings → Feedback**: proporção de "útil", comentários recentes e **onde mexer primeiro** — páginas com maioria negativa e pelo menos 3 votos, para uma reclamação isolada não mandar o time reescrever conteúdo.

Com a integração do Do11y ligada, o mesmo clique também vira um evento `feedback` no Supabase. Detalhes em [docs/feedback-de-pagina.md](docs/feedback-de-pagina.md).

## Navegação

O menu fica no topo, não numa coluna lateral, e é montado a partir da mesma
árvore que a Starlight gera das pastas de conteúdo: cada pasta de primeiro nível
vira um item, e as páginas de dentro formam o submenu. Nenhum item é escrito à
mão — criar uma página basta para ela aparecer.

A barra lateral continua existindo, mostrando **só a seção aberta** — o arranjo
do portal da OpenAI usado como referência. O topo diz onde você pode ir; a
lateral, onde você está. Mostrar a árvore inteira nos dois lugares repetiria a
mesma informação e gastaria a altura da tela com seções que não estão sendo
lidas.

O estreitamento acontece em [route-middleware.ts](src/lib/nav/route-middleware.ts),
pelo ponto de extensão que a Starlight documenta para modificar dados de rota. A
árvore completa é guardada em `locals.topNav` antes do corte: o cabeçalho precisa
dela inteira, a lateral só do galho atual. Páginas fora de qualquer seção — a
capa — não têm lateral, e aí `hasSidebar` é desligado de fato, o que é diferente
de esconder com CSS: a coluna deixa de ser reservada.

Dois efeitos que vieram junto e precisaram de decisão:

- **Profundidade.** A lateral aninhava sem limite; um menu suspenso dentro de
  outro é difícil de operar com mouse e pior com teclado. A árvore é achatada em
  dois níveis, e o subgrupo vira um título dentro do painel. A lógica está em
  [top-nav.ts](src/lib/nav/top-nav.ts), separada do componente para ser testável.
- **Medida de leitura.** Sem barra lateral, a Starlight aplica a medida larga que
  reserva para páginas de capa — 1080px de linha na documentação. O CSS do
  projeto devolve a medida normal às páginas sem hero.

O menu funciona sem JavaScript: cada submenu é um `<details>`. O script só
acrescenta o que o HTML não dá — fechar ao clicar fora, fechar com `Esc`
devolvendo o foco, e manter um submenu aberto por vez.

## Assistente de documentação

O mesmo pipeline atende os dois modos, e o modelo é a **última** etapa, não a
espinha:

```text
entrada → guardrails → recuperação → autorização → contexto → modelo
        → guardrails de saída → validação de citação → resposta
```

Sem `ANTHROPIC_API_KEY` no ambiente, a etapa do modelo não roda e a resposta são
os trechos com um resumo extrativo. Não é modo degradado: é a configuração
padrão, e a única **imune por construção** a alucinação e a injeção indireta,
porque não há nada a instruir.

### As decisões que valem registro

**A autorização vem antes do contexto.** Filtrar depois da geração significaria
que o modelo já leu o que a pessoa não pode ver — e uma resposta filtrada ainda
vazaria pela forma como foi escrita. O gancho `authorize` roda sobre os trechos
recuperados, antes de qualquer coisa chegar ao prompt.

**Confiança baixa não gera.** Gerar a partir de evidência fraca é exatamente
onde um assistente inventa. Abaixo do limiar, o pipeline devolve os trechos e
diz que não encontrou o suficiente — os trechos continuam ali para quem quiser
julgar sozinho.

**Citação inventada derruba o texto.** Se a resposta cita uma página que não
entrou no contexto, o texto gerado é descartado e os trechos assumem. Uma
citação falsa é pior que nenhuma: dá aparência de fundamento a uma frase que não
tem.

**A credencial vive no ambiente.** Não em `integrations.json`, pelo mesmo motivo
do Algolia e do GitHub: segredo em arquivo de configuração acaba num backup, num
log ou numa resposta de API.

**Falha do provedor não vira resposta inventada.** Cai nos trechos, que
continuam sendo uma resposta útil.

Cada intervenção de guardrail vira evento de auditoria com o tipo, nunca com o
conteúdo da conversa.

### O que ficou de fora

Sugestões de pergunta por página (§14) e o botão "perguntar sobre esta página"
(§15) não foram implementados. O resumo de conversa longa continua sendo o
recorte das mensagens recentes, não um resumo gerado.

## Versionamento

`versions.yml` é o registro: quais versões existem, em que estado cada uma está
e de que branch ou tag cada uma vem.

```yaml
versions:
  - id: v2
    label: Versão 2
    status: current
    branch: master
  - id: v1
    label: Versão 1
    status: deprecated
    branch: docs/v1
    supersededBy: v2
```

O ciclo de vida vai de `draft` a `archived`, passando por `current`,
`maintained` e `deprecated`. Só pode haver **uma** versão `current` — duas
versões "atuais" é uma pergunta sem resposta para quem chega. `draft` e
`archived` ficam fora do seletor sem sair do registro.

Um registro inválido **derruba o build**, de propósito: id que não serve para
URL, duas versões atuais, sucessora inexistente, branch e tag na mesma versão.
Um seletor que leva a 404 é pior que um build vermelho.

A versão `current` é a raiz do site e não recebe prefixo — `/guides/auth/` é
sempre a atual, e `/v1/guides/auth/` é a antiga. A URL curta é a que se
compartilha, e ela deve continuar apontando para o que vale hoje.

Uma versão `deprecated`, `archived` ou `draft` mostra um aviso no topo da
página, com link para a sucessora quando existe.

### O que está feito e o que não está

Feito: o registro com validação e ciclo de vida, a resolução de versão a partir
da URL, o aviso de versão obsoleta, o redirecionamento opcional, e o
`starlight-versions` alimentado pelo registro em vez de um segundo arquivo.

**Não feito**, e a spec pede: Content Graph, glossário, linter, API Reference,
assistente e MCP ainda não recebem a versão — eles operam sobre o conteúdo atual.
Também não existem a comparação entre versões nem a interface de criação. O
snapshot de conteúdo por versão é do `starlight-versions` e depende do comando
dele; o registro já está pronto para alimentá-lo.

## Documentação legível por máquina

O portal publica três coisas para agentes, IDEs e sistemas RAG, todas derivadas
do conteúdo — nenhuma escrita à mão:

| Saída | O quê |
| --- | --- |
| `/llms.txt` | Índice: seções, páginas, glossário, operações da API e blocos reutilizáveis com quantas páginas os usam |
| `/llms-full.txt` | O conteúdo inteiro. `LLMS_FULL=false` desliga |
| `/md/<caminho>.md` | Markdown limpo de cada página |

O Markdown limpo tira o maquinário do MDX — imports, tags de componente,
sintaxe de aside — e **preserva o texto que estava dentro** desses componentes:
descartá-lo entregaria uma versão incompleta da página.

O prefixo é `/md/` e não `.md` no caminho original porque a Starlight já é dona
das rotas de documentação, e duas URLs para a mesma página confundem buscador.

### MCP

O servidor em `mcp-docs/` expõe 12 tools. Além das quatro de documentação que já
existiam, entraram:

| Tool | Fonte |
| --- | --- |
| `get_page`, `get_section` | páginas do portal |
| `get_glossary_term`, `search_glossary` | `src/content/glossary/` |
| `search_api`, `get_api_endpoint` | `src/schemas/*.yaml` |
| `get_changelog` | `src/content/docs/changelog/` |
| `check_documentation` | o linter do portal |

Cada uma **lê** a fonte que já tem dono; nenhuma guarda cópia. Todo texto passa
pelo mesmo tratamento das tools de documentação: uma página com "ignore as
instruções anteriores" volta como texto marcado, não como comando.

`check_documentation` é a única que inicia um processo — ela chama a CLI do
linter, porque reimplementá-lo em Python criaria duas verdades sobre o que é uma
boa página. Comando fixo, argumentos em lista, sem shell, caminho validado antes.

**O que ainda não existe:** o MCP não aplica o RBAC do portal (§11 da spec) nem
registra identidade de cliente na auditoria (§13). Em modo stdio o servidor roda
como o processo de quem o iniciou e não tem noção de usuário; ligar isso exige o
modo remoto com token mapeado para um usuário do portal. Até lá, o servidor
enxerga tudo o que o sistema de arquivos enxerga.

## API Explorer

A referência de API deixou de ser só leitura: em [`/api-reference/explorer/`](src/content/docs/api-reference/explorer.mdx)
dá para preencher parâmetros, enviar a chamada e ver a resposta.

Os formulários vêm da especificação OpenAPI em `src/schemas/`. Nenhum campo é
escrito à mão — trocar a especificação muda o Explorer e a referência juntos.

| Arquivo | Papel |
| --- | --- |
| `src/lib/api-explorer/model.ts` | Lê o OpenAPI e produz as operações |
| `src/lib/api-explorer/request.ts` | Monta o pedido a partir do formulário |
| `src/lib/api-explorer/snippets.ts` | Gera cURL, JavaScript, Python e Go |
| `src/lib/api-explorer/proxy-policy.ts` | Decide o que o proxy pode buscar |
| `src/pages/api/explorer/request.ts` | O proxy |

### O proxy é a parte que precisa de cuidado

O "Try it" precisa de um proxy porque a maioria das APIs não aceita chamadas de
outro domínio. E um proxy que aceita qualquer URL **é** um SSRF: o servidor do
portal viraria intermediário para tudo que ele alcança, rede interna inclusive.

A regra é a mais estreita que ainda serve: **só os servidores declarados na
especificação**, que é arquivo versionado. Liberar um destino novo exige editar
o arquivo e passar por revisão, não mudar um parâmetro. Além disso: esquema
diferente de HTTP é recusado, credencial embutida na URL é recusada, endereço de
rede interna é recusado mesmo se declarado, e redirecionamento não é seguido.

### Credenciais

Ficam apenas no estado do componente: não vão para `localStorage`, não entram no
histórico de chamadas e não aparecem nos exemplos de código, onde um marcador as
substitui. O log do proxy redige cabeçalhos de credencial pelo nome.

Os exemplos são gerados a partir da **mesma** função que monta o envio. Se
divergissem, o exemplo copiado falharia no terminal depois de funcionar na tela.

### A API de demonstração é real

`src/schemas/portal-api.yaml` descreve endpoints do próprio portal — os que a
interface usa. Uma especificação de exemplo com endpoints inventados
demonstraria a ferramenta e mentiria sobre o produto.

## Workflow de Git

O editor deixou de apenas *mostrar* o estado do Git e passou a operá-lo: criar
branch, ver o diff, rodar o portão de qualidade e preparar o pull request, sem
sair da tela onde o texto foi escrito.

| Camada | Onde | O quê |
| --- | --- | --- |
| Branches | `src/lib/git/workflow.ts` | listar, criar, trocar, renomear, apagar |
| Diff | `src/lib/git/diff.ts` | leitura do diff unificado, com renomeação e binário |
| Pull request | `src/lib/git/pull-request.ts` | portão de qualidade, impacto no conteúdo, criação |
| Interface | `src/components/editor/GitWorkflowModal.tsx` | o painel no editor |

### Três decisões

**Nada passa por shell.** Todo comando usa `execFile` com lista de argumentos.
Um nome de branch vindo da interface é dado, não instrução — sem shell,
`; rm -rf` é apenas um nome inválido. A validação de nome existe para dar erro
claro, e segue as regras do Git sem inventar restrições próprias.

**O diff inclui o que ainda não foi commitado.** Quem escreve no editor tem
alterações salvas em arquivo e não commitadas; um diff que as escondesse
mostraria uma revisão diferente da que existe no disco.

**A revisão e o merge acontecem no provedor.** O portão de qualidade é nosso e
roda local; o pull request vive no GitHub, que é onde a equipe já revisa código.
Reimplementar revisão aqui seria um GitHub pior e desconectado.

### O que o PR informa antes de alguém abrir os arquivos

Nota do linter (a **menor** das páginas alteradas, não a média — uma página ruim
entre dez boas continua ruim), lista dos arquivos por tipo, e o **impacto no
Content Graph**: as páginas que mudam porque um bloco reutilizável mudou e que,
por isso, **não aparecem no diff**.

### Credencial

`GITHUB_TOKEN` no ambiente permite criar o PR direto. Sem ele, o botão abre a
tela de comparação do provedor com título, descrição e resumo já preenchidos —
o trabalho de preparação não se perde por falta de token.

## Glossário

Os termos ficam em `src/content/glossary/`, um arquivo Markdown por termo,
versionados pelo Git. Um termo cadastrado é destacado automaticamente nas
páginas, explicado numa bolha, listado em [`/glossary`](src/pages/glossary/) e
**usado pelo linter** para avaliar consistência de terminologia.

O guia de uso é [Mantenha o glossário](src/content/docs/guides/glossario.mdx). O
que segue é a arquitetura.

### O glossário é a fonte, o linter é consumidor

```text
        GlossDefs (src/content/glossary/*.md)
                     │
              Glossary Index
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
   Transformer                  Linter
   (destaque)              (Consistência)
```

Não existe uma nota "glossário" no linter: terminologia inconsistente **é**
consistência, e separá-la em duas notas esconderia o problema.

| Arquivo | Papel |
| --- | --- |
| `src/lib/glossary/types.ts` | O modelo, compartilhado pelos dois consumidores |
| `src/lib/glossary/index-build.ts` | Índice e busca de ocorrências |
| `src/lib/glossary/loader.ts` | Leitura do disco, com cache |
| `src/lib/glossary/remark-glossary.ts` | Transformer sobre o AST |
| `src/lib/linter/rules/glossary.ts` | Regras `CONSISTENCY-002` a `005` |

### Três decisões que valem registro

**O destaque acontece no AST, não no HTML.** Uma expressão regular sobre o HTML
final não distingue `OAuth` dentro de um `<code>`, de um `<a>` ou de um `<h2>` —
e ignorar esses três é requisito. No AST cada nó já diz o que é.

**Uma varredura, não uma por termo.** O índice ordena as formas da mais longa
para a mais curta, e cada posição do texto é testada uma vez. A ordem *é* a
regra de desempate: `API Gateway` vem antes de `API`, então a busca encontra a
maior primeiro. Com 100 termos isso é imperceptível.

**A bolha recebe texto puro.** A definição vai para um atributo e é escrita com
`textContent` — uma definição não consegue executar script na página nem que
tente. A formatação completa fica na página do termo, onde o pipeline do Astro
a renderiza com a sanitização de sempre.

### A numeração das regras

A spec numera de 001 a 005, mas `CONSISTENCY-001` já existia no portal (grafia
inconsistente na página), que é o conceito da `CONSISTENCY-003` da spec.
Renumerar quebraria configurações e histórico, então as regras novas ocupam
002–005. O mapa está no cabeçalho de `src/lib/linter/rules/glossary.ts`.

### O plugin avaliado antes

`@simonhyll/starlight-glossary` foi examinado antes de escrever qualquer código,
como a spec exige. Está em `0.1.0-alpha`, publicado em junho de 2024, com 148
linhas no total: o schema de configuração é um objeto vazio, `libs/content.ts`
tem uma linha, e a rota do glossário devolve conteúdo fixo de exemplo
("Semver", "This is some content") em vez de ler termos.

Não há matcher, tooltip, aliases nem transformer de AST — ou seja, nenhum dos
requisitos obrigatórios da avaliação. Daí o transformer próprio.

## Atualizações recentes

[`/atualizacoes`](src/pages/atualizacoes.astro) lista as páginas alteradas nos
últimos 30 dias, da mais recente para a mais antiga, agrupadas por dia.

A data vem do **Git**, não do `mtime`: o `mtime` muda a cada clone ou `npm ci`,
e num servidor de CI todos os arquivos teriam a data de agora. Um clone raso
(`fetch-depth: 1`) não tem histórico — nesse caso a página cai para o sistema de
arquivos e **avisa na tela** que as datas não são as das alterações.

A sugestão de montar a estrutura a partir de um `index` por pasta não se aplica
aqui: só os diretórios de idioma têm um. O agrupamento usa a própria pasta, que
é de onde a Starlight já deriva as seções.

## Busca

Dois provedores, escolhidos por ambiente:

| Provedor | Quando | Índice |
| --- | --- | --- |
| **Pagefind** (padrão) | sem credenciais do Algolia | gerado no build, sem serviço externo |
| **Algolia DocSearch** | com `ALGOLIA_APP_ID`, `ALGOLIA_SEARCH_API_KEY` e `ALGOLIA_INDEX_NAME` | hospedado no Algolia |

As credenciais são suas e ficam no ambiente, nunca no repositório. Use a chave
**Search-Only**: ela é pública por natureza, vai para o navegador e só lê o
índice. A chave de Admin escreve no índice e não deve aparecer no cliente.

É tudo ou nada: com uma variável faltando, o portal fica no Pagefind em vez de
carregar um widget que falharia na primeira busca.

Três detalhes que essa troca envolve:

- O `Search` é um override nosso, porque o assistente de documentação fica ao
  lado da busca. Por isso o `starlight-docsearch` avisa no build que não vai
  substituir o componente — é esperado, e a composição está em
  [Search.astro](src/components/Search.astro). Remover o override para calar o
  aviso tiraria o assistente do cabeçalho.
- O Pagefind continua sendo gerado mesmo com o Algolia ativo: a busca "warp"
  (`/warp?q=termo`) consulta aquele índice local.

O índice do Algolia precisa ser alimentado pelo crawler do DocSearch, que é
configurado na conta do Algolia — o portal só consulta.

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

