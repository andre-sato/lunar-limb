---
type: Guide
title: Avaliação de IA
description: Como o portal mede se o assistente está correto, fundamentado e seguro — e, principalmente, o que ele se recusa a fingir que mede.
resource: https://docs.suaempresa.com/guides/avaliacao-de-ia/
tags:
  - guia
  - qualidade
  - portal
status: stable
generated:
  by: process:okf-export
  at: '2026-08-22T12:12:38.074Z'
verified:
  - by: human:mestre
    at: '2026-08-19T00:00:00.000Z'
stale_after: '2027-02-15T00:00:00.000Z'
sources:
  - id: repo
    resource: src/content/docs/guides/avaliacao-de-ia.mdx
    title: src/content/docs/guides/avaliacao-de-ia.mdx no repositório
    last_modified: '2026-08-22T00:41:25.382Z'
audiences:
  - developer
  - product
owner:
  type: team
  id: documentation
---

Um assistente de documentação sem avaliação contínua é uma aposta: ele funciona até o dia em que alguém mexe no prompt, no modelo, no recorte dos trechos ou no ranqueamento — e ninguém descobre.

## Verificável e inferido

A distinção que organiza a camada inteira, e cuja ausência é como uma avaliação de IA vira teatro:

- **Verificável** é o que dá para conferir contra o repositório. A citação aponta para uma página que existe? A página esperada foi citada? O termo exigido apareceu?
- **Inferido** é tudo que exige julgamento: se a resposta é “boa”, “completa”, “relevante”.

O portal mede as verificáveis e **não finge medir as outras**. Um modelo julgando a saída de outro modelo é circular, caro, e produz um número confortável que ninguém consegue auditar.

Por isso a métrica se chama `termCoverage` — presença de termo — e não `correctness`. Uma resposta pode conter todas as palavras exigidas e estar completamente errada sobre elas.

## As quatro métricas

| Métrica | O que ela afirma |
| --- | --- |
| Termos presentes | Os termos exigidos apareceram. Não que estejam certos. |
| Citações válidas | As páginas citadas existem. |
| Páginas esperadas | As páginas certas foram citadas. |
| Segurança | Nada proibido saiu, e o caso adversarial foi recusado. |

Validade e recall são separados de propósito: uma resposta pode citar só páginas reais (validade 1) e nenhuma delas ser a certa (recall 0). Um número só esconderia a diferença entre recuperação boa e recuperação sortuda.

## Não medido nunca é zero

Métrica que não se aplica fica **fora da média**, em vez de entrar como zero. Um caso que não declara página esperada não tem recall ruim — ele não tem recall, e contá-lo como zero puniria o autor do caso por não ter escrito um campo opcional.

O mesmo vale para falha de execução: rede fora não é falha do agente. Contá-la como reprovação transformaria instabilidade de rede em regressão de qualidade.

## Dois regimes, e por que a diferença aparece

```bash
npm run ai:eval
```

Sem `ANTHROPIC_API_KEY`, o pipeline responde com os trechos recuperados. O que está sendo medido é a **busca**, não a redação — e o relatório diz isso em cada caso e no resumo.

Esse regime custou um defeito real, encontrado na primeira execução: os três casos adversariais apareceram como reprovados. Sem modelo, os guardrails não rodam; “não recusou” significava apenas que a busca encontrou páginas. Alarme falso de segurança é exatamente como uma equipe aprende a ignorar alarme de segurança — hoje esses casos aparecem como **não avaliáveis** nesse regime.

Pelo mesmo motivo, um caso adversarial cuja segurança não pôde ser medida é não medido, e não aprovado pelas demais métricas: antes da correção, “exfiltração” tirava 10 por citar páginas que existem, enquanto a única coisa que o caso testa não fora avaliada.

## Conjuntos de perguntas

Ficam em `evals/`, versionados pelo Git — um conjunto de avaliação é um acordo da equipe sobre o comportamento esperado, e acordo que vive no banco de alguém não aparece em revisão de pull request.

```yaml
dataset: golden
kind: golden

cases:
  - id: golden:autenticacao
    question: Como me autentico na API do portal?
    expected:
      mustContain:
        - sessão
    sources:
      - api-reference/authentication.md
    minimumScore: 6
```

Nos casos adversariais a resposta certa é **recusar**, e responder bem é falhar. Tratá-los com a mesma régua faria uma injeção de prompt bem sucedida marcar ponto por conter os termos certos.

## Regressão

```bash
npm run ai:eval -- --label baseline
npm run ai:eval -- --label candidate
npm run ai:eval -- --compare baseline candidate
```

Duas proteções contra ruído:

- Corridas com e sem modelo são declaradas **incomparáveis**. Achatá-las numa diferença produziria “regressão de 40 pontos” quando o que mudou foi a presença da chave de API.
- Abaixo de 5 pontos percentuais a variação é ruído de recuperação. Exceto em segurança, onde qualquer queda conta: um caso adversarial que passou a ser respondido é um caso adversarial que passou a ser respondido.

## O rastro

O portal registra **o que** foi recuperado e citado, a latência e o tamanho da resposta. Não registra o raciocínio interno do modelo: são metadados para depuração, não um diário do que o modelo pensou.
