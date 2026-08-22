---
type: Guide
title: Conteúdo reutilizável
description: Como escrever um trecho uma vez e reaproveitá-lo em várias páginas sem duplicar texto.
resource: https://docs.suaempresa.com/guides/conteudo-reutilizavel/
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
    resource: src/content/docs/guides/conteudo-reutilizavel.mdx
    title: src/content/docs/guides/conteudo-reutilizavel.mdx no repositório
    last_modified: '2026-08-22T00:41:25.384Z'
owner:
  type: team
  id: documentation
---

Um aviso que precisa aparecer em cinco páginas não deve existir em cinco arquivos. Nesta
documentação ele existe em um só, e as páginas o referenciam.

## Onde o conteúdo canônico mora

```text
src/content/
├── docs/       # páginas publicadas
└── snippets/   # blocos reutilizáveis (não viram páginas)
```

Cada arquivo em `snippets/` tem um **id estável**: o caminho sem a extensão.
`snippets/rate-limit.md` tem o id `rate-limit`. Mudar o título do bloco não quebra
nenhuma referência — só renomear o arquivo faria isso.

## Referenciando um bloco

Em uma página `.mdx`:

```mdx

```

O resultado renderizado é o conteúdo do bloco, no lugar da tag:

Para incluir uma **página inteira** dentro de outra, o componente é `IncludePage`,
com a mesma ideia:

```mdx

```

**Só funciona em `.mdx`**
`<ContentBlock>` e `<IncludePage>` são JSX. Arquivos `.md` puros não têm esse conceito —
crie a página como `.mdx` para poder reutilizar conteúdo.

## Blocos podem compor outros blocos

Um bloco também pode referenciar outros. `api-essentials` não tem texto próprio: ele só
reúne dois avisos. Editar `rate-limit` atualiza `api-essentials` e, por tabela, todas as
páginas que usam `api-essentials`.

O editor chama isso de **impacto indireto** e mostra os dois números antes de você editar.

## O que o editor faz por você

Em `/editor` a sintaxe acima é opcional — existe uma forma visual para tudo:

| Ação | Onde |
| --- | --- |
| Inserir uma referência | Botão **Inserir conteúdo reutilizável** (o `import` é adicionado sozinho) |
| Transformar uma seleção em bloco | Botão **Extrair** |
| Ver quem usa esta página | Painel **Referências**, seção _Usado por_ |
| Ver o que esta página usa | Painel **Referências**, seção _Esta página usa_ |
| Ver o grafo inteiro | **Content Graph** (`Ctrl/Cmd + Shift + G`) |

O editor também recusa inserções que criariam uma referência circular e avisa antes de
apagar um bloco que outras páginas consomem.

## A regra que não muda

O conteúdo nunca é copiado. O arquivo da página guarda a referência, não o texto —
o texto continua existindo em um lugar só. Escreva uma vez, reutilize em todo lugar;
edite uma vez, atualize em todo lugar.
