---
type: Guide
title: Workflow de Git
description: Branches, diff, quality gate e preparação de pull request a partir do editor.
resource: https://docs.suaempresa.com/guides/workflow-de-git/
tags:
  - guia
  - editor
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
    resource: src/content/docs/guides/workflow-de-git.mdx
    title: src/content/docs/guides/workflow-de-git.mdx no repositório
    last_modified: '2026-08-22T00:41:25.398Z'
audiences:
  - developer
  - product
owner:
  type: team
  id: documentation
---

O editor deixou de apenas *mostrar* o estado do Git e passou a operá-lo: criar
branch, ver o diff, rodar o portão de qualidade e preparar o pull request, sem
sair da tela onde o texto foi escrito.

| Camada | Onde | O quê |
| --- | --- | --- |
| Branches | `src/lib/git/workflow.ts` | listar, criar, trocar, renomear, apagar |
| Diff | `src/lib/git/diff.ts` | leitura do diff unificado, com renomeação e binário |
| Pull request | `src/lib/git/pull-request.ts` | portão de qualidade, impacto no conteúdo, criação |
| Interface | `src/components/editor/GitWorkflowModal.tsx` | o painel no editor |

### Três decisões

**Nada passa por shell.** Todo comando usa `execFile` com lista de argumentos.
Um nome de branch vindo da interface é dado, não instrução — sem shell,
`; rm -rf` é apenas um nome inválido. A validação de nome existe para dar erro
claro, e segue as regras do Git sem inventar restrições próprias.

**O diff inclui o que ainda não foi commitado.** Quem escreve no editor tem
alterações salvas em arquivo e não commitadas; um diff que as escondesse
mostraria uma revisão diferente da que existe no disco.

**A revisão e o merge acontecem no provedor.** O portão de qualidade é nosso e
roda local; o pull request vive no GitHub, que é onde a equipe já revisa código.
Reimplementar revisão aqui seria um GitHub pior e desconectado.

### O que o PR informa antes de alguém abrir os arquivos

Nota do linter (a **menor** das páginas alteradas, não a média — uma página ruim
entre dez boas continua ruim), lista dos arquivos por tipo, e o **impacto no
Content Graph**: as páginas que mudam porque um bloco reutilizável mudou e que,
por isso, **não aparecem no diff**.

### Credencial

`GITHUB_TOKEN` no ambiente permite criar o PR direto. Sem ele, o botão abre a
tela de comparação do provedor com título, descrição e resumo já preenchidos —
o trabalho de preparação não se perde por falta de token.
