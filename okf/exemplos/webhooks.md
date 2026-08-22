---
type: Example
title: Webhooks
description: Como a Órbita avisa a sua aplicação, como verificar a assinatura e por que a entrega é "pelo menos uma vez".
resource: https://docs.suaempresa.com/exemplos/webhooks/
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
    resource: src/content/docs/exemplos/webhooks.mdx
    title: src/content/docs/exemplos/webhooks.mdx no repositório
    last_modified: '2026-08-22T00:41:25.377Z'
audiences:
  - developer
  - support
owner:
  type: team
  id: documentation
---

A resposta do `POST /v1/cobrancas` chega antes da autorização. Quem conta o desfecho é o webhook.

## Entrega

```text
Órbita                              Seu endpoint
   │                                      │
   │  POST /webhooks/orbita               │
   ├─────────────────────────────────────►│  processa
   │                        200           │
   │◄─────────────────────────────────────┤
   │  entregue                            │
   │                                      │
   │  POST /webhooks/orbita               │
   ├─────────────────────────────────────►│  falhou
   │                        500           │
   │◄─────────────────────────────────────┤
   │  reenvia em 1min → 5min → 30min      │
   │            → 2h → 12h                │
```

A Órbita considera entregue qualquer resposta `2xx`. Qualquer outra coisa — inclusive tempo esgotado — entra na fila de reenvio, com cinco tentativas espaçadas ao longo de quase 15 horas.

**Pelo menos uma vez, nunca exatamente uma vez**
Seu endpoint **vai** receber o mesmo evento duas vezes em algum momento. Isso não é defeito: é a única garantia que uma entrega por rede consegue dar sem coordenação distribuída.

Trate `evento.id` como chave de deduplicação. Um evento já processado deve devolver `200` sem reprocessar.

## Formato

```json
{
  "id": "evt_4d81",
  "tipo": "cobranca.aprovada",
  "criadoEm": "2026-08-19T14:32:03Z",
  "dados": {
    "cobranca": {
      "id": "cob_8f2a",
      "status": "aprovada",
      "valor": 4990
    }
  }
}
```

| Evento | Quando |
| --- | --- |
| `cobranca.aprovada` | A adquirente autorizou. |
| `cobranca.recusada` | A adquirente negou. |
| `cobranca.estornada` | Estorno total ou parcial concluído. |
| `cobranca.contestada` | O portador abriu contestação. |

## Verificar a assinatura

Todo webhook traz `X-Orbita-Signature`:

```text
t=1787141400,v1=5d41402abc4b2a76b9719d911017c592
```

```ts

  const partes = Object.fromEntries(
    cabecalho.split(',').map((parte) => parte.split('=') as [string, string])
  );

  // A janela de cinco minutos impede replay de um webhook capturado ontem.
  const idade = Math.abs(Date.now() / 1000 - Number(partes.t));
  if (!Number.isFinite(idade) || idade > 300) return false;

  const esperado = createHmac('sha256', segredo).update(`${partes.t}.${corpo}`).digest();
  const recebido = Buffer.from(partes.v1 ?? '', 'hex');

  // Comparação em tempo constante: `===` vaza, pelo tempo de resposta, quantos
  // bytes iniciais estavam certos — o bastante para descobrir a assinatura byte
  // a byte.
  return esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
}
```

**Verifique sobre o corpo bruto**
A assinatura cobre os **bytes recebidos**. Se o seu framework já converteu o JSON em objeto, reserializá-lo muda espaços e ordem de chaves, e a verificação falha para webhooks legítimos.

No Express, use `express.raw({ type: 'application/json' })` nessa rota.

## Eventos de assinatura (beta)

Com a flag `beta` ligada, a Órbita também emite eventos de assinatura recorrente:

| Evento | Quando |
| --- | --- |
| `assinatura.renovada` | Ciclo cobrado com sucesso. |
| `assinatura.falhou` | Cobrança do ciclo recusada. |
| `assinatura.cancelada` | Cancelada pelo cliente ou por inadimplência. |

O formato do payload ainda pode mudar sem aviso — é o que "beta" significa aqui.

**Eventos de assinatura**
A Órbita está testando eventos de assinatura recorrente com um grupo fechado. Ligue a variável `beta` para ver a documentação deles.

## Entrega dedicada

No plano enterprise, os webhooks saem de uma faixa de IP dedicada à sua organização, e o limite de reenvio sobe de cinco para doze tentativas ao longo de três dias.

## Testar localmente

```bash
orbita webhooks encaminhar --para http://localhost:3000/webhooks/orbita
```

O comando abre um túnel temporário e imprime cada evento recebido. Ele usa o **segredo de teste**, diferente do de produção — um webhook de teste verificado com o segredo de produção falha, e é assim que deve ser.

---

### O que esta página demonstra

| Recurso | Onde aparece |
| --- | --- |
| [Conteúdo condicional](/guides/conteudo-condicional.md) | Os três blocos `<If>`: `beta`, `beta not` e `plano equals` |
| [Diagramas](/guides/diagramas.md) | O diagrama de sequência da entrega e do reenvio |
| Componentes da Starlight | `:::caution`, `:::danger`, `:::note` |
| [Linter](/guides/linter-e-quality-score.md) | Terminologia canônica e legibilidade da página |

O trecho de assinatura em beta **não vai para o HTML** quando a flag está desligada — ele não fica escondido por CSS. É a diferença entre conteúdo condicional e controle de acesso que o guia explica.
