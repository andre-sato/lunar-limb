---
type: Guide
title: Linter e Quality Score
description: 'O revisor editorial automatizado: problemas com id estável, nota por dimensão, style guide versionado e portão de CI.'
resource: https://docs.suaempresa.com/guides/linter-e-quality-score/
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
    resource: src/content/docs/guides/linter-e-quality-score.mdx
    title: src/content/docs/guides/linter-e-quality-score.mdx no repositório
    last_modified: '2026-08-22T00:41:25.390Z'
audiences:
  - developer
  - product
owner:
  type: team
  id: documentation
---

O editor traz um revisor editorial automatizado: analisa cada página, aponta problemas com id estável (`STRUCTURE-001`, `TECH-MKT-001`, …) e calcula uma **nota de 0 a 10** com detalhamento por dimensão — gramática, clareza, concisão, estrutura, technical writing, consistência, acionabilidade, terminologia e legibilidade.

Os problemas aparecem no painel abaixo do editor e sublinhados no Monaco. Correção rápida existe só quando é mecânica; sugestões subjetivas não alteram o texto sozinhas.

A nota **não** é `10 − nº de erros`: cada dimensão é pontuada isoladamente, e o dano é normalizado por tamanho, para uma página longa não ser punida por ser longa. Calibração contra o conteúdo real: 8,9–10,0. Contra um documento escrito de propósito com TODO, linguagem promocional e link sem destino: 4,8.

O style guide fica em `styles/default.yaml`, versionado em Git — limiares, termos proibidos, terminologia canônica, acrônimos conhecidos, severidade e peso por regra. Profiles adicionais herdam com `extends`, e uma página escolhe o seu pelo frontmatter. Regras podem ser silenciadas por linha, por bloco ou por página, e todo silenciamento é registrado.

Na linha de comando e em CI:

```bash
npm run docs:lint
```

`--changed` analisa só o que mudou **mais as páginas consumidoras** dos blocos alterados, usando o Content Graph. Saída `0` aprovado, `1` gate reprovado, `2` configuração, `3` execução.

**Settings → Quality** traz a visão do workspace: nota média, média por dimensão e problemas mais frequentes. Regras e arquitetura em [docs/linter.md](https://github.com/andre-sato/lunar-limb/blob/master/docs/linter.md).
