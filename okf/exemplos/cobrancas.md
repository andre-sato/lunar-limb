---
type: Example
title: Cobranças
description: Criar, consultar, listar e estornar cobranças na API fictícia da Órbita, com os erros que cada operação devolve.
resource: https://docs.suaempresa.com/exemplos/cobrancas/
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
    at: '2026-08-19T00:00:00.000Z'
stale_after: '2026-11-17T00:00:00.000Z'
sources:
  - id: repo
    resource: src/content/docs/exemplos/cobrancas.mdx
    title: src/content/docs/exemplos/cobrancas.mdx no repositório
    last_modified: '2026-08-22T00:41:25.377Z'
audiences:
  - developer
  - support
owner:
  type: team
  id: documentation
---

Uma cobrança é a intenção de receber um valor. Ela nasce `pendente`, vira `aprovada` ou `recusada`, e pode ser `estornada` depois de aprovada.

```text
                 ┌───────────┐
    criada ─────►│ pendente  │
                 └─────┬─────┘
                       │
          ┌────────────┴────────────┐
          ▼                         ▼
   ┌─────────────┐           ┌─────────────┐
   │  aprovada   │           │  recusada   │──► fim
   └──────┬──────┘           └─────────────┘
          │
          ▼
   ┌─────────────┐
   │  estornada  │──► fim
   └─────────────┘
```

Não há caminho de `recusada` para `aprovada`. Uma cobrança recusada é definitiva — para tentar de novo, crie outra.

## Criar

```bash
curl -X POST https://api.orbita.exemplo/v1/cobrancas \
  -H "Authorization: Bearer $ORBITA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "valor": 4990, "moeda": "BRL", "descricao": "Assinatura" }'
```

```ts
const cobranca = await orbita.cobrancas.create({
  body: { valor: 4990, moeda: 'BRL', descricao: 'Assinatura' },
});
```

```python
cobranca = orbita.cobrancas.create(
    valor=4990,
    moeda="BRL",
    descricao="Assinatura",
)
```

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | :-: | --- |
| `valor` | inteiro | ✓ | Centavos. `4990` são R$ 49,90. |
| `moeda` | string | ✓ | `BRL`, `USD` ou `EUR`. |
| `descricao` | string | ✓ | Até 120 caracteres. Aparece na fatura do cliente. |
| `cliente.email` | string | | Para onde vai o recibo. |
| `metadata` | objeto | | Até 20 chaves suas, devolvidas em todo evento. |
| `idempotencyKey` | string | | Ver abaixo. |

### Idempotência

Repetir um `POST` sem `idempotencyKey` cria **duas cobranças**. Com ela, a segunda chamada devolve a primeira cobrança em vez de criar outra:

```bash
curl -X POST https://api.orbita.exemplo/v1/cobrancas \
  -H "Idempotency-Key: pedido-4471" \
  ...
```

A chave vale 24 horas. Depois disso ela é esquecida, e uma repetição volta a criar.

**Use o identificador do seu pedido**
A tentação é gerar um UUID novo a cada tentativa — o que anula a idempotência, porque cada tentativa vira uma chave diferente. A chave precisa ser derivada do **pedido**, não da tentativa.

## Consultar

```http
GET /v1/cobrancas/{id}
Authorization: Bearer orb_test_exemplo

HTTP/1.1 200 OK
Content-Type: application/json

{
  "id": "cob_8f2a",
  "status": "aprovada",
  "valor": 4990,
  "moeda": "BRL",
  "descricao": "Assinatura",
  "criadaEm": "2026-08-19T14:32:00Z",
  "aprovadaEm": "2026-08-19T14:32:03Z"
}
```

## Listar

```http
GET /v1/cobrancas?status=aprovada&limite=50&depois=cob_8f2a
```

A paginação é por cursor, não por página. `depois` recebe o `id` do último item recebido.

Paginação por número de página desalinha quando um item novo entra no topo entre duas chamadas: a página 2 passa a começar onde a 1 terminou menos um. Com cursor, o ponto de corte é um item concreto.

## Estornar

```bash
curl -X POST https://api.orbita.exemplo/v1/cobrancas/cob_8f2a/estornos \
  -H "Authorization: Bearer $ORBITA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "valor": 4990 }'
```

Omitir `valor` estorna o total. Informar um valor menor faz um estorno parcial, e é possível estornar parcialmente mais de uma vez até chegar ao total.

## Erros

| Código | `codigo` | Quando |
| --- | --- | --- |
| `400` | `corpo_invalido` | JSON malformado. |
| `401` | `nao_autenticado` | Chave ausente, inválida ou revogada. |
| `403` | `sem_permissao` | A chave não tem escopo para escrever. |
| `404` | `nao_encontrada` | Cobrança de outra organização, ou id inexistente. |
| `409` | `estado_invalido` | Estornar cobrança que não está `aprovada`. |
| `422` | `valor_invalido` | Valor decimal, zero ou negativo. |
| `429` | `limite_excedido` | Ver o cabeçalho `Retry-After`. |
| `500` | `erro_interno` | Nosso. Repita com a mesma `Idempotency-Key`. |

Todo erro traz a mesma forma:

```json
{
  "erro": {
    "codigo": "valor_invalido",
    "mensagem": "O campo `valor` precisa ser um inteiro em centavos.",
    "campo": "valor",
    "requestId": "req_2c91"
  }
}
```

O `requestId` é o que o suporte pede. Ele identifica a requisição nos nossos registros por 30 dias.

**`404` para cobrança de outra organização**
Uma cobrança que existe mas pertence a outra organização devolve `404`, não `403`.

`403` confirmaria que o identificador existe, o que permite descobrir quais ids são válidos testando um por um. O `404` não confirma nada.

---

### O que esta página demonstra

| Recurso | Onde aparece |
| --- | --- |
| [Diagramas](/guides/diagramas.md) | O diagrama de estados da cobrança |
| [Testes de documentação](/guides/testes-de-documentacao.md) | Os exemplos `http` são conferidos por `npm run docs:test` |
| [Contratos de documentação](/guides/contratos-de-documentacao.md) | O bloco `http` com requisição e resposta completas |
| Componentes da Starlight | `<Tabs>` com três linguagens, `:::caution`, `:::note` |
