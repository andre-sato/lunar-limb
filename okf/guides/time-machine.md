---
type: Guide
title: Time Machine
description: Como a documentação evoluiu, como ela estava numa data, o que mudou de comportamento entre dois pontos — e como voltar atrás com segurança.
resource: https://docs.suaempresa.com/guides/time-machine/
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
    resource: src/content/docs/guides/time-machine.mdx
    title: src/content/docs/guides/time-machine.mdx no repositório
    last_modified: '2026-08-22T00:41:25.397Z'
audiences:
  - developer
  - product
owner:
  type: team
  id: documentation
---

Quatro perguntas que só o histórico responde:

- Como esta página evoluiu?
- Como o portal estava em maio?
- O que mudou de **comportamento** entre dois pontos?
- Aquele commit afetou o quê?

```bash
npm run history -- api-reference/authentication.md
npm run history -- payments.md --at 2026-05-15
npm run history -- payments.md --compare 2026-05-15 2026-08-18
npm run history -- impact <commit>
npm run history -- restore payments.md --at 2026-05-15
```

## O Git continua sendo a fonte

Esta camada é **indexação sobre o Git**, não uma cópia paralela do que a
documentação era. Cada consulta reconstrói do repositório.

É mais lento e sempre certo. Um índice histórico persistido divergiria no primeiro
`rebase`, e a partir dali existiriam duas respostas para "como esta página estava
em maio" — uma delas errada, e nenhuma marcada como tal.

Nada aqui escreve, faz checkout ou muda de branch. A leitura é por `git show`, que
lê o objeto sem tocar na árvore de trabalho.

## O que não dá para reconstruir

Contagem de páginas, palavras, termos de glossário e endpoints saem do conteúdo
daquele commit — são exatos.

O **Health Score não é recalculado**. Ele dependia de testes, contratos e
proveniência avaliados com as ferramentas daquela época, e refazer a conta hoje
mediria o passado com a régua do presente. Ele vem do histórico de medições quando
houve uma **naquele dia**, e vem ausente quando não houve.

A primeira versão aceitava uma medição de até sete dias de distância, e o
resultado foi uma comparação entre 12 e 18 de agosto exibindo o mesmo número nas
duas pontas — a medição de hoje apresentada como se descrevesse o passado, com
delta zero convidando à conclusão de que nada mudou. Ausente é mais honesto que
aproximado.

## Semantic diff

O diff textual responde "que linhas mudaram". Este responde:

**"o que passou a ser verdade que antes não era?"**

```text
expiração da chave (dias):  30 dias → 90 dias
campos obrigatórios:        client_id → client_id + client_secret
```

Ele lê o que tem forma reconhecível: números com unidade, campos obrigatórios,
endpoints, autenticação e códigos de status. Cada achado carrega uma
**confiança** — uma lista `required:` é estrutura declarada e vale 0,95; o assunto
de um número inferido das palavras vizinhas vale 0,7.

**O limite, dito de frente**: uma reescrita que inverte o sentido de uma frase em
prosa passa despercebida. É por isso que o diff textual continua ao lado, em vez
de ser substituído.

## Restore

O fluxo é o que a spec desenha, sem atalho:

```text
Snapshot → Workspace → Diff → Validação → PR
```

Restaurar **não** altera a branch principal. Ele escreve no workspace isolado dos
agentes — o mesmo que recusa qualquer caminho fora de `src/content/` — e devolve
um diff para leitura humana.

Restaurar é uma operação perigosa disfarçada de simples: o conteúdo antigo pode
estar antigo por um bom motivo, e uma reversão com um clique apagaria a razão
junto. Por isso o resultado é um diff, e não uma reversão.

## Correlação

A timeline traz autor, commit, contagem de linhas, tags de release e o número do
pull request quando o assunto do commit o menciona. `--follow` mantém o histórico
através de renomeações: uma página que mudou de nome não começou a existir naquele
dia.

`npm run history -- impact <commit>` mostra o que aquele commit tocou —
documentação, especificação e código — mais as páginas que mudaram **por tabela**,
que vêm do Impact Engine em vez de um segundo cálculo aqui.
