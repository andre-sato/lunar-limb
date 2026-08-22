---
type: Guide
title: Contratos de documentação
description: A verificação que pergunta se o exemplo representa o contrato de verdade — schemas, parâmetros, status, autenticação e exemplos de código.
resource: https://docs.suaempresa.com/guides/contratos-de-documentacao/
tags:
  - guia
  - qualidade
  - api
status: stable
generated:
  by: process:okf-export
  at: '2026-08-22T12:12:38.074Z'
sources:
  - id: repo
    resource: src/content/docs/guides/contratos-de-documentacao.mdx
    title: src/content/docs/guides/contratos-de-documentacao.mdx no repositório
    last_modified: '2026-08-22T00:41:25.384Z'
audiences:
  - developer
owner:
  type: team
  id: platform
---

A Documentation Test Suite pergunta **"este exemplo funciona?"**. Esta camada
pergunta outra coisa:

**"este exemplo representa o contrato de verdade?"**

A diferença decide casos reais. A API exige `amount` e `currency`; a documentação
mostra só `amount`. O exemplo até roda em algumas circunstâncias — e está
incompleto em relação ao contrato. Nenhum teste de execução pega isso.

```bash
npm run contract -- test
npm run contract -- test --changed
npm run contract -- report
```

## O que é verificado

| Dimensão | O que se compara |
| --- | --- |
| Método e caminho | o que a página mostra contra a operação da especificação |
| Requisição | o exemplo satisfaz o schema — **e** não mostra campo que o contrato não tem |
| Resposta | idem, contra o schema da resposta de sucesso |
| Parâmetros | os citados existem; os obrigatórios aparecem |
| Códigos de status | os citados estão declarados |
| Autenticação | o mecanismo documentado é o exigido |
| Exemplo de código | as chaves usadas batem com o contrato |

### Os dois sentidos da comparação

O sentido óbvio é "o exemplo satisfaz o schema". O que falta em quase toda
ferramenta, e é o motivo desta camada existir, é o **inverso**: campo que o
exemplo mostra e o contrato não tem.

É assim que uma documentação envelhece sem quebrar. Ela continua mostrando um
campo que a API removeu, e todo teste de execução continua passando.

Numa **requisição**, campo a mais é aviso — pode ser extensão aceita pelo
servidor. Numa **resposta**, é quebra: a documentação está prometendo ao leitor um
dado que a API não devolve.

## Associação página ↔ contrato

Duas fontes, e a inferência é priorizada para reduzir trabalho manual. A
associação vem do **Digital Twin** — esta camada não mantém grafo próprio, senão
os dois divergiriam na primeira mudança.

Quando a inferência não basta, declare:

```yaml
---
title: Pagamentos
contract:
  type: openapi
  ref: "#/paths/~1payments/post"
---
```

O que está declarado ganha do que foi inferido: a declaração é a intenção de quem
escreveu.

## Os quatro estados

🟢 **Válido** · 🟡 **Aviso** · 🔴 **Quebrado** · ⚪ **Desconhecido**

Contrato sem página associada fica **desconhecido**, nunca válido. Ele não está
certo — está sem documentação, e isso é assunto da cobertura do Digital Twin. Se
contasse como válido, o score subiria com endpoints que ninguém documentou.

No **Contract Score**, `unknown` fica fora da conta: contá-lo como erro puniria a
ausência de contrato, e como acerto premiaria a mesma ausência. `warning` conta
como verificado e não conta como bom — ele é meio caminho, e arredondá-lo para
qualquer lado esconderia o que ele é.

## No pull request e no merge

O PR mostra os contratos quebrados com arquivo e linha. O bloqueio é configurável
em `contracts.yml`:

```yaml
failOnBreaking: true
```

**Só `invalid` bloqueia.** Aviso nunca — parâmetro obrigatório que a página não
lista, campo a mais numa requisição. Travar merge por meio caminho leva a equipe a
desligar o portão inteiro, que é o resultado oposto ao pretendido.

## Baseline, para adotar aos poucos

APIs sem OpenAPI completo podem declarar o mínimo em `contracts.yml`:

```yaml
contracts:
  - endpoint: POST /api/users
    response:
      status: '201'
    required: [id, email]
```

Passa a haver verificação sobre isso enquanto a especificação não existe.

## No Quality Score

Contract entra como **mais uma dimensão ao lado** da nota editorial, como Trust já
fazia. O Quality Score existente não é recalculado nem substituído.
