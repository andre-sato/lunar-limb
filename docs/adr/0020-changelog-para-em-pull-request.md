# ADR-0020 — O changelog gerado para num pull request

**Status:** Aceita · **Data:** 2026-08 · **Nível C4:** Dinâmico

## Contexto

A issue #15 pede um changelog mensal publicado automaticamente no dia 1º. O
material de origem são as mensagens de commit do mês.

Duas propriedades desse material decidem tudo o que vem depois:

**Ele é escrito para outros desenvolvedores.** "corrige limite de uso em
`POST /chat/message`" é uma frase precisa e completamente inadequada para quem
integra com o produto e quer saber se precisa mexer no código.

**A maior parte dele não interessa a ninguém de fora.** Neste repositório, num
mês, 97 commits — quase todos manutenção.

Publicar automaticamente significaria colocar no site, sem ninguém ler, um
documento que clientes usam para decidir se agendam trabalho.

## Decisão

**A automação faz o trabalho todo e para num pull request.**

```mermaid
flowchart LR
    cron["<b>Dia 1º, 08:00</b><br/>ou disparo manual"]
    ler["<b>Ler commits</b><br/>janela do mês anterior"]
    filtrar["<b>Filtrar</b><br/>manutenção sai"]
    resolver["<b>Resolver endpoints</b><br/>contra o ApiModel"]
    render["<b>Renderizar</b><br/>MDX com frontmatter"]
    verificar["<b>Verificar</b><br/>build + docs:test"]
    pr["<b>Pull request</b>"]
    humano(["<b>Revisão humana</b>"])
    site["<b>Publicado</b>"]

    cron --> ler --> filtrar --> resolver --> render --> verificar --> pr --> humano --> site

    classDef auto fill:#438dd5,stroke:#2e6295,color:#fff
    classDef parada fill:#c8553d,stroke:#8c3b2b,color:#fff
    class cron,ler,filtrar,resolver,render,verificar,pr auto
    class humano,site parada
```

Três regras derivadas, e cada uma resolve um jeito diferente de o documento
mentir:

**Mês sem nada relevante não vira página.** E a saída separa "vazio porque nada
aconteceu" de "vazio porque nenhum commit segue a convenção". As duas produzem a
mesma página em branco e levam a conclusões opostas.

**Endpoint só vira link se existir na especificação.** O que não resolve sai como
código, com a pendência registrada. Um changelog é lido por quem vai tentar usar
aquilo; um link quebrado ali custa mais que a ausência do link.

**Pendência aparece na página, não só no log.** Uma depreciação sem data de fim
de vida sai marcada como incompleta. Registrar a falta apenas no console da
automação entregaria ao leitor um documento que parece completo.

## Consequências

**O que melhorou.** O trabalho mecânico — ler 97 commits, separar, agrupar,
resolver endpoints, montar frontmatter — sai de graça todo mês. O que sobra para
a pessoa é a parte que exige julgamento: a tradução ficou de pé?

**O que custou.** Ninguém revisa o pull request, ninguém publica. A automação não
garante que o changelog saia — garante que ele esteja pronto.

E o resultado depende da disciplina de commit. Um repositório sem Conventional
Commits gera changelog vazio. É por isso que a saída relata a cobertura da
convenção em vez de só devolver vazio.

**O que passou a ser possível.** Ligar a automação sem a pergunta "e se ela
publicar bobagem?". A resposta é estrutural: ela não publica.

## Alternativas consideradas

**Publicar direto na branch principal.** É o que a issue pede literalmente, e o
que produz o primeiro mês em que um cliente lê jargão interno no site. O pull
request é a mesma automação com um passo de leitura.

**Não filtrar, e publicar tudo com formatação bonita.** Gera uma página que o
leitor abre uma vez, não reconhece nada, e nunca mais abre — pior que não ter
changelog, porque consome a confiança dele.

**Gerar a partir de PRs e issues em vez de commits.** Traria contexto de negócio
melhor, e uma dependência da API do provedor de Git no caminho crítico —
contra a [ADR-0016](0016-degradacao-em-vez-de-dependencia.md). Os commits estão
no repositório que a automação já tem clonado.

**Reescrever tudo com modelo de linguagem.** Existe como opção, desligada por
padrão: ligá-la faria o resultado depender de um segredo que nem toda instalação
tem, e um changelog reescrito por modelo precisa da mesma revisão humana — o
ganho é de redação, não de confiança.
