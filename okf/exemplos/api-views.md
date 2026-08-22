---
type: Example
title: Uma API, três produtos
description: A mesma especificação da Órbita virando visão pública, de parceiro e interna — com o overlay real que faz cada recorte.
resource: https://docs.suaempresa.com/exemplos/api-views/
tags:
  - exemplo
  - api
  - portal
status: stable
generated:
  by: process:okf-export
  at: '2026-08-22T12:12:38.074Z'
verified:
  - by: human:mestre
    at: '2026-08-21T00:00:00.000Z'
stale_after: '2026-11-19T00:00:00.000Z'
sources:
  - id: repo
    resource: src/content/docs/exemplos/api-views.mdx
    title: src/content/docs/exemplos/api-views.mdx no repositório
    last_modified: '2026-08-22T00:41:25.377Z'
audiences:
  - developer
  - product
  - operations
owner:
  type: team
  id: documentation
---

A Órbita tem uma especificação OpenAPI e três públicos que precisam ver coisas
diferentes dela. Esta página mostra o recorte acontecendo — não a mecânica, que
está no guia de [overlays e API Views](/guides/overlays-e-api-views.md).

## A base

```text
POST   /v1/cobrancas              criar cobrança
GET    /v1/cobrancas/{id}         consultar
GET    /v1/cobrancas              listar
POST   /v1/cobrancas/{id}/estornos  estornar
POST   /v1/webhooks/testar        disparar webhook de teste
GET    /v1/interno/conciliacao    relatório de conciliação
POST   /v1/interno/reprocessar    reprocessar fila
```

Sete operações. Duas delas — as sob `/v1/interno/` — são de ferramenta de
operação e exigem uma chave que só o time da Órbita tem.

Elas **precisam** estar na especificação: é ela que o Digital Twin lê para saber
o que o produto implementa. Se saíssem de lá, a cobertura reportaria 5 de 5 e
esconderia que duas rotas em produção não têm documentação nenhuma.

## Três views

```text
                    orbita-api.yaml
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
     public            partner           interna
   5 operações        6 operações       7 operações
        │                 │                 │
        ▼                 ▼                 ▼
   docs.orbita      partners.orbita     wiki interna
   SDK público      SDK de parceiro          —
```

Nenhuma delas é uma cópia. As três leem o mesmo arquivo.

## O overlay público

```yaml
overlay: 1.0.0

info:
  title: Órbita — API pública
  version: 2.0.0

x-lunar:
  owner: pagamentos
  purpose: public-api
  environment: production

actions:
  - target: "$.paths['/v1/interno/conciliacao']"
    description: >-
      Ferramenta de operação. Exige chave de operador e não tem estabilidade de
      contrato — muda junto com o processo de fechamento.
    remove: true

  - target: "$.paths['/v1/interno/reprocessar']"
    description: Idem. Reprocessar fila é operação manual, não integração.
    remove: true

  - target: "$.paths['/v1/webhooks/testar']"
    description: >-
      Existe, é estável, e não faz sentido fora do ambiente de teste. Fica de
      fora da referência pública para não sugerir uso em produção.
    remove: true

  - target: "$.info"
    description: Enquadra a especificação para quem chega de fora.
    update:
      description: |
        API de pagamentos da Órbita.

        Valores são sempre inteiros em centavos. A resposta de criação chega
        antes da autorização — quem conta o desfecho é o webhook.

  - target: "$.paths['/v1/cobrancas'].post"
    description: >-
      A dúvida número um do suporte: por que a cobrança volta como pendente.
      Responder na própria referência tira o assunto da fila.
    update:
      description: |
        Cria uma cobrança.

        A resposta é `201` com `status: "pendente"` — **antes** da autorização
        pela adquirente. O desfecho chega pelo webhook `cobranca.aprovada` ou
        `cobranca.recusada`.
```

Cinco ações. Três removem, duas enquadram.

Repare no que as três primeiras têm: um `description` dizendo **por que** o
endpoint sumiu. Uma segunda cópia da especificação simplesmente não os teria, e
seis meses depois ninguém saberia se a ausência foi decisão ou esquecimento.

## O overlay de parceiro

Quem integra sob contrato precisa de mais que o público — mas não de tudo.

```yaml
overlay: 1.0.0

info:
  title: Órbita — API de parceiros
  version: 2.0.0

x-lunar:
  owner: pagamentos
  purpose: partner-api
  environment: production

actions:
  - target: "$.info"
    description: Substitui o enquadramento público pelo de parceiro.
    update:
      title: Órbita — API de parceiros
      description: |
        API de pagamentos da Órbita, visão de parceiro integrado.

        Inclui o disparo de webhook de teste, disponível para parceiros com
        ambiente de homologação ativo.

  - target: "$.paths['/v1/webhooks/testar']"
    description: >-
      Devolve o endpoint que o overlay público removeu. Parceiro tem ambiente de
      homologação e precisa disparar evento de teste.
    update:
      x-orbita-scope: partner
```

A view `partner` empilha os dois:

```yaml
views:
  partner:
    overlays:
      - overlays/public.yaml
      - overlays/partner.yaml
```

E aqui aparece um caso que vale entender.

## O conflito que o portal aponta

```bash
npm run api -- check
```

```text
✓ partner
    conflito em info: Os dois overlays atualizam o mesmo nó. O último a rodar
    vence campo a campo, então trocar a ordem das views muda o documento efetivo.
```

Os dois overlays escrevem em `$.info`. Isso **não** é um defeito — é exatamente o
que se quer: `partner` sobrescreve o enquadramento que `public` definiu.

O relatório não está pedindo correção. Está dizendo que o resultado depende da
ordem, para que a ordem seja uma decisão consciente e não um acidente de quem
listou os arquivos.

Por isso ele é aviso, e a view passa.

**O conflito que reprova é outro**
Se `public` **removesse** `/v1/webhooks/testar` e `partner` tentasse
**atualizá-lo**, o portal reprovaria com erro — a segunda ação escreveria num nó
que já não existe, e quem escreveu `partner.yaml` não teria como perceber isso
lendo o próprio arquivo.

No exemplo acima isso não acontece: `partner.yaml` usa `update`, e o `update` cria
o nó quando ele não existe. Se a intenção fosse depender do endpoint removido, o
portal avisaria.

## O alvo que parou de casar

Suponha que a Órbita renomeie `/v1/interno/conciliacao` para
`/v1/interno/fechamento`. O overlay público continua dizendo:

```yaml
- target: "$.paths['/v1/interno/conciliacao']"
  remove: true
```

O arquivo é válido. O motor roda. E o relatório de operação interna passa a
aparecer na documentação pública.

```bash
npm run overlay -- preview --view public
```

```text
  ⚠ $.paths['/v1/interno/conciliacao']
      remove
      alvo não encontrou nenhum nó
```

Com `failOnUnmatchedTarget: true`, isso reprova a CI no mesmo pull request que
renomeou o endpoint — o único momento em que alguém tem contexto para consertar.

Esse é o defeito específico desta camada: **a ação que roda com sucesso e não faz
efeito**. Não há erro, não há linha vermelha, há uma rota a mais numa página que
ninguém relê.

## O que cada view produz

```bash
npm run api -- build
```

```text
✓ .generated/openapi/base.yaml        7 operação(ões)
✓ .generated/openapi/public.yaml      4 operação(ões)
✓ .generated/openapi/partner.yaml     5 operação(ões)
```

E cada uma alimenta o pipeline inteiro:

| View | Documentação | SDK | Contratos |
| --- | --- | --- | --- |
| `public` | docs.orbita.exemplo | `@orbita/api-client` | testados contra a efetiva pública |
| `partner` | partners.orbita.exemplo | `@orbita/partner-client` | idem, contra a de parceiro |
| `base` | wiki interna | — | cobertura do Digital Twin |

Um endpoint removido por overlay **não** aparece como obrigatório no teste de
contrato da view que o removeu — o contrato testado é o efetivo, não a base.

---

### O que esta página demonstra

| Recurso | Onde aparece |
| --- | --- |
| [Overlays e API Views](/guides/overlays-e-api-views.md) | Os dois overlays completos, a view empilhada, e o build das três efetivas |
| [Governança](/guides/governanca.md) | `x-lunar.owner` e `purpose` em cada overlay |
| [Digital Twin](/guides/digital-twin.md) | O motivo de as rotas internas ficarem na base |
| [Contratos](/guides/contratos-de-documentacao.md) | Contrato testado contra a efetiva, não a base |
| [SDK](/guides/sdk.md) | Um cliente por view, do mesmo contrato |

A Órbita não existe — ver a [visão geral da vitrine](/exemplos/index.md). Os comandos e a
configuração, porém, são os reais deste portal.
