---
type: Guide
title: Saúde da documentação
description: O Health Center — dimensões, SLOs, lacunas priorizadas e alertas. Como cada número é apurado e por que "não medido" não é zero.
resource: https://docs.suaempresa.com/guides/saude-da-documentacao/
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
    resource: src/content/docs/guides/saude-da-documentacao.mdx
    title: src/content/docs/guides/saude-da-documentacao.mdx no repositório
    last_modified: '2026-08-22T00:41:25.391Z'
owner:
  type: team
  id: documentation
---

As camadas anteriores medem cada uma o seu pedaço. O linter mede escrita, a suíte
de testes mede comportamento, o Impact Engine mede consequência, o Trust mede
evidência. Nenhuma delas responde à pergunta que uma equipe faz na segunda-feira:

**"a documentação está saudável, e o que fazemos primeiro?"**

O Health Center fica em **Settings → Health**. Ele **não mede nada de novo** —
junta o que já é medido, compara com um alvo declarado e transforma a diferença em
fila de trabalho. Indicador que não vira tarefa é enfeite de painel.

## As sete dimensões

| Dimensão | De onde vem |
| --- | --- |
| Qualidade | nota média do linter |
| Frescor | páginas com proveniência dentro do prazo de verificação |
| Consistência | dimensão de consistência do linter, que inclui o glossário |
| Cobertura de testes | páginas com ao menos um teste que rodou |
| Cobertura de API | endpoints documentados sobre endpoints declarados |
| Confiança | Trust Score médio |
| Acessibilidade | páginas sem apontamento de `IMAGE-001`, `IMAGE-002`, `LINK-001` ou `STRUCTURE-001` |

Cada uma mostra **de onde o número veio** — "9 de 10 endpoints documentados", não
apenas "90%". Um painel cujo indicador ninguém consegue conferir vira assunto de
discussão em vez de insumo de decisão.

### Não medido não é zero

É a regra que mais decide como o painel se comporta. Uma dimensão sem dado aparece
como **não medida**, com o motivo, e fica fora da média geral.

Um portal onde ninguém declarou proveniência ainda não é um portal com confiança
zero — é um portal que não foi medido nessa dimensão. Tratar as duas coisas como a
mesma faria o número geral despencar por falta de anotação, e um painel que faz
isso a equipe aprende a ignorar na primeira semana.

Pela mesma razão, dimensão não medida entra no SLO como **em risco**, nunca como
violação: não se viola um alvo que não foi aferido.

### Frescor mede o que foi anotado

A base do frescor é o conteúdo **com proveniência declarada**, não o portal
inteiro. Uma página que ninguém anotou não está vencida — está sem informação. Se
ela entrasse na conta, o frescor cairia conforme o portal cresce, mesmo com todo o
conteúdo anotado em dia.

## SLOs

Configurados em `health.yml`, versionado no Git — um alvo de qualidade é um acordo
da equipe, e acordo que só existe na tela de configuração de alguém não sobrevive à
troca de time.

```yaml
documentation:
  slo:
    quality:
      target: 90
      warning: 5
    apiCoverage:
      target: 100
      warning: 10
    brokenLinks: 0
```

`warning` é a faixa entre "no alvo" e "violado": quantos pontos abaixo do alvo
ainda contam como 🟡 **em risco** em vez de 🔴 **violado**. Sem ela, o painel
alterna entre verde e vermelho a cada ponto, e a equipe aprende a ignorar o
vermelho.

Cobertura de API em 100% e links quebrados em 0 nascem como absolutos: endpoint
publicado sem página e link morto não têm justificativa que valha a discussão.

## O que fazer primeiro

A fila cruza os sinais que o portal já coleta e prioriza em P0, P1 e P2:

- **P0** — evidência inválida. É o único sinal que indica documentação
  possivelmente **errada**: a fonte citada não confere mais.
- **P1** — endpoint declarado e não documentado (o contrato existe, alguém vai
  chamar), teste de documentação reprovado, pergunta muito repetida sem resposta.
- **P2** — verificação vencida, nota abaixo do mínimo, poucos votos negativos.

Nota baixa entra por último de propósito: uma página malescrita e correta ainda
ajuda quem a lê.

Cada item carrega **por que** recebeu aquela prioridade. Uma fila que a equipe não
consegue conferir é uma fila que ela reordena por conta própria — e aí o cálculo
não serviu para nada.

## Perguntas sem resposta, e uma decisão de privacidade

A spec pede a lista das "perguntas mais frequentes sem resposta". Isso exige
guardar o **texto** do que os leitores perguntam, e o portal já tinha decidido o
contrário: o arquivo de qualidade do chatbot guarda apenas contadores e votos,
porque um histórico de perguntas seria o dado mais sensível daqui — é onde as
pessoas escrevem o que não sabem, às vezes junto com o que estão construindo.

A saída adotada tem duas metades:

**Contadores sempre.** Quantas consultas, quantas com confiança alta, quantas sem
resposta, quantas recusadas por guardrail. Nada disso identifica ninguém nem
registra o que foi perguntado.

**Texto só com autorização explícita.** Em `health.yml`:

```yaml
documentation:
  analytics:
    storeUnansweredQuestions: false
```

Ligado, guarda apenas a pergunta que **ficou sem resposta** — sem quem perguntou,
truncada, com credenciais redigidas e com teto de registros. O painel traz um
botão para apagar o texto guardado mantendo os contadores.

Desligado, as lacunas continuam sendo detectadas pelos outros sinais. O que se
perde é a lista de perguntas, e essa perda é decisão de quem opera o portal.

## Alertas

Três canais: o painel, um webhook (`DOCS_HEALTH_WEBHOOK`, obrigatoriamente
`https`) e uma issue no provedor, que reaproveita o `GITHUB_TOKEN` já usado pelo
fluxo de pull request.

**Nada sai sozinho.** O disparo é uma ação explícita de quem administra, e fica na
auditoria. Um alerta automático a cada análise vira notificação repetida no canal
da equipe — e a primeira coisa que se faz com notificação repetida é silenciá-la,
o que mata justamente o alerta que importava.

O alerta diz o que quebrou, quanto, e o que fazer primeiro. Sem SLO violado, não
há alerta: ninguém pediu um relatório dizendo que está tudo bem.
