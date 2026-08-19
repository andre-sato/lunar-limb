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
| `npm run agent` | Agentes de documentação: pesquisa, rascunho, validação. |
| `npm run history` | Time Machine: timeline, snapshot, comparação e restore. |
| `npm run docs:code` | Vínculo com o código: impacto, cobertura, órfãos e entidades sem documentação. |
| `npm run governance` | Governança: donos, revisões pendentes, aprovações e auditoria. |
| `npm run analytics` | Observabilidade de leitura: busca, jornadas, abandono e lacunas comportamentais. |
| `npm run ai:eval` | Avaliação do assistente: conjuntos de perguntas, métricas verificáveis e regressão. |
| `npm run graph` | Knowledge Graph: consulta, impacto e frescor. |
| `npm run org` | Organização: repositórios, produtos, saúde agregada e busca global. |
| `npm run heal` | Self-healing: detectar, diagnosticar, propor e validar correções. |
| `npm run sdk` | SDK: gerar, verificar e comparar o cliente TypeScript da API. |
| `npm run docs:asyncapi` | Gera páginas de referência a partir de especificações AsyncAPI. |
| `npm run user:create` | Cria um usuário do portal (ver *Usuários e controle de acesso*). |

> **Comece pelo [Manual completo](src/content/docs/guides/manual.mdx)** (publicado em `/guides/manual/`): recursos do portal e do editor, atalhos de teclado, fluxos de trabalho e casos de uso, com diagramas.

## Arquitetura e decisões

- **[docs/arquitetura.md](docs/arquitetura.md)** — o portal nos níveis do
  [modelo C4](https://c4model.com/): contexto, contêineres, componentes e dois
  diagramas dinâmicos (o portão de pull request e o ciclo de self-healing).
- **[docs/adr/](docs/adr/)** — 16 Architectural Decision Records. Cada uma
  registra uma decisão, o que ela custou, o que foi descartado e — quando a
  decisão nasceu de um defeito observado — o defeito.

A distinção entre os dois vale saber: a arquitetura descreve como o sistema é
hoje e muda quando ele muda; uma ADR descreve por que ele ficou assim e não muda
nunca. Quando a decisão é revista, a ADR antiga é marcada como substituída e uma
nova é escrita.

## Recursos

Cada recurso tem um guia próprio no portal publicado. As seções abaixo dão o
resumo e o link.

Para ver todos operando ao mesmo tempo sobre um produto fictício, veja a
**[vitrine de recursos](src/content/docs/exemplos/index.mdx)** (publicada em `/exemplos/`).

### Autoria

_Escrever, revisar e reaproveitar conteúdo._

#### Editor de documentação

Um editor Markdown/MDX completo em `/editor`, com Monaco, preview em tempo real, reuso de conteúdo, grafo de dependências bidirecional, paleta de comandos e consciência de Git. Ele lê e grava os arquivos de `src/content/docs` diretamente — não há banco de dados no meio.

Detalhes em **[Editor de documentação](/guides/editor/)**.

#### Linter e Quality Score

Um revisor editorial automatizado que aponta problemas com id estável e calcula uma nota de 0 a 10 por dimensão. O style guide fica versionado em Git, e a nota não é `10 − nº de erros`: cada dimensão é pontuada isoladamente e o dano é normalizado por tamanho.

Detalhes em **[Linter e Quality Score](/guides/linter-e-quality-score/)**.

#### Navegação

Sidebar por diretório, breadcrumbs, paginação, índice da página e navegação por tags — tudo derivado da estrutura de arquivos, sem um índice paralelo para manter sincronizado.

Detalhes em **[Navegação](/guides/navegacao/)**.

#### Documentação adaptativa

Uma fonte de verdade, várias experiências: a mesma página serve a quem programa, a quem atende cliente e a quem opera, **sem duplicar arquivo** — `authentication-developer.md` e `authentication-support.md` divergem no terceiro mês e ninguém percebe qual está certo.

**O limite vem antes da funcionalidade.** Personalização de documentação erra sempre escondendo, então aqui nada é removido: o conteúdo de outra audiência fica recolhido num `<details>` com rótulo, dentro do documento, alcançável por teclado, anunciado por leitor de tela e encontrável pelo Ctrl+F. Vale igual para navegação e recomendações — elas reordenam e destacam, nunca tiram item da lista. É diferente do `<If>` que já existe: aquele resolve em build e **apaga** o trecho, que é o certo para conteúdo interno; aqui o objetivo é publicar tudo e mudar só a ênfase.

As audiências (`developer`, `support`, `product`, `operations`, `ai-agent`) são declaradas no frontmatter, e o conteúdo específico usa `:::audience{type="support"}`. O bloco nasce **aberto**: sem JavaScript a página aparece inteira, porque adaptação é melhoria progressiva. Audiência escrita errada no atributo não faz o texto sumir — perder conteúdo por erro de digitação seria a pior falha possível desta camada.

Quem lê escolhe o perfil na barra lateral; nada é inferido por comportamento, porque adivinhar o papel de alguém e reorganizar a documentação sobre o palpite erra em silêncio. `?audience=support` no link tem precedência sobre o cookie, para "veja isto na visão de suporte" funcionar para quem já tem preferência salva. Sem contexto, a documentação é a de sempre.

No fim da página, **Você também pode precisar de**, montada do Content Graph, das tags e do contexto — cada item dizendo por que apareceu, e restrita ao mesmo idioma. No **assistente**, o contexto entra como enquadramento (recorte e tom), nunca como permissão: a autorização continua acontecendo antes, e nenhuma informação necessária é omitida por parecer de outro perfil. No **MCP**, `search_docs` aceita `audience` e `version`, descarta só o que foi escrito explicitamente para outro público e **recusa** audiência desconhecida em vez de ignorá-la. As analytics registram a distribuição por perfil — contadores, nada mais — e alimentam o Health Center. Guia em [/guides/documentacao-adaptativa/](src/content/docs/guides/documentacao-adaptativa.mdx).

#### Busca

Busca local com Pagefind por padrão, Algolia DocSearch opcional, e a busca "warp drive" que cai direto no melhor resultado.

Detalhes em **[Busca](/guides/busca/)**.

#### Versionamento da documentação

Versões da documentação com seletor, aviso de versão antiga e congelamento. A versão é um diretório de conteúdo, não um branch — o que permite ler duas versões lado a lado.

Detalhes em **[Versionamento da documentação](/guides/versionamento/)**.

#### Glossário

Os termos ficam em `src/content/glossary/`, um arquivo Markdown por termo, versionados pelo Git.
Um termo cadastrado é destacado automaticamente nas páginas, explicado numa bolha, listado em
`/glossary` e **usado pelo linter** para avaliar consistência de terminologia — o glossário é a
fonte, e o linter é consumidor dela.

Guia de uso: **[Mantenha o glossário](/guides/glossario/)**. Arquitetura: [docs/glossario.md](docs/glossario.md).

#### Testes de documentação

O linter pergunta "isto está bem escrito?". A suíte de testes pergunta "isto **funciona**?" — e é a pergunta que o linter nunca responde. Um link para uma página inexistente passa em qualquer regra de estilo; um exemplo de resposta que não bate mais com o schema está impecavelmente redigido.

```bash
npm run docs:test
```

Três perfis, do mais barato ao mais caro: `quick` (padrão — links, âncoras, Content Graph, sem rede), `--standard` (mais exemplos de API e estrutura de snippets) e `--strict` (mais links externos, com rede). `--changed` restringe ao que o Git aponta, `--file <caminho>` a uma página, `--json` serve CI. Saída `0` aprovado, `1` falha, `2` opção inválida, `3` execução.

As regras: `DOC-LINK-001` link interno para página inexistente, `DOC-LINK-002` âncora inexistente (a âncora do link passa pela mesma normalização dos títulos, acento incluído), `DOC-GRAPH-001` referência quebrada no Content Graph, `DOC-API-003` exemplo que envelheceu em relação ao schema, `DOC-SNIPPET-001` blocos marcados como executáveis, `DOC-LINK-003` link externo morto.

**Duas decisões que valem explicação.** A primeira: a execução de snippets **não** é ligada por padrão. Rodar código vindo de arquivo de conteúdo é execução arbitrária — quem escreve documentação passaria a rodar qualquer coisa na máquina de quem testa, e em CI é porta aberta. O que roda é a verificação estrutural; cada bloco aparece como pulado dizendo isso. A segunda: `403` e `429` em link externo não reprovam. Sites bloqueiam robôs, e transformar isso em falha ensina a equipe a ignorar o relatório inteiro — só `404`, `410` e `5xx` são evidência de link morto.

Teste pulado não reprova e também não conta como passado: aparece no relatório com o motivo. A tela de revisão do editor roda o perfil `standard` sobre os arquivos do PR, mostra as falhas com arquivo e linha, e as leva para o corpo do pull request. Quando a suíte não consegue rodar, a tela diz isso — não "aprovado". Guia em [/guides/testes-de-documentacao/](src/content/docs/guides/testes-de-documentacao.mdx).

#### Contratos de documentação

A Documentation Test Suite pergunta "este exemplo **funciona**?". Esta camada pergunta "este exemplo representa o **contrato** de verdade?". O caso que separa as duas: a API exige `amount` e `currency`, a documentação mostra só `amount` — o exemplo até roda, e está incompleto em relação ao contrato.

Verifica método, caminho, parâmetros, códigos de status, autenticação, requisição, resposta e exemplos de código. A comparação com o schema corre nos **dois sentidos**, e o segundo é o que quase nenhuma ferramenta faz: campo que o exemplo mostra e o contrato não tem. É assim que documentação envelhece sem quebrar — ela continua exibindo um campo que a API removeu, e todo teste de execução continua passando. Numa requisição, campo a mais é aviso; numa resposta é quebra, porque a página está prometendo ao leitor um dado que não vem.

A associação página↔contrato vem do **Digital Twin** (§25: esta camada não mantém grafo próprio), com `contract:` no frontmatter quando a inferência não basta. Contrato sem página fica **desconhecido**, nunca válido: ele não está certo, está sem documentação — e contá-lo como válido inflaria o score com endpoints que ninguém documentou. No score, `unknown` fica fora da conta e `warning` conta como verificado sem contar como bom.

No merge, **só `invalid` bloqueia** (`failOnBreaking` em `contracts.yml`). Travar merge por aviso leva a equipe a desligar o portão inteiro. Para APIs sem OpenAPI completo há baseline declarável, que é o caminho de adoção gradual.

Rodar contra o portal expôs um defeito que nenhum teste sintético pegaria: em JavaScript `$` não casa antes de `
` e `.` não consome `
`, então a extração de cabeçalhos HTTP devolvia lista vazia em **todo** arquivo de um checkout no Windows — que é como este repositório está. Guia em [/guides/contratos-de-documentacao/](src/content/docs/guides/contratos-de-documentacao.mdx).

#### Análise de impacto

O Content Graph responde "quem usa o quê" — informação. O Impact Engine responde "se eu mudar isso, o que preciso revisar?" — decisão. Ele aparece no editor (painel de referências, botão **Impacto**, sob demanda e antes de salvar) e na revisão do PR, cujo corpo passa a trazer contagem por severidade, Impact Score, escopo estimado, quebras de contrato de API e checklist.

Quatro severidades: 🔴 crítico é o que pode **invalidar** a documentação (endpoint removido, bloco incluído que deixou de existir), 🟠 alto provavelmente exige revisão, 🟡 médio é potencialmente relevante, 🟢 baixo não tem impacto funcional. `critical` fica reservado ao que torna o texto publicado falso, não ao que dá trabalho — classificar tudo como crítico é o mesmo que não classificar nada. A severidade cai com a distância no grafo.

**Dependência indireta é a razão de o motor existir.** `guides/conteudo-reutilizavel.mdx` inclui `api-essentials`, que inclui `authentication-warning`; editar o último altera o texto publicado da página, e **não existe aresta entre os dois**. A contagem de um salto que havia antes respondia "nenhuma página afetada" — com convicção e errada. O relatório mostra por onde o impacto passou, porque "revise esta página" sem o caminho é um palpite pedindo confiança.

O diff de API compara a especificação **interpretada**, não o texto: reordenar chaves do YAML são vinte linhas no `git diff` e mudança nenhuma, renomear um parâmetro é uma linha e quebra total. Renome é reconhecido como renome (`id → userId`) quando lugar, tipo e obrigatoriedade batem. São quebra: operação removida, parâmetro removido/renomeado/com tipo novo/que passou a obrigatório, corpo obrigatório, autenticação diferente, URL base diferente, resposta `2xx` que saiu. Não são: operação nova, opcional novo, obrigatório que relaxou, resposta nova, depreciação. A ligação página↔operação vem primeiro do que é **declarado** (`<TryIt schema=… operation=…/>`) e só depois do caminho literal no texto.

O Impact Score (0–100) traz **cada fator com os pontos e o motivo** — um número que ninguém consegue conferir é o tipo de métrica que a equipe ignora na terceira vez que discorda da intuição. Sem consequência apurada o score é zero, inclusive o fator de tamanho: um PR que só mexe em `astro.config.mjs` não tem nada a revisar na documentação. No checklist entra só o que se consegue conferir — uma página, uma operação, um termo; "revisar a documentação" não é item de checklist. Guia em [/guides/analise-de-impacto/](src/content/docs/guides/analise-de-impacto.mdx).

#### Confiança e proveniência

Toda afirmação importante da documentação deveria ter evidência. Uma página pode dizer "chaves de API expiram em 90 dias" sem que exista em lugar nenhum o registro de onde isso veio, quem confirmou e quando — enquanto for verdade ninguém nota, e quando deixar de ser ninguém descobre.

**O limite do selo, primeiro, porque é o que o impede de virar conforto falso.** "Verificado" quer dizer que a evidência citada **existe e confere** onde é possível comparar: o endpoint existe na especificação, o arquivo e a linha existem no código, o id de teste existe na suíte. **Não** quer dizer que a frase é verdadeira.

A proveniência é declarada no próprio conteúdo, versionada no Git — em banco separado ela divergiria do conteúdo no primeiro `git revert`, e divergindo deixa de ser evidência. Duas granularidades: bloco `provenance:` no frontmatter para a página, comentário antes do parágrafo para a afirmação. Em `.md` o comentário é `<!-- -->`; em `.mdx` é `{/* */}`, porque MDX tenta ler comentário HTML como JSX e o build falha.

Quatro estados. **Verificado** (a evidência confere e a confirmação está no prazo), **vencido** (confere, confirmação passou do prazo), **não verificado** (declarado sem data, ou nunca confirmado), **evidência inválida** (não confere). Duas regras que decidem casos reais: evidência inválida com data de ontem continua inválida — a data só documenta que a conferência não olhou o que devia; e evidência que confere mas nunca foi confirmada não é "verificada", porque ninguém assinou embaixo.

O prazo padrão fica em `trust.yml`: 180 dias, que é o que uma equipe consegue honrar. Prazo curto transforma o portal num mar de avisos amarelos que ninguém lê; prazo longo deixa a página envelhecer exibindo selo de verificada.

O **Trust Score** (0–100) combina validade da fonte, cobertura por teste, frescor e responsável. Página sem afirmação recebe zero — dar nota cheia à ausência de evidência premiaria o que a camada existe para corrigir. Ele aparece **ao lado** do Quality Score em Settings → Quality, nunca dentro: misturar os dois faria uma página impecavelmente escrita e sem evidência parecer pior do que é.

No **assistente**, a confiança ajusta a relevância sem substituí-la, e conteúdo vencido não é escondido — é a melhor informação que o portal tem, e a resposta sai com o aviso na frente, não no rodapé. No **MCP**, `get_document` devolve `trust` com `checked: "declaracao"`: o leitor Python lê o que a página declara e confere a data, mas não resolve evidência, e por isso nunca reporta `invalid`. Guia em [/guides/confianca-e-proveniencia/](src/content/docs/guides/confianca-e-proveniencia.mdx).

#### Observabilidade e SLOs

O linter mede escrita, a suíte mede comportamento, o Impact Engine mede consequência, o Trust mede evidência, o Twin mede cobertura, o Contract mede fidelidade ao contrato. Nenhum deles responde à pergunta de segunda-feira: **a documentação está saudável, e o que fazemos primeiro?** É o que **Settings → Health** e `npm run docs:health` montam.

**Ela não mede nada de novo** — e isso é requisito, não estilo. Quando a camada foi estendida para observabilidade, o cálculo próprio de cobertura de API que ela tinha foi **removido** e substituído pela consulta ao Digital Twin: duas contas para o mesmo número divergem na primeira mudança, e aí ninguém sabe qual acreditar.

Dez dimensões: qualidade, integridade de contrato, cobertura, frescor, confiabilidade, confiança, preparo para IA, consistência, cobertura de testes e acessibilidade. Cada uma mostra **de onde o número veio**. O Health Score é do portal inteiro e não substitui o Quality Score, que continua sendo a nota por página.

**Não medido não é zero.** Dimensão sem dado fica fora da média e entra no SLO como *em risco*, nunca como violação — não se viola um alvo que não foi aferido.

**A idade sozinha não determina obsolescência**, e essa é a regra que separa um indicador útil de um mar de vermelho. Uma página com 200 dias e nenhum sinal de divergência continua atual; a suspeita começa depois de um ano. O que empurra para obsoleta é evidência: contrato quebrado, proveniência que não confere, a API mudando depois da última edição. Uma página editada ontem com contrato quebrado fica vermelha; uma de dois anos, correta e muito lida, fica verde — e o relatório diz por quê.

O **error budget** mostra quanto **resta**, não quanto se gastou: "40% restante" leva a decisão diferente de "3 de 5". Orçamento zero é caso normal — link morto e contrato quebrado não têm cota.

O **snapshot** é a única coisa que esta camada persiste, porque histórico não se deriva; ele guarda números e o commit, nunca conteúdo. A regressão compara com a medição mais **próxima** do alvo e lista só as dimensões que pioraram. Os commits correlacionados são **candidatos**, não causa: a documentação também degrada quando o produto muda e ninguém mexe nela.

`npm run docs:health -- check` serve ao CI (sai com 1 em SLO violado; risco não reprova, senão a equipe afrouxa os alvos até tudo ficar verde), e o PR mostra `antes → depois` — dizendo quando não há base de comparação, em vez de exibir `-0`. Guia em [/guides/observabilidade/](src/content/docs/guides/observabilidade.mdx).

#### Avaliação de IA

Mede o assistente contra conjuntos de perguntas versionados em `evals/`. A camada separa **verificável** de **inferido** e só mede o primeiro: citação aponta para página que existe, página esperada foi citada, termo exigido apareceu. Por isso a métrica se chama "termos presentes", não "correção" — uma resposta pode conter todas as palavras e estar errada.

Métrica que não se aplica fica fora da média, nunca entra como zero. Sem `ANTHROPIC_API_KEY` a corrida mede recuperação, não resposta gerada, e os casos adversariais aparecem como não avaliáveis — sem modelo os guardrails não rodam, e reprová-los ali seria alarme falso.

Em `npm run ai:eval` e em Settings → AI Evaluation.

Detalhes em **[Avaliação de IA](/guides/avaliacao-de-ia/)**.

### Qualidade e verificação

_Descobrir o que está errado antes de quem lê descobrir._

### O produto como fonte

_A especificação e o código dirigindo a documentação, os testes e o SDK._

#### Digital Twin

O Content Graph responde "quem usa o quê" dentro da documentação. O Twin sobe um nível e responde sobre o **produto**: o que está documentado, o que a documentação descreve e não existe mais, e o que quebra se um endpoint mudar.

**Ele não é fonte de verdade.** A fonte continua sendo o Git — Markdown, OpenAPI, código. O Twin é derivado a cada análise e não persiste nada; se discordar do repositório, quem está errado é o grafo.

O grafo de código desta base é **exato**, não heurístico: a Astro mapeia arquivo para rota de forma determinística, então `src/pages/api/auth/me.ts` que exporta `GET` implementa `GET /api/auth/me`. Cada relação registra se foi `declared` (alguém escreveu a ligação, como um `<TryIt/>`) ou `derived` (convenção) — as duas erram de formas diferentes, e misturá-las impediria julgar o quanto confiar no relatório.

Duas perguntas simétricas com severidades diferentes: **implementação sem documentação** é dívida certa; **documentação sem implementação** é *potencialmente* obsoleta, porque a página pode descrever comportamento histórico, versão anterior, conceito ou algo planejado — um veredito automático aqui viraria alarme falso.

Medir o portal expôs dois defeitos de modelagem que só aparecem com dados reais. `GET /auth/me` da especificação e `GET /api/auth/me` do código eram **dois** endpoints, ambos "não documentados", até o prefixo do servidor entrar na identidade. E as 45 rotas internas do editor derrubavam a cobertura para **6%** — um número que qualquer equipe aprende a ignorar; elas continuam no grafo e saíram da conta via `twin.yml`, com a exceção de que endpoint declarado numa especificação é público por definição.

`npm run twin -- coverage --min 90` serve ao CI (sai com 1 abaixo do mínimo, 0 quando não há o que medir), e a cobertura entra no corpo do PR. **Settings → Intelligence** traz tudo em tabela — um grafo de centenas de nós é bonito na captura de tela e inútil para achar o endpoint que ninguém documentou. Guia em [/guides/digital-twin/](src/content/docs/guides/digital-twin.mdx).

#### Vínculo com o código

Uma página declara, no frontmatter, quais entidades do produto ela documenta:

```yaml
documentation:
  bindings:
    - type: api
      id: POST /api/payments
```

A partir daí a CI cobra: entidade pública alterada sem página vinculada bloqueia o merge; página vinculada que ficou para trás vira aviso. Menção em texto não conta — só o vínculo declarado e resolvido contra o Digital Twin.

O vínculo vive na documentação, nunca no código: o produto não deve depender de Markdown. Em `npm run docs:code` e em Settings → Code Loop.

Detalhes em **[Vínculo com o código](/guides/vinculo-com-o-codigo/)**.

#### Knowledge Graph

Estende o Digital Twin com time, release, lacuna e contrato — **não** é um segundo grafo: duas estruturas com as mesmas entidades divergiriam na primeira semana.

Nem toda aresta propaga impacto. Se um endpoint muda, as páginas que o documentam são afetadas; a especificação que o define não é. Quando uma camada não carrega, o grafo é montado sem ela e declara a degradação, porque um grafo sem a governança responde "ninguém é dono disto" com a mesma confiança de um completo.

Em `npm run graph` e em Settings → Knowledge Graph.

Detalhes em **[Knowledge Graph](/guides/knowledge-graph/)**.

#### SDK

Gera um cliente TypeScript a partir da **mesma** especificação que já move a documentação, os contratos e o Digital Twin:

```text
OpenAPI → ApiModel → SDK
```

Não há segundo parser, segundo engine de contrato nem segundo engine de impacto. Quando o gerador precisou de schemas nomeados, o `ApiModel` ganhou o campo — abrir o YAML de novo daria duas leituras da mesma especificação, e a segunda envelheceria.

O pacote gerado não tem dependência de execução. Onde a especificação não diz o tipo, o código gerado diz `unknown`: um SDK que finge saber faz o compilador aprovar uma chamada errada.

O diff deriva do contrato, não da comparação textual dos arquivos gerados. Em `npm run sdk` e no portão de revisão de PR.

Detalhes em **[SDK](/guides/sdk/)**.

#### API Explorer

Um console de requisições embutido, derivado da mesma especificação OpenAPI que move os contratos, o Digital Twin e o SDK. Nenhum endpoint é redigido de novo para ele.

Detalhes em **[API Explorer](/guides/api-explorer/)**.

#### Referência de API a partir de especificação

Páginas de referência geradas a partir de OpenAPI e AsyncAPI. O portal exige que a especificação se declare — um arquivo AsyncAPI aceito em silêncio por um gerador de OpenAPI produz uma página que parece certa e está errada.

Detalhes em **[Referência de API a partir de especificação](/guides/referencia-de-api/)**.

### Operação

_Quem é dono do quê, o que os leitores fazem e onde estão os buracos._

#### Governança

Cada página declara dono, revisor e intervalo de revisão no frontmatter; o `governance.yml` preenche o resto por regra de caminho, e a regra mais específica vence.

"Revisada" é o que alguém declarou, nunca a data do último commit — corrigir uma vírgula não reinicia o relógio de uma página que ninguém leu. E vencida (foi revisada, o intervalo passou) é contada à parte de nunca revisada (entrou no regime, nunca teve revisão): somar as duas acusaria a equipe de atraso no primeiro dia de qualquer regime.

Em `npm run governance` e em Settings → Governance.

Detalhes em **[Governança](/guides/governanca/)**.

#### Observabilidade de leitura

Mede se a documentação **resolve o problema de quem chegou**, não se ela está tecnicamente correta — e as duas notas ficam lado a lado, nunca somadas.

Nada identifica uma pessoa: sem IP, sem id de usuário, sem cookie, sem user-agent. O que existe é uma sessão efêmera do navegador que some quando a aba fecha. Do Not Track, Global Privacy Control e a escolha do leitor desligam a coleta; o texto das buscas é desligado por padrão; uma linha só aparece com 3+ sessões distintas.

Os nomes das métricas carregam os seus limites: "clique em resultado", não "taxa de sucesso" — clicar é o mais longe que a instrumentação enxerga.

Em `npm run analytics` e em Settings → Observability.

Detalhes em **[Observabilidade de leitura](/guides/observabilidade-de-leitura/)**.

#### Lacunas de documentação

Saber que uma página teve dez mil acessos não diz o que falta. Esta camada pergunta **que informação as pessoas procuram e não encontram**, cruzando busca, assistente, MCP, feedback, contratos e o Digital Twin num backlog priorizado — em Settings → Gaps e em `npm run gaps`.

**Publicar não é resolver**, e é a regra que dá sentido ao resto. `start` registra o sinal de hoje como linha de base; depois de publicar, `resolve` compara — e **recusa** se as consultas e as respostas sem lastro não caíram pelo menos dois terços. Não se exige queda a zero: a pergunta continua sendo feita mesmo quando a resposta existe.

Seis tipos, cada um levando a uma ação diferente: falta documentação, incompleta, desatualizada (quando o Twin ou o Contract acusam divergência), pouco clara, difícil de achar (mexer na navegação, não no texto) e contraditória. O score combina demanda, falha do assistente, cobertura baixa, insatisfação e contrato quebrado — este último pesando muito, porque documentação que diverge do produto é **pior** que ausente: ela leva a pessoa a errar com confiança.

Rodar contra o portal expôs dois erros de medição que só aparecem com dados reais. **Cobertura não é relevância de busca**: o BM25 normaliza pelo melhor resultado, então "como rotacionar a chave de API" — assunto sobre o qual não existe uma linha aqui — foi classificada como *difícil de achar* com 100% de cobertura; agora o que se mede é a presença dos termos da pergunta nas páginas. E o agrupamento precisava de **dois** conjuntos de termos: a interseção admite variações no grupo, mas medir cobertura por ela reduzia "rotacionar a chave de api" a `chave, api`, que o portal documenta.

A privacidade segue a decisão anterior: texto das perguntas desligado por padrão, e mesmo ligado só a pergunta **sem resposta**, sem quem perguntou, truncada e com credenciais redigidas. Desligado, a camada funciona com os sinais estruturais e diz na primeira linha que está trabalhando com menos. Guia em [/guides/lacunas-de-documentacao/](src/content/docs/guides/lacunas-de-documentacao.mdx).

#### Feedback de página

Um widget de utilidade no rodapé de cada página. Ele guarda o voto e o caminho, e nada sobre quem votou.

Detalhes em **[Feedback de página](/guides/feedback/)**.

#### Organização e múltiplos repositórios

Registra repositórios, produtos e times em `organization.yml` e agrega o que dá para agregar sem mentir.

O portal **não busca repositório da rede**: registrado por `url`, ele é listado e não lido — clonar e ler conteúdo arbitrário a cada coleta é decisão de quem opera. A profundidade da leitura é declarada por repositório, e o que não foi medido fica fora da média: contá-lo como zero faria registrar um repositório baixar a nota da organização.

Em `npm run org` e em Settings → Organization.

Detalhes em **[Organização e múltiplos repositórios](/guides/organizacao/)**.

#### Analytics da documentação (Do11y)

Integração opcional com o Do11y para analytics de documentação. Desligada por padrão, e configurada por ambiente — nenhuma credencial vai para o repositório.

Detalhes em **[Analytics da documentação (Do11y)](/guides/analytics-do11y/)**.

### Automação

_O que o portal faz sozinho — e onde ele para para pedir aprovação._

#### Agentes de documentação

O objetivo **não é outro chatbot**. Um agente genérico produz "aqui está uma documentação sobre autenticação" e não garante que a implementação foi consultada, que a API está correta nem que os exemplos funcionam. Aqui, cinco agentes especializados usam as ferramentas que o portal já tem — Digital Twin, Content Graph, glossário, linter, testes, contratos, proveniência — e produzem mudanças **verificáveis**.

**Quatro dos cinco funcionam sem provedor nenhum.** Sem chave, o Writer não inventa prosa: produz um rascunho estruturado com o que se sabe, de onde veio e onde falta escrever, e a execução segue por revisão, testes e auditoria normalmente.

**Nada é publicado automaticamente**, mesmo com todos os testes verdes — e aprovar não publica: o conteúdo continua no workspace isolado até ser aplicado. Três condições param a execução antes do fim: fontes que discordam (escolher uma em silêncio propagaria o conflito), pesquisa sem evidência (preencher com suposição é o que a camada existe para evitar) e regressão de saúde.

Os guardrails da §25 são **código executável**, não instrução de prompt: allowlist de ferramentas por agente (só o Writer escreve, e só no workspace; nenhum agente tem execução de comando), caminhos restritos a `src/content/` em `.md`/`.mdx` com `data/`, `.env`, `src/lib/auth/` e configuração recusados até para leitura, e travessia de diretório rejeitada em vez de normalizada.

O último guardrail nasceu de um defeito real: a primeira execução contra o portal **substituiu a página de autenticação inteira por um esqueleto** — e passou por revisão, testes e auditoria, porque esqueleto bem formado é Markdown válido. Saíram duas correções: o Writer sem modelo passou a ser aditivo sobre página existente, e o orquestrador ganhou um guardrail de descarte que vale para qualquer origem do texto, inclusive um modelo.

Conteúdo recuperado é tratado como **dado, nunca instrução** — pela mesma sanitização que o assistente usa, porque duas defesas com regras diferentes significam que a mais fraca é a que vale. E não há memória autônoma persistente: o estado pertence à execução e morre com ela. Guia em [/guides/agentes-de-documentacao/](src/content/docs/guides/agentes-de-documentacao.mdx).

#### Self-healing

Detectar → diagnosticar → propor → validar → revisar → PR. Nunca `detectar → corrigir`.

Nada é escrito fora do workspace isolado dos agentes, nada é publicado sem aprovação humana, e nenhum nível de autonomia faz merge. O diagnóstico recusa sem fonte autoritativa; quando fontes autoritativas discordam, o ciclo declara conflito e para, em vez de escolher uma — documentação errada com ar de certeza é pior que a lacuna.

Validação que não roda vale "não verificado", nunca "aprovado".

Em `npm run heal` e em Settings → Self-Healing.

Detalhes em **[Self-healing](/guides/self-healing/)**.

#### Time Machine

Quatro perguntas que só o histórico responde: como esta página evoluiu, como o portal estava em maio, o que mudou de **comportamento** entre dois pontos, e o que aquele commit afetou. Em `npm run history` e em Settings → History.

**O Git continua sendo a fonte.** Esta camada é indexação, não cópia: cada consulta reconstrói do repositório. É mais lento e sempre certo — um índice persistido divergiria no primeiro `rebase`, e passariam a existir duas respostas para "como esta página estava em maio", uma errada e nenhuma marcada como tal. Nada aqui escreve, faz checkout ou muda de branch; a leitura é por `git show`.

**O que não dá para reconstruir vem ausente, não estimado.** Páginas, palavras, termos e endpoints saem do conteúdo daquele commit e são exatos. O Health Score **não** é recalculado: ele dependia de testes e contratos avaliados com as ferramentas daquela época. A primeira versão aceitava uma medição de até sete dias de distância, e uma comparação entre 12 e 18 de agosto exibiu o mesmo número nas duas pontas — a medição de hoje apresentada como se descrevesse o passado, com delta zero convidando à conclusão de que nada mudou.

O **semantic diff** responde "o que passou a ser verdade que antes não era": `30 dias → 90 dias`, `client_id → client_id + client_secret`. Cada achado carrega confiança — lista `required:` é estrutura declarada e vale 0,95; assunto de número inferido das palavras vizinhas vale 0,7. O limite está dito: reescrita em prosa que inverte um sentido passa despercebida, e por isso o diff textual continua ao lado em vez de ser substituído.

**Restore não altera a branch.** Snapshot → workspace isolado → diff → validação → PR, sem atalho. Restaurar é operação perigosa disfarçada de simples: conteúdo antigo pode estar antigo por um bom motivo, e uma reversão com um clique apagaria a razão junto. Guia em [/guides/time-machine/](src/content/docs/guides/time-machine.mdx).

#### Assistente de documentação

Um chatbot que responde a partir da documentação e cita as fontes. Sem chave de provedor ele devolve trechos e um resumo extrativo, sem redigir nada; com chave, o mesmo pipeline redige a resposta atravessando os guardrails.

Detalhes em **[Assistente de documentação](/guides/assistente/)**.

#### Documentação legível por máquina

`llms.txt`, Markdown bruto em cada página e metadados estruturados — para que um agente leia a documentação sem raspar HTML.

Detalhes em **[Documentação legível por máquina](/guides/documentacao-legivel-por-maquina/)**.

#### Consulta pelo terminal (MCP)

Um servidor MCP e uma CLI que expõem a documentação para agentes e para o terminal, com os mesmos filtros de público e versão do portal.

Detalhes em **[Consulta pelo terminal (MCP)](/guides/mcp/)**.

### Plataforma

_Acesso, fluxo de trabalho e publicação._

#### Usuários e controle de acesso

Três papéis — viewer, editor e admin. A leitura é pública; editar e administrar exigem entrar. A autorização é por capacidade, aplicada num único middleware, e os dados de usuário ficam fora do Git.

Detalhes em **[Usuários e controle de acesso](/guides/usuarios-e-acesso/)**.

#### Workflow de Git

Branch, diff, portão de qualidade e preparação de pull request a partir do editor — com o corpo do PR montado a partir do que os motores de análise já sabem.

Detalhes em **[Workflow de Git](/guides/workflow-de-git/)**.

#### Publicação no GitHub Pages

Publicação automatizada no GitHub Pages, com o caminho base tratado e a distinção entre o site estático e o modo servidor.

Detalhes em **[Publicação no GitHub Pages](/guides/publicacao-no-github-pages/)**.

#### Atualizações recentes

Uma lista do que mudou recentemente, derivada do Git — não uma lista mantida à mão que alguém esquece de atualizar.

Detalhes em **[Atualizações recentes](/guides/atualizacoes-recentes/)**.

#### Plugins da comunidade

Os plugins da comunidade Starlight em uso, com o que cada um resolve e por que foi escolhido
em vez das alternativas.

Guia: **[Plugins da comunidade](/guides/plugins/)**. Notas de avaliação: [docs/plugins.md](docs/plugins.md).

## Clean install

Se o `node_modules`/lockfile ficarem inconsistentes com o `package.json` (por exemplo depois de puxar uma versão nova do editor):

```powershell
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
Remove-Item -Force package-lock.json -ErrorAction SilentlyContinue
npm install
npm run build
npm run dev
```
