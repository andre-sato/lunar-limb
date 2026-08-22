---
type: API Reference
title: Streetlights Kafka API
description: The Smartylighting Streetlights API allows you to remotely manage the city lights.
resource: https://docs.suaempresa.com/api-reference/streetlights-kafka/
tags:
  - api
  - eventos
status: stable
generated:
  by: process:okf-export
  at: '2026-08-22T12:12:38.074Z'
sources:
  - id: repo
    resource: src/content/docs/api-reference/streetlights-kafka.md
    title: src/content/docs/api-reference/streetlights-kafka.md no repositório
    last_modified: '2026-08-22T00:41:25.364Z'
owner:
  type: team
  id: documentation
---

**Página gerada**
Esta página é gerada a partir de `src/schemas/streetlights-kafka.asyncapi.yaml` pelo comando
`npm run docs:asyncapi`. Edite a especificação, não esta página.

| Propriedade | Valor |
| --- | --- |
| Especificação | AsyncAPI `2.6.0` |
| Versão da API | `1.0.0` |
| Content type padrão | `application/json` |
| Licença | [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0) |

## Visão geral

The Smartylighting Streetlights API allows you to remotely manage the city lights.

### Check out its awesome features:

* Turn a specific streetlight on/off 🌃
* Dim a specific streetlight 😎
* Receive real-time information about environmental lighting conditions 📈

## Servidores

### scram-connections

Test broker secured with scramSha256

| Propriedade | Valor |
| --- | --- |
| Endereço | `test.mykafkacluster.org:18092` |
| Protocolo | `kafka-secure` |
| Segurança | `saslScram` |

| Tag | Significado |
| --- | --- |
| `env:test-scram` | This environment is meant for running internal tests through scramSha256 |
| `kind:remote` | This server is a remote server. Not exposed by the application |
| `visibility:private` | This resource is private and only available to certain users |

### mtls-connections

Test broker secured with X509

| Propriedade | Valor |
| --- | --- |
| Endereço | `test.mykafkacluster.org:28092` |
| Protocolo | `kafka-secure` |
| Segurança | `certs` |

| Tag | Significado |
| --- | --- |
| `env:test-mtls` | This environment is meant for running internal tests through mtls |
| `kind:remote` | This server is a remote server. Not exposed by the application |
| `visibility:private` | This resource is private and only available to certain users |

## Canais

### `smartylighting.streetlights.1.0.event.{streetlightId}.lighting.measured`

The topic on which measured values may be produced and consumed.

**Parâmetros do endereço**

| Parâmetro | Tipo | Descrição |
| --- | --- | --- |
| `{streetlightId}` | string | The ID of the streetlight. |

#### receiveLightMeasurement

Operação `publish`: você **publica** mensagens neste canal.

Inform about environmental lighting conditions of a particular streetlight.

**Mensagem:** Light measured

Inform about environmental lighting conditions of a particular streetlight.

Content type: `application/json`

**Payload**

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | :-: | --- |
| `lumens` | integer (mín. 0) |  | Light intensity measured in lumens. |
| `sentAt` | string (date-time) |  | Date and time when the message was sent. |

**Cabeçalhos**

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | :-: | --- |
| `my-app-header` | integer (mín. 0, máx. 100) |  |  |

**Bindings**

- `kafka` · `clientId`: string — `my-app-id`

### `smartylighting.streetlights.1.0.action.{streetlightId}.turn.on`

**Parâmetros do endereço**

| Parâmetro | Tipo | Descrição |
| --- | --- | --- |
| `{streetlightId}` | string | The ID of the streetlight. |

#### turnOn

Operação `subscribe`: você **consome** mensagens deste canal.

**Mensagem:** Turn on/off

Command a particular streetlight to turn the lights on or off.

Content type: `application/json`

**Payload**

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | :-: | --- |
| `command` | string — `on` ou `off` |  | Whether to turn on or off the light. |
| `sentAt` | string (date-time) |  | Date and time when the message was sent. |

**Cabeçalhos**

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | :-: | --- |
| `my-app-header` | integer (mín. 0, máx. 100) |  |  |

**Bindings**

- `kafka` · `clientId`: string — `my-app-id`

### `smartylighting.streetlights.1.0.action.{streetlightId}.turn.off`

**Parâmetros do endereço**

| Parâmetro | Tipo | Descrição |
| --- | --- | --- |
| `{streetlightId}` | string | The ID of the streetlight. |

#### turnOff

Operação `subscribe`: você **consome** mensagens deste canal.

**Mensagem:** Turn on/off

Command a particular streetlight to turn the lights on or off.

Content type: `application/json`

**Payload**

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | :-: | --- |
| `command` | string — `on` ou `off` |  | Whether to turn on or off the light. |
| `sentAt` | string (date-time) |  | Date and time when the message was sent. |

**Cabeçalhos**

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | :-: | --- |
| `my-app-header` | integer (mín. 0, máx. 100) |  |  |

**Bindings**

- `kafka` · `clientId`: string — `my-app-id`

### `smartylighting.streetlights.1.0.action.{streetlightId}.dim`

**Parâmetros do endereço**

| Parâmetro | Tipo | Descrição |
| --- | --- | --- |
| `{streetlightId}` | string | The ID of the streetlight. |

#### dimLight

Operação `subscribe`: você **consome** mensagens deste canal.

**Mensagem:** Dim light

Command a particular streetlight to dim the lights.

Content type: `application/json`

**Payload**

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | :-: | --- |
| `percentage` | integer (mín. 0, máx. 100) |  | Percentage to which the light should be dimmed to. |
| `sentAt` | string (date-time) |  | Date and time when the message was sent. |

**Cabeçalhos**

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | :-: | --- |
| `my-app-header` | integer (mín. 0, máx. 100) |  |  |

**Bindings**

- `kafka` · `clientId`: string — `my-app-id`

## Schemas

### `lightMeasuredPayload`

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | :-: | --- |
| `lumens` | integer (mín. 0) |  | Light intensity measured in lumens. |
| `sentAt` | string (date-time) |  | Date and time when the message was sent. |

### `turnOnOffPayload`

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | :-: | --- |
| `command` | string — `on` ou `off` |  | Whether to turn on or off the light. |
| `sentAt` | string (date-time) |  | Date and time when the message was sent. |

### `dimLightPayload`

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | :-: | --- |
| `percentage` | integer (mín. 0, máx. 100) |  | Percentage to which the light should be dimmed to. |
| `sentAt` | string (date-time) |  | Date and time when the message was sent. |

## Autenticação

| Esquema | Tipo | Como usar |
| --- | --- | --- |
| `saslScram` | `scramSha256` | Provide your username and password for SASL/SCRAM authentication |
| `certs` | `X509` | Download the certificate files from service provider |
