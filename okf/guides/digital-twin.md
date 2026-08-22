---
type: Guide
title: Digital Twin
description: A relação entre produto e documentação — o que está documentado, o que não tem implementação, e o que quebra se mudar.
resource: https://docs.suaempresa.com/guides/digital-twin/
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
    resource: src/content/docs/guides/digital-twin.mdx
    title: src/content/docs/guides/digital-twin.mdx no repositório
    last_modified: '2026-08-22T00:41:25.387Z'
audiences:
  - developer
  - product
owner:
  type: team
  id: documentation
---

O Content Graph responde "quem usa o quê" dentro da documentação. O Digital Twin
sobe um nível e responde sobre o **produto**:

- Quais partes do produto estão documentadas?
- Quais páginas documentam coisas que não existem mais?
- O que será afetado se este endpoint mudar?

## Ele não é uma fonte de verdade

A fonte continua sendo o Git — Markdown, MDX, OpenAPI, AsyncAPI e o código. O
Twin é **derivado** a cada análise: ele lê essas fontes e monta a relação entre
elas. Nada aqui é editável, e não existe arquivo dizendo como o produto é.

Se o grafo discordar do repositório, quem está errado é o grafo.

## De onde vêm as relações

| Fonte | O que ela dá |
| --- | --- |
| Content Graph | páginas, blocos reutilizáveis, `uses` e `used-by` — preservados como estavam |
| OpenAPI | especificações, endpoints, schemas, exemplos |
| Roteamento por arquivo | quais endpoints o código **implementa** |
| Páginas | quais endpoints elas **documentam** |
| Glossário, testes, versões | termos, validação e ciclo de vida |

Cada relação registra **como** foi obtida. `declared` é alguém tendo escrito a
ligação — um `<TryIt schema=… operation=…/>`, uma anotação de proveniência.
`derived` é convenção: o roteamento por arquivo da Astro, ou o caminho literal do
endpoint aparecendo no texto.

A distinção existe porque as duas erram de formas diferentes, e um relatório que
as mistura não permite julgar o quanto confiar nele.

### O código, aqui

`src/pages/api/auth/me.ts` que exporta `GET` implementa `GET /api/auth/me`. Isso
**não é heurística** — é a regra do framework, e por isso o "Code Graph" desta
base é exato.

Acrescentar análise de TypeScript genérico, Java ou Python depois significa
produzir a mesma lista de `{ arquivo, caminho, métodos }` de outro jeito. O grafo
não muda.

## Cobertura documental

```bash
npm run twin -- coverage
```

Quatro fatias: **endpoints** documentados sobre o total, **schemas**,
**exemplos** (medidos sobre os endpoints documentados, não sobre todos — cobrar
exemplo de endpoint sem página seria cobrar duas coisas na mesma linha) e
**domínios**, que vêm das tags da própria especificação.

Fatia sem nada para medir aparece como `—`, não como 0%. As duas coisas levam a
decisões diferentes.

### Rotas internas ficam fora

O portal tem 45 rotas internas — editor, painel administrativo — contra alguns
endpoints públicos. Com elas na conta, a primeira medição real deu **6%**, que é
um número que qualquer equipe aprende a ignorar.

Elas continuam no grafo e continuam listáveis; o que muda é não pesarem num
indicador que existe para falar da documentação **do produto**. Os prefixos ficam
em `twin.yml`.

A exceção é o critério de publicação: **endpoint declarado numa especificação é
público por definição** — declarar o contrato é publicá-lo — e conta mesmo que o
caminho case com um prefixo interno.

## As duas perguntas inversas

```bash
npm run twin -- undocumented
npm run twin -- stale
```

Elas são simétricas e têm severidades muito diferentes.

**Implementação sem documentação** é dívida certa: o endpoint existe, alguém vai
chamá-lo.

**Documentação sem implementação** é *potencialmente* obsoleta — e a palavra é a
política. A página pode estar documentando comportamento histórico, versão
anterior, um conceito ou algo ainda planejado. Chamar isso de erro automático
transformaria documentação legítima em alarme, e alarme falso é como se ensina
uma equipe a ignorar o painel.

## Perguntas

```bash
npm run twin -- ask "quais APIs não estão documentadas?"
npm run twin -- ask "onde está documentado GET /api/auth/me?"
```

É reconhecimento de padrão, não modelo de linguagem: as perguntas úteis aqui são
poucas e conhecidas, e resolvê-las com um LLM traria custo, latência e chance de
errar em troca de nada. Pergunta que ele não entende recebe a lista do que ele
sabe responder — em vez de um palpite.

## Impacto

```bash
npm run twin -- impact "endpoint:GET /api/auth/me"
```

Caminha as relações para trás, em largura, e devolve o que muda junto com o
caminho percorrido — contado por tipo: páginas, exemplos, blocos, termos.

## Na interface e no CI

**Settings → Intelligence** traz cobertura, a lista do que não está documentado, o
que é potencialmente obsoleto e o campo de perguntas. A visualização principal é
**tabular**: um grafo com centenas de nós é bonito na captura de tela e inútil
para achar o endpoint que ninguém documentou.

No pull request, a cobertura aparece junto do Quality Score e dos testes. O limite
olha a **cobertura de endpoints**, não a média das quatro fatias — a média dilui
justamente o número que o portão existe para proteger.

```bash
npm run twin -- coverage --min 90
```

Sai com `1` quando a cobertura fica abaixo do mínimo, e com `0` quando não há
endpoint para medir: tratar "nada a medir" como violação bloquearia PRs de
portais que ainda não têm API.
