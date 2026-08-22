---
type: Guide
title: Documentação legível por máquina
description: '`llms.txt`, Markdown bruto por página, metadados estruturados e o menu Compartilhar com IA.'
resource: https://docs.suaempresa.com/guides/documentacao-legivel-por-maquina/
tags:
  - guia
  - ia
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
    resource: src/content/docs/guides/documentacao-legivel-por-maquina.mdx
    title: src/content/docs/guides/documentacao-legivel-por-maquina.mdx no repositório
    last_modified: '2026-08-22T00:41:25.387Z'
audiences:
  - developer
  - product
owner:
  type: team
  id: documentation
---

O portal publica três coisas para agentes, IDEs e sistemas RAG, todas derivadas
do conteúdo — nenhuma escrita à mão:

| Saída | O quê |
| --- | --- |
| `/llms.txt` | Índice: seções, páginas, glossário, operações da API e blocos reutilizáveis com quantas páginas os usam |
| `/llms-full.txt` | O conteúdo inteiro. `LLMS_FULL=false` desliga |
| `/md/<caminho>.md` | Markdown limpo de cada página |

O Markdown limpo tira o maquinário do MDX — imports, tags de componente,
sintaxe de aside — e **preserva o texto que estava dentro** desses componentes:
descartá-lo entregaria uma versão incompleta da página.

O prefixo é `/md/` e não `.md` no caminho original porque a Starlight já é dona
das rotas de documentação, e duas URLs para a mesma página confundem buscador.

### MCP

O servidor em `mcp-docs/` expõe 12 tools. Além das quatro de documentação que já
existiam, entraram:

| Tool | Fonte |
| --- | --- |
| `get_page`, `get_section` | páginas do portal |
| `get_glossary_term`, `search_glossary` | `src/content/glossary/` |
| `search_api`, `get_api_endpoint` | `src/schemas/*.yaml` |
| `get_changelog` | `src/content/docs/changelog/` |
| `check_documentation` | o linter do portal |

Cada uma **lê** a fonte que já tem dono; nenhuma guarda cópia. Todo texto passa
pelo mesmo tratamento das tools de documentação: uma página com "ignore as
instruções anteriores" volta como texto marcado, não como comando.

`check_documentation` é a única que inicia um processo — ela chama a CLI do
linter, porque reimplementá-lo em Python criaria duas verdades sobre o que é uma
boa página. Comando fixo, argumentos em lista, sem shell, caminho validado antes.

**O que ainda não existe:** o MCP não aplica o RBAC do portal (§11 da spec) nem
registra identidade de cliente na auditoria (§13). Em modo stdio o servidor roda
como o processo de quem o iniciou e não tem noção de usuário; ligar isso exige o
modo remoto com token mapeado para um usuário do portal. Até lá, o servidor
enxerga tudo o que o sistema de arquivos enxerga.
