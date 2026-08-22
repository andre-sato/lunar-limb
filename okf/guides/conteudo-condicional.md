---
type: Guide
title: Conteúdo condicional
description: Como esconder trechos ou páginas inteiras usando variáveis, sem manter versões paralelas da documentação.
resource: https://docs.suaempresa.com/guides/conteudo-condicional/
tags:
  - guia
  - editor
  - conteudo
status: stable
generated:
  by: process:okf-export
  at: '2026-08-22T12:12:38.074Z'
sources:
  - id: repo
    resource: src/content/docs/guides/conteudo-condicional.mdx
    title: src/content/docs/guides/conteudo-condicional.mdx no repositório
    last_modified: '2026-08-22T00:41:25.384Z'
owner:
  type: team
  id: documentation
---

Documentar dois planos, ou um recurso que ainda está em beta, normalmente vira
duas versões do mesmo texto que saem de sincronia. Aqui a página é uma só e o
que muda é qual trecho aparece.

## Onde as variáveis moram

Em `src/config/content-variables.json`:

```json
{
  "beta": { "value": false, "description": "Recursos ainda em beta" },
  "plano": { "value": "starter", "description": "Plano exibido nos exemplos" }
}
```

Uma variável é um booleano ou uma string. O editor tem uma tela para isso
(`Ctrl/Cmd + Shift + V`), mas o arquivo continua sendo JSON comum, versionado
em Git e editável à mão.

## Escondendo um trecho

```mdx

Este parágrafo só aparece com a flag `beta` ligada.

```

Com `beta` desligada, o resultado é este — nada:

Se você está lendo isto, a variável `beta` foi ligada.

E a forma negada, `not`, que aparece justamente porque `beta` está desligada:

Este aviso existe para quem ainda não está no programa beta.

Para variáveis de texto, compare com `equals`:

Você está vendo os limites do plano **starter**, porque a variável `plano` vale `starter`.

## Escondendo a página inteira

Duas formas, ambas no frontmatter:

```yaml
visible: false        # publicada, mas fora da navegação e da busca
showIf: beta          # só visível quando a variável `beta` estiver ligada
```

`showIf` também aceita a negação com `!`, como em `showIf: !interno`.

**O que "invisível" significa aqui**
A página continua sendo publicada e acessível por URL direta — ela apenas some
da barra lateral e do índice de busca. Não é um controle de acesso: não use
`visible: false` para proteger segredo.

## Uma diferença que importa

No **site publicado**, um trecho oculto não vai para o HTML: ele não está lá
escondido por CSS, simplesmente não foi gerado. Conteúdo marcado como interno
não fica recuperável no navegador do leitor.

No **preview do editor** é o contrário: o trecho oculto aparece como um marcador
cinza dizendo qual condição não foi satisfeita. Quem escreve precisa enxergar
que existe conteúdo condicional ali.

**Build time** resolve as variáveis — mudar uma variável exige um novo
build para o site publicado refletir a mudança.
