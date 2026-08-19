# Arquitetura

Este documento descreve o portal nos níveis do [modelo C4](https://c4model.com/):
contexto, contêineres, componentes e um diagrama dinâmico. As **decisões** que
levaram a esta forma estão registradas em [ADRs](adr/), e cada nível aponta as
que o explicam.

## Uma nota sobre a notação

Os diagramas usam Mermaid `flowchart` com a semântica do C4 — pessoa, sistema,
contêiner, componente — em vez da sintaxe `C4Context` do Mermaid.

O C4 é um modelo, não uma sintaxe: o que importa é a hierarquia de níveis e o
significado das caixas. A sintaxe `C4Context` continua marcada como experimental
e falha de render em algumas versões; `flowchart` renderiza no GitHub, no VS
Code e em qualquer visualizador que entenda Mermaid.

Estes diagramas ficam em `docs/`, lido no GitHub. Os diagramas do **portal
publicado** são SVG escrito à mão — ver [ADR-0015](adr/0015-diagramas-como-svg-versionado.md).

```text
Legenda
  ┌────────────┐   Pessoa            ┌────────────┐   Contêiner
  │  redondo   │                     │  retângulo │   (processo, app, banco)
  └────────────┘                     └────────────┘
  ╔════════════╗   Sistema externo   ┌ ─ ─ ─ ─ ─ ─┐   Componente
  ╚════════════╝                     └ ─ ─ ─ ─ ─ ─┘   (dentro de um contêiner)
```

---

## Nível 1 — Contexto

Quem usa o portal e com o que ele conversa.

```mermaid
flowchart TB
    leitor(["<b>Leitor</b><br/><i>Pessoa</i><br/>Integra-se à API"])
    autor(["<b>Autor</b><br/><i>Pessoa</i><br/>Escreve a documentação"])
    admin(["<b>Administrador</b><br/><i>Pessoa</i><br/>Governa e opera"])
    agente(["<b>Agente de IA</b><br/><i>Sistema</i><br/>Consulta via MCP"])

    portal["<b>Portal de documentação</b><br/><i>Sistema</i><br/>Publica, verifica e governa a<br/>documentação de um produto"]

    git["<b>Repositório Git</b><br/><i>Sistema externo</i><br/>Conteúdo, especificações e código"]
    modelo["<b>API Anthropic</b><br/><i>Sistema externo</i><br/>Redação assistida — opcional"]
    busca["<b>Algolia DocSearch</b><br/><i>Sistema externo</i><br/>Busca hospedada — opcional"]
    do11y["<b>Do11y</b><br/><i>Sistema externo</i><br/>Analytics — opcional"]

    leitor -->|lê, busca, pergunta, vota| portal
    autor -->|escreve e revisa| portal
    admin -->|configura e audita| portal
    agente -->|consulta com filtros| portal

    portal -->|lê e escreve arquivos| git
    portal -.->|redige a partir de trechos| modelo
    portal -.->|indexa e consulta| busca
    portal -.->|envia eventos agregados| do11y

    classDef pessoa fill:#08427b,stroke:#052e56,color:#fff
    classDef sistema fill:#1168bd,stroke:#0b4884,color:#fff
    classDef externo fill:#999,stroke:#6b6b6b,color:#fff
    class leitor,autor,admin,agente pessoa
    class portal sistema
    class git,modelo,busca,do11y externo
```

As três setas tracejadas são **opcionais e desligadas por padrão**. Sem nenhuma
delas o portal funciona inteiro: a busca é local, o assistente devolve trechos
sem redigir, e não há analytics externo. Ver
[ADR-0016](adr/0016-degradacao-em-vez-de-dependencia.md).

O repositório Git é a única seta cheia para fora, e isso é o ponto:
[ADR-0002](adr/0002-git-como-fonte-de-verdade.md).

---

## Nível 2 — Contêineres

O que roda, e onde o estado vive.

```mermaid
flowchart TB
    subgraph portal["Portal de documentação"]
        direction TB

        site["<b>Site publicado</b><br/><i>Astro + Starlight, estático</i><br/>Guias, referência, changelog"]
        servidor["<b>Servidor Astro</b><br/><i>Node</i><br/>Rotas de API, editor, settings"]
        editor["<b>Editor</b><br/><i>React + Monaco</i><br/>Autoria no navegador"]
        clis["<b>CLIs</b><br/><i>tsx</i><br/>17 comandos de verificação"]
        mcp["<b>Servidor MCP</b><br/><i>Python</i><br/>Consulta para agentes"]
        dados[("<b>Estado operacional</b><br/><i>JSON em data/</i><br/>Usuários, sessões, telemetria")]
        gerado["<b>SDK gerado</b><br/><i>TypeScript</i><br/>Cliente da API"]
    end

    leitor(["Leitor"])
    autor(["Autor"])
    agente(["Agente de IA"])
    ci(["CI"])
    git["<b>Repositório Git</b><br/><i>Sistema externo</i>"]

    leitor --> site
    autor --> editor
    agente --> mcp
    ci --> clis

    editor --> servidor
    site -.->|busca e chatbot| servidor

    servidor --> dados
    servidor -->|lê e escreve| git
    clis -->|lê| git
    clis --> dados
    mcp -->|lê| git
    clis -->|gera| gerado
    gerado -->|versionado em| git
    site -->|gerado a partir de| git

    classDef pessoa fill:#08427b,stroke:#052e56,color:#fff
    classDef container fill:#438dd5,stroke:#2e6295,color:#fff
    classDef store fill:#438dd5,stroke:#2e6295,color:#fff
    classDef externo fill:#999,stroke:#6b6b6b,color:#fff
    class leitor,autor,agente,ci pessoa
    class site,servidor,editor,clis,mcp,gerado container
    class dados store
    class git externo
```

Três coisas para notar:

1. **O conteúdo nunca passa por `data/`.** Markdown, especificações e SDK vão
   para o Git; usuários, sessões e telemetria ficam em `data/`, que é ignorado
   pelo Git. [ADR-0007](adr/0007-estado-operacional-fora-do-git.md).
2. **As CLIs leem o mesmo repositório que o servidor**, e não uma cópia
   indexada. É o que permite rodar toda verificação em CI sem subir o portal.
3. **O site é estático; o servidor existe para o que não pode ser.**
   [ADR-0003](adr/0003-renderizacao-hibrida.md).

---

## Nível 3 — Componentes do núcleo de análise

O nível onde mora a decisão mais estrutural do projeto: **uma leitura do
OpenAPI, muitos consumidores**.

```mermaid
flowchart TB
    spec["<b>portal-api.yaml</b><br/><i>OpenAPI</i>"]
    conteudo["<b>src/content/</b><br/><i>Markdown, MDX, glossário</i>"]
    codigo["<b>src/pages/api/</b><br/><i>Rotas do produto</i>"]

    parse["<b>parseOpenApi → ApiModel</b><br/><i>Componente</i><br/>A única leitura do OpenAPI"]

    subgraph consumidores["Consumidores do ApiModel"]
        direction LR
        explorer["<b>API Explorer</b><br/>Console de requisições"]
        contrato["<b>Contract Testing</b><br/>O exemplo bate com o contrato?"]
        sdkgen["<b>SDK Generator</b><br/>SdkSpecification → renderer"]
    end

    twin["<b>Digital Twin</b><br/><i>Componente</i><br/>Grafo derivado: produto × documentação"]
    grafo["<b>Knowledge Graph</b><br/><i>Componente</i><br/>Twin + time, release, lacuna, contrato"]
    impacto["<b>Impact Engine</b><br/><i>Componente</i><br/>O que quebra se isto mudar"]
    codeloop["<b>Code Loop</b><br/><i>Componente</i><br/>Vínculo declarado no frontmatter"]

    spec --> parse
    parse --> explorer
    parse --> contrato
    parse --> sdkgen
    parse --> twin

    conteudo --> twin
    codigo --> twin
    twin --> grafo
    twin --> codeloop
    twin --> impacto
    contrato --> impacto
    codeloop --> impacto

    classDef fonte fill:#1168bd,stroke:#0b4884,color:#fff
    classDef comp fill:#85bbf0,stroke:#5d82a8,color:#000
    class spec,conteudo,codigo fonte
    class parse,explorer,contrato,sdkgen,twin,grafo,impacto,codeloop comp
```

Nenhuma seta entra em `parseOpenApi` vinda de um consumidor, e nenhum consumidor
abre YAML. Quando o gerador de SDK precisou de schemas nomeados, o `ApiModel`
ganhou o campo — abrir o arquivo de novo daria duas leituras da mesma
especificação, e a segunda envelheceria.
[ADR-0004](adr/0004-uma-leitura-do-openapi.md).

Twin, Knowledge Graph e Content Graph são **derivados**. Se algum discordar do
repositório, o errado é ele. [ADR-0005](adr/0005-camadas-derivadas.md).

---

## Diagrama dinâmico — o portão de pull request

O que acontece quando alguém pede revisão no editor.

```mermaid
sequenceDiagram
    autonumber
    actor Autor
    participant Editor
    participant Review as Rota de revisão
    participant Motores as Motores de verificação
    participant Git

    Autor->>Editor: pedir revisão
    Editor->>Review: GET /api/editor/git/review?base=main

    par Sete portões em paralelo
        Review->>Motores: linter e quality gate
        Review->>Motores: testes de documentação
        Review->>Motores: cobertura do Digital Twin
        Review->>Motores: contratos
        Review->>Motores: saúde e regressão
        Review->>Motores: vínculo com o código
        Review->>Motores: impacto no SDK
    end

    Motores-->>Review: veredito de cada portão
    Review-->>Editor: diff, portões e corpo do PR

    alt algum portão bloqueia
        Editor-->>Autor: mostra o que bloqueou e por quê
    else tudo passa
        Autor->>Editor: criar pull request
        Editor->>Review: POST
        Review->>Git: cria a branch e o PR
        Review-->>Editor: link do PR
    end
```

Os sete portões rodam em paralelo e **nem todos bloqueiam**. Ruptura de contrato
e entidade pública sem documentação bloqueiam; SDK fora de sincronia, revisão
vencida e página potencialmente defasada avisam.
[ADR-0012](adr/0012-portoes-que-bloqueiam-pouco.md).

---

## Diagrama dinâmico — o ciclo de self-healing

O caminho de um problema até uma proposta, e os quatro lugares onde ele para.

```mermaid
flowchart TB
    sinais["<b>Sinais</b><br/>Code Loop · Contratos · Observabilidade"]
    detect["<b>Detectar</b><br/>Nenhum sinal é gerado aqui"]
    diag["<b>Diagnosticar</b><br/>Causa provável, com evidência"]

    conflito{"Fontes<br/>conflitam?"}
    confianca{"Confiança ≥<br/>mínimo?"}
    tentativas{"Tentativas<br/>esgotadas?"}

    propor["<b>Propor</b><br/>Agent Orchestrator,<br/>workspace isolado"]
    validar["<b>Validar</b><br/>Markdown, frontmatter,<br/>links, rascunho, remoção"]
    risco["<b>Avaliar risco</b><br/>low · medium · high · critical"]
    humano(["<b>Revisão humana</b><br/>Sempre"])
    lacuna["<b>Vira lacuna</b><br/>Para intervenção humana"]

    sinais --> detect --> diag --> conflito
    conflito -->|sim| lacuna
    conflito -->|não| confianca
    confianca -->|não| lacuna
    confianca -->|sim| tentativas
    tentativas -->|sim| lacuna
    tentativas -->|não| propor --> validar --> risco --> humano

    classDef parada fill:#c8553d,stroke:#8c3b2b,color:#fff
    classDef passo fill:#438dd5,stroke:#2e6295,color:#fff
    classDef gate fill:#f0ad4e,stroke:#a8791f,color:#000
    class lacuna parada
    class sinais,detect,diag,propor,validar,risco passo
    class conflito,confianca,tentativas gate
    class humano parada
```

Nenhum caminho leva a "publicar". A caixa final é sempre revisão humana, em
qualquer nível de autonomia.
[ADR-0010](adr/0010-guardrails-por-construcao.md).

---

## Onde continuar

| Documento | O que explica |
| --- | --- |
| [ADRs](adr/) | Por que cada decisão foi tomada, e o que ela custou |
| [docs/content-graph.md](content-graph.md) | O grafo de dependências de conteúdo |
| [docs/controle-de-acesso.md](controle-de-acesso.md) | Papéis, capacidades e as proteções contra escalação |
| [docs/linter.md](linter.md) | As regras do linter e o cálculo da nota |
| [docs/glossario.md](glossario.md) | O glossário como fonte, o linter como consumidor |
