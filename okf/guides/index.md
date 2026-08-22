# Guias

# Guias

* [Agentes de documentação](/guides/agentes-de-documentacao.md) - Agentes especializados que pesquisam, rascunham e validam — com guardrails em código, workspace isolado e aprovação humana obrigatória.
* [Análise de impacto](/guides/analise-de-impacto.md) - O motor que responde "se eu mudar isso, o que preciso revisar?" — dependências indiretas, quebra de contrato de API, terminologia e checklist de revisão.
* [API Explorer](/guides/api-explorer.md) - O console de requisições embutido, derivado da mesma especificação OpenAPI que move o resto do portal.
* [Assistente de documentação](/guides/assistente.md) - O chatbot do portal: recuperação, citação obrigatória, guardrails e o que muda com e sem modelo de linguagem.
* [Atualizações recentes](/guides/atualizacoes-recentes.md) - O componente que lista o que mudou, derivado do Git em vez de uma lista mantida à mão.
* [Avaliação de IA](/guides/avaliacao-de-ia.md) - Como o portal mede se o assistente está correto, fundamentado e seguro — e, principalmente, o que ele se recusa a fingir que mede.
* [Busca](/guides/busca.md) - Pagefind, Algolia DocSearch, a busca "warp drive" e o registro do portal como buscador no navegador.
* [Changelog automático](/guides/changelog-automatico.md) - Como o changelog mensal é gerado a partir dos commits, o que ele filtra, e por que ele para antes de publicar.
* [Comece por aqui](/guides/getting-started.md) - Faça a primeira chamada à API em poucos minutos.
* [Confiança e proveniência](/guides/confianca-e-proveniencia.md) - Como declarar de onde uma informação veio, como o portal verifica a evidência e o que o selo "verificado" quer dizer — e o que ele não quer dizer.
* [Consulta pelo terminal (MCP)](/guides/mcp.md) - O servidor MCP e a CLI que expõem a documentação para agentes e para o terminal.
* [Conteúdo condicional](/guides/conteudo-condicional.md) - Como esconder trechos ou páginas inteiras usando variáveis, sem manter versões paralelas da documentação.
* [Conteúdo reutilizável](/guides/conteudo-reutilizavel.md) - Como escrever um trecho uma vez e reaproveitá-lo em várias páginas sem duplicar texto.
* [Contratos de documentação](/guides/contratos-de-documentacao.md) - A verificação que pergunta se o exemplo representa o contrato de verdade — schemas, parâmetros, status, autenticação e exemplos de código.
* [Digital Twin](/guides/digital-twin.md) - A relação entre produto e documentação — o que está documentado, o que não tem implementação, e o que quebra se mudar.
* [Documentação adaptativa](/guides/documentacao-adaptativa.md) - Uma fonte, várias experiências — audiências, contexto de leitura, recomendações e o limite que a acessibilidade impõe à personalização.
* [Documentação legível por máquina](/guides/documentacao-legivel-por-maquina.md) - `llms.txt`, Markdown bruto por página, metadados estruturados e o menu Compartilhar com IA.
* [Edite os diagramas](/guides/diagramas.md) - Como os diagramas do portal são feitos, como alterar um e como criar outro sem quebrar o tema, a acessibilidade nem o build.
* [Editor de documentação](/guides/editor.md) - O editor Markdown/MDX embutido: Monaco, preview, reuso de conteúdo, grafo de dependências, paleta de comandos e consciência de Git.
* [Feedback de página](/guides/feedback.md) - O widget de utilidade no rodapé, o que ele guarda e o que ele deliberadamente não guarda.
* [Governança](/guides/governanca.md) - Quem é dono de cada página, quando ela precisa ser revisada, o que exige aprovação antes de publicar — e por que "revisada" nunca é a data do último commit.
* [Knowledge Graph](/guides/knowledge-graph.md) - Código, APIs, documentação, times, lacunas e contratos navegáveis como conhecimento relacionado — e por que ele não é um segundo grafo.
* [Lacunas de documentação](/guides/lacunas-de-documentacao.md) - Como o portal descobre o que as pessoas procuram e não encontram, prioriza o trabalho e confere se a lacuna realmente sumiu.
* [Linter e Quality Score](/guides/linter-e-quality-score.md) - O revisor editorial automatizado: problemas com id estável, nota por dimensão, style guide versionado e portão de CI.
* [Mantenha o glossário](/guides/glossario.md) - Como cadastrar um termo, como ele é destacado nas páginas e como o linter usa o glossário para avaliar consistência.
* [Manual do portal e do editor](/guides/manual.md) - Guia completo do Developer Portal e do editor de documentação — recursos, atalhos de teclado, fluxos de trabalho e casos de uso.
* [Navegação](/guides/navegacao.md) - Sidebar, breadcrumbs, paginação, índice da página, tags e as decisões que mantêm a navegação previsível.
* [Navegação por produto](/guides/produtos.md) - Como um portal documenta vários produtos, o seletor, o que fica compartilhado e o aviso de página de outro produto.
* [Observabilidade da documentação](/guides/observabilidade.md) - Health Score, SLO, error budget, detecção de obsolescência, histórico e regressão — a documentação tratada como sistema observável.
* [Observabilidade de leitura](/guides/observabilidade-de-leitura.md) - O que os leitores fazem no portal — busca, jornada, abandono — e o que o produto deliberadamente não guarda sobre eles.
* [Open Knowledge Format](/guides/open-knowledge-format.md) - O portal exporta o que sabe como um bundle OKF v0.2 — markdown com frontmatter que um agente consome sem conhecer esta plataforma.
* [Organização e múltiplos repositórios](/guides/organizacao.md) - Documentação distribuída por repositórios, produtos e times — com a profundidade de leitura declarada em vez de disfarçada.
* [Overlays e API Views](/guides/overlays-e-api-views.md) - O que é um overlay de OpenAPI, por que ele substitui a segunda cópia da especificação, e o que muda na operação do dia a dia.
* [Página publicada mas não visível na navegação](/guides/testando-visibilidade.md) - Testando feature de visibilidade
* [Personalize o portal](/guides/configure-your-portal.md) - Adapte marca, contatos e endpoint principal para uma nova empresa.
* [Plugins da comunidade](/guides/plugins.md) - Os plugins da comunidade Starlight instalados, o que cada um faz e por que foi escolhido.
* [Publicação no GitHub Pages](/guides/publicacao-no-github-pages.md) - O workflow de publicação, o caminho base e o que muda entre o site estático e o modo servidor.
* [Publique documentação](/guides/publish-documentation.md) - Adicione páginas e mantenha as três áreas do portal atualizadas.
* [Referência de API a partir de especificação](/guides/referencia-de-api.md) - Páginas de referência geradas de OpenAPI e AsyncAPI, e por que o portal exige que a especificação se declare.
* [Saúde da documentação](/guides/saude-da-documentacao.md) - O Health Center — dimensões, SLOs, lacunas priorizadas e alertas. Como cada número é apurado e por que "não medido" não é zero.
* [SDK](/guides/sdk.md) - Como o portal gera um cliente TypeScript a partir da mesma especificação que já move a documentação, os contratos e o Digital Twin.
* [Self-healing](/guides/self-healing.md) - Detectar, diagnosticar, propor e validar correções de documentação — e as fronteiras que impedem a automação de virar risco.
* [Testes de documentação](/guides/testes-de-documentacao.md) - A suíte que verifica se a documentação funciona — links, âncoras, referências de conteúdo e exemplos de API — e como ela entra no pull request.
* [Time Machine](/guides/time-machine.md) - Como a documentação evoluiu, como ela estava numa data, o que mudou de comportamento entre dois pontos — e como voltar atrás com segurança.
* [Usuários e controle de acesso](/guides/usuarios-e-acesso.md) - Os três papéis do portal, o primeiro acesso, criação de usuários pela linha de comando e como a autorização é aplicada.
* [Versionamento da documentação](/guides/versionamento.md) - Versões da documentação, o seletor, o aviso de versão antiga e como uma versão é congelada.
* [Vínculo com o código](/guides/vinculo-com-o-codigo.md) - Como uma página declara que documenta um endpoint, o que a CI cobra a partir disso, e por que menção em texto não conta como documentação.
* [Workflow de Git](/guides/workflow-de-git.md) - Branches, diff, quality gate e preparação de pull request a partir do editor.
