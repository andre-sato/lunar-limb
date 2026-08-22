---
type: Guide
title: Vínculo com o código
description: Como uma página declara que documenta um endpoint, o que a CI cobra a partir disso, e por que menção em texto não conta como documentação.
resource: https://docs.suaempresa.com/guides/vinculo-com-o-codigo/
tags:
  - guia
  - qualidade
  - portal
status: stable
generated:
  by: process:okf-export
  at: '2026-08-22T12:12:38.074Z'
sources:
  - id: repo
    resource: src/content/docs/guides/vinculo-com-o-codigo.mdx
    title: src/content/docs/guides/vinculo-com-o-codigo.mdx no repositório
    last_modified: '2026-08-22T00:41:25.398Z'
audiences:
  - developer
  - product
owner:
  type: team
  id: documentation
---

Uma frase citando `POST /api/payments` no meio de um tutorial não documenta o endpoint. O portal só considera documentado o que alguma página **declara** documentar.

Essa declaração é o vínculo, e ela vive no frontmatter da página:

```yaml
---
title: Pagamentos
documentation:
  bindings:
    - type: api
      id: POST /api/payments
    - type: api
      id: GET /api/payments/{id}
---
```

## Por que no frontmatter, e não no código

A direção de dependência é fixa:

```
Código → contrato de documentação → documentação
```

O código não sabe que este portal existe. Se uma anotação no código apontasse para uma página, um `git mv` de Markdown quebraria o build do produto — e a documentação passaria a impor risco ao que ela deveria descrever.

## O que o vínculo destrava

Declarado o vínculo, quatro perguntas passam a ter resposta automática:

| Pergunta | Comando |
| --- | --- |
| O que esta mudança de código afeta na documentação? | `npm run docs:code -- impact` |
| Que entidade pública ninguém assumiu? | `npm run docs:code -- undocumented` |
| Que vínculo aponta para algo que não existe mais? | `npm run docs:code -- orphans` |
| Código e documentação concordam? | `npm run docs:code -- consistency` |

```bash
npm run docs:code -- impact --diff main...HEAD
```

O relatório separa duas situações que é tentador somar e caro confundir:

- **Sem página nenhuma** — a entidade mudou e ninguém a documenta. Precisa de página nova.
- **Página que ficou para trás** — existe página vinculada, mas ela não foi atualizada no mesmo conjunto de mudanças. Precisa de revisão daquela página, não de uma segunda.

Criar uma página nova para o segundo caso é como um portal ganha duas respostas para a mesma pergunta.

## Consistência não é cobertura

São dois números diferentes, e a tela de Settings → Code Loop os mostra separados de propósito:

- **Consistência** — dos vínculos declarados, quantos apontam para algo que existe.
- **Cobertura** — das entidades públicas, quantas têm vínculo declarado.

Uma página com três vínculos corretos tem 100% de consistência e pode conviver com dez endpoints sem documentação nenhuma. Um número só esconderia exatamente o buraco.

Quando uma fatia não tem nada declarado — nenhum vínculo de CLI, por exemplo — ela aparece como `—`, nunca como 0%. Ausência de dado não é inconsistência.

## O portão de CI

A política fica em `codeloop.yml`:

```yaml
documentation:
  bindings:
    requiredFor:
      - public-api
      - public-event
      - cli-command
  policy:
    apiChanges:
      requireDocs: true
    breakingChanges:
      requireMigrationGuide: true
    releases:
      minimumCoverage: 95
    failOnViolation: true
```

`requiredFor` lista só o que é publicado. Exigir documentação de toda função interna transformaria a política numa fila impossível — e o primeiro efeito disso é alguém desligá-la inteira, inclusive para o que importa.

Pela mesma razão, **só violação de item obrigatório bloqueia**. Uma função interna sem página, ou uma API cuja documentação está um commit atrás, entra como aviso.

O portão roda junto com os outros na revisão de PR, e o corpo do PR ganha uma seção com as entidades sem página vinculada e as páginas que ficaram para trás.

## Precisão do impacto

Corrigir uma palavra num `summary` da especificação não marca todos os endpoints do arquivo como alterados: o portal cruza as linhas que o Git reporta como modificadas com as faixas de cada operação, e só entra quem foi realmente tocado.

Quando não dá para saber quais linhas mudaram — arquivo novo, por exemplo — o arquivo inteiro entra. É o lado seguro do erro.

## Vínculo que não resolve

Um identificador escrito à mão que não corresponde a nada no [Digital Twin](/guides/digital-twin.md) **não** conta como cobertura. Ele aparece marcado, com o motivo. Aceitá-lo transformaria a métrica em ficção — um portal poderia declarar 100% de cobertura sobre endpoints que não existem.

Esses vínculos aparecem em `orphans`, e sempre como *potencialmente* órfãos: a página pode documentar comportamento histórico, uma versão anterior ou algo ainda planejado.

## Fechando o ciclo

```bash
npm run docs:code -- tasks
```

Transforma o impacto em tarefas para os [agentes de documentação](/guides/agentes-de-documentacao.md) — `create` para o que não tem página, `update` restrito à página que ficou para trás.

São **propostas**. Nada é escrito por este comando: quem redige é o Orchestrator, em workspace isolado, e nada é publicado sem aprovação humana.
