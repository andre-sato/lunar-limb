---
type: Guide
title: SDK
description: Como o portal gera um cliente TypeScript a partir da mesma especificação que já move a documentação, os contratos e o Digital Twin.
resource: https://docs.suaempresa.com/guides/sdk/
tags:
  - guia
  - api
  - portal
status: stable
generated:
  by: process:okf-export
  at: '2026-08-22T12:12:38.074Z'
verified:
  - by: human:mestre
    at: '2026-08-19T00:00:00.000Z'
stale_after: '2026-11-17T00:00:00.000Z'
sources:
  - id: repo
    resource: src/content/docs/guides/sdk.mdx
    title: src/content/docs/guides/sdk.mdx no repositório
    last_modified: '2026-08-22T00:41:25.391Z'
audiences:
  - developer
  - product
owner:
  type: team
  id: documentation
---

O SDK não é uma segunda descrição da API. Ele é a mesma descrição, impressa noutra forma:

```text
OpenAPI → ApiModel → SDK
```

Nenhum endpoint, parâmetro, schema, autenticação ou resposta é redigido de novo para o cliente. O `ApiModel` é a leitura única do OpenAPI — a mesma que alimenta o [API Explorer](/api-reference/explorer.md), o [Contract Testing](/guides/contratos-de-documentacao.md), o [Digital Twin](/guides/digital-twin.md) e a [análise de impacto](/guides/analise-de-impacto.md).

**Não existe um segundo parser.** Quando o gerador precisou de schemas nomeados, o `ApiModel` ganhou o campo; a alternativa — abrir o YAML de novo aqui — daria duas leituras da mesma especificação, e a segunda envelheceria.

## Gerar

```bash
npm run sdk -- generate
```

Local-first: nada vai à rede, e `generate` **nunca** publica. Uma geração que publica implicitamente transforma um comando de desenvolvimento num lançamento.

```text
generated/typescript/
├── src/
│   ├── client.ts
│   ├── errors.ts
│   ├── runtime/{http,serialization,auth}.ts
│   ├── models/index.ts
│   └── resources/
├── package.json
├── tsconfig.json
└── README.md
```

O pacote gerado **não tem dependência de execução**. O runtime é `fetch`, montagem de URL, cabeçalhos, tempo limite e erros. Um SDK que arrasta uma biblioteca HTTP transfere para quem instala um problema de versão que ele não escolheu ter.

## Nomes

A tag decide o recurso; o `operationId` decide o método, perdendo o prefixo do recurso — `createUser` dentro de `client.users` vira `client.users.create()`, não `client.users.createUser()`.

Sem `operationId`, o caminho distingue: `GET /users` lista, `GET /users/{id}` busca um.

Duas operações com o mesmo nome no mesmo recurso não são resolvidas em silêncio — uma delas sumiria. O nome ganha um desambiguador e a colisão é registrada como limitação.

## O que ele admite não saber

`unknown` aparece no código gerado quando a especificação não disse qual é o tipo. Um SDK que finge saber é pior que um que admite não saber: o primeiro faz o compilador aprovar uma chamada errada.

O README gerado lista o que a especificação não permitiu representar. Um gerador que engole o que não entendeu produz um cliente que parece completo e falha em produção.

## Verificar

```bash
npm run sdk -- check
```

Compila o pacote, confronta cada operação, parâmetro e modelo com a especificação, e acusa o SDK fora de sincronia. A consistência usa o mesmo `ApiModel` — não uma segunda leitura do YAML.

## Diff

```bash
npm run sdk -- diff --from HEAD~1
```

O diff **deriva do contrato**, não de comparação textual dos arquivos gerados: trocar a indentação do gerador mudaria todo arquivo e nenhum contrato.

Duas correções que a primeira execução real exigiu:

- **Referências são resolvidas antes de comparar.** Extrair um schema inline para `components/schemas` e apontar um `$ref` — refatoração pura, sem mudança de forma — aparecia como ruptura em toda operação afetada, e o portão de CI bloquearia um contrato que não mudou.
- **Requisição e resposta têm variâncias opostas.** Num corpo de requisição, campo opcional virando obrigatório quebra quem chama. Numa resposta, é uma garantia a mais para quem lê. Tratar as duas igual acusou quatro rupturas inexistentes na API deste portal.

## Nos engines que já existem

O SDK não trouxe engine nenhum próprio:

| Camada | O que o SDK acrescenta |
| --- | --- |
| Impact Engine | Um tipo de nó, `sdk`. Ruptura entra como crítica. |
| Governança | Duas dimensões: **sincronizado** e **compatível**. |
| CI | Portão na revisão de PR; só ruptura bloqueia. |
| Self-healing | Sinal de SDK desatualizado. |

“Sincronizado” e “compatível” respondem coisas diferentes: o primeiro é “o que está em disco corresponde ao contrato de hoje”, o segundo é “esta mudança quebra quem já instalou”. Um SDK pode estar em perfeita sincronia e conter uma ruptura.

O self-healing **detecta** o SDK desatualizado e não propõe redação: regerar é `npm run sdk -- generate`, determinístico e sem modelo de linguagem. Mandar um agente escrever código de cliente à mão quando existe um gerador trocaria um processo verificável por um palpite caro.

## Outra linguagem

```text
ApiModel → SdkSpecification → renderer
```

O modelo intermediário não tem nada de TypeScript. Acrescentar Python é implementar `SdkRenderer` e registrar o renderer — nada em `build.ts` muda. As decisões de nome e agrupamento ficam no modelo, e não em cada renderer: um SDK de Python com nomes diferentes obrigaria quem lê a documentação a aprender duas APIs.
