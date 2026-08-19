---
title: Feedback de página
description: O endpoint que registra o voto de utilidade de uma página, o que ele guarda e o que ele recusa a guardar.
sidebar:
  order: 4
tags: [api, portal]
owner: Time de Documentação
audiences: [developer, product]
documentation:
  bindings:
    - type: api
      id: POST /api/feedback
governance:
  owner:
    type: team
    id: documentation
  review:
    interval: 180d
    at: 2026-08-19
    by: mestre
---

<!-- provenance:
source: portal-api.yaml#/paths/~1feedback/post
source: src/pages/api/feedback.ts
verified: 2026-08-19
by: mestre
-->

Registra o voto de utilidade de uma página da documentação. É o endpoint por trás do widget "Esta página foi útil?" no rodapé.

**Não exige sessão.** Quem lê a documentação não faz login, e exigir login para dizer que uma página não ajudou reduziria o sinal a quem já é cliente — exatamente o oposto de quem mais precisa ser ouvido.

## Requisição

```http
POST /api/feedback
Content-Type: application/json

{
  "path": "/guides/getting-started/",
  "vote": "up"
}
```

| Campo | Tipo | Obrigatório | Descrição |
| --- | --- | :-: | --- |
| `path` | string | ✓ | Caminho da página avaliada. |
| `vote` | `up` \| `down` | ✓ | O voto. |

Resposta `200` com corpo vazio.

## O que ele não aceita

Não há campo de comentário livre, e a ausência é uma decisão e não uma pendência.

Um campo de texto aberto num endpoint público sem autenticação é um canal por onde chegam credenciais coladas por engano, dados pessoais e conteúdo abusivo — tudo isso passando a viver no disco do portal. O voto binário responde "esta página ajudou?" sem abrir esse canal.

Quando o sinal binário não basta, quem opera o portal tem a [observabilidade de leitura](/guides/observabilidade-de-leitura/): busca sem resultado, abandono e jornada dizem *onde* o leitor travou, também sem guardar texto que ele escreveu.

## O que fica gravado

Caminho, voto e o instante, arredondado para o minuto. Nada mais.

Sem identificador de pessoa, sem IP, sem cookie, sem user-agent. O evento não tem onde guardar essas coisas — a proteção está na forma do dado, não numa política que alguém precisa lembrar de aplicar.

## Códigos

| Código | Quando |
| --- | --- |
| `200` | Registrado. |
| `400` | Corpo sem `path`, sem `vote`, ou com voto fora de `up`/`down`. |
| `429` | Votos demais a partir da mesma origem em pouco tempo. |

## Onde o voto aparece

- **Settings → Feedback** — páginas com mais votos negativos que positivos.
- **Saúde da documentação** — o voto entra na dimensão de confiabilidade.
- **[Gap Mining](/guides/lacunas-de-documentacao/)** — voto negativo repetido é um dos sinais que sugerem lacuna.
- **[Self-healing](/guides/self-healing/)** — como sinal, e **não** como gatilho de redação: uma página com votos negativos diz que o conteúdo existe e não serviu, e um agente reescrevendo por cima sem saber por quê costuma piorá-la.
