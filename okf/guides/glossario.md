---
type: Guide
title: Mantenha o glossário
description: Como cadastrar um termo, como ele é destacado nas páginas e como o linter usa o glossário para avaliar consistência.
resource: https://docs.suaempresa.com/guides/glossario/
tags:
  - guia
  - conteudo
  - portal
status: stable
generated:
  by: process:okf-export
  at: '2026-08-22T12:12:38.074Z'
sources:
  - id: repo
    resource: src/content/docs/guides/glossario.mdx
    title: src/content/docs/guides/glossario.mdx no repositório
    last_modified: '2026-08-22T01:44:56.370Z'
owner:
  type: team
  id: documentation
---

O glossário é a **terminologia canônica do portal**. Um termo cadastrado uma vez
passa a ser destacado em todas as páginas, explicado numa bolha ao passar o
mouse, e usado pelo linter para avaliar se a documentação escreve as coisas de
forma consistente.

Não é só um conjunto de tooltips: é a fonte que responde "como nós escrevemos
isso aqui".

## Cadastre um termo

Crie um arquivo em `src/content/glossary/`:

```markdown
---
id: rag
term: RAG
aliases:
  - Retrieval-Augmented Generation
  - Retrieval Augmented Generation
caseSensitive: true
---
Técnica que combina recuperação de trechos de uma base de conhecimento com
geração de texto por um modelo de linguagem.
```

Pronto. O termo passa a ser reconhecido nas páginas no próximo build.

Os arquivos são versionados pelo Git como qualquer página, então uma mudança de
terminologia passa por revisão em pull request e tem histórico.

## Os campos

| Campo | Padrão | Para quê |
| --- | --- | --- |
| `id` | nome do arquivo | Identificador estável. Renomear o termo não quebra referências. |
| `term` | obrigatório | A forma canônica, mostrada ao leitor. |
| `aliases` | vazio | Outras escritas que apontam para o mesmo termo. |
| `deprecated` | vazio | Formas desaconselhadas. O linter as acusa e sugere o termo canônico. |
| `enabled` | `true` | `false` mantém o termo no glossário e o tira do destaque automático. |
| `caseSensitive` | `false` | `true` exige a grafia exata. Útil para siglas que também são palavras comuns. |
| `matchWholeWord` | `true` | `false` permite casar dentro de outra palavra. |

O corpo do arquivo é a definição, em Markdown.

## Onde o destaque **não** acontece

Por decisão, e não por limitação:

- bloco de código e código inline — ali o texto é literal;
- links — o leitor já tem uma ação naquele texto;
- títulos — competiriam com a hierarquia da página;
- HTML cru e frontmatter.

Uma página inteira pode ficar de fora:

```yaml
---
title: Página sem destaque
glossary: false
---
```

## Quando dois termos disputam a mesma palavra

Vence o mais longo. Com `API` e `API Gateway` cadastrados, o texto
"o API Gateway encaminha" destaca `API Gateway` inteiro — não `API` seguido de
uma palavra solta.

Se duas **definições diferentes** reivindicarem a mesma escrita, o build avisa:

```text
[glossário] Forma de glossário duplicada: "api"
Usada por:
  - Termo A (termo-a)
  - Termo B (termo-b)
```

Vale corrigir: sem o aviso, uma das duas deixaria de aparecer sem que ninguém percebesse.

## O linter usa o glossário

As regras de terminologia pertencem à categoria **Consistência** — o glossário
não tem nota própria. Terminologia inconsistente é um problema de consistência,
e separar isso em duas notas esconderia o problema em vez de mostrá-lo.

| Regra | O que acusa |
| --- | --- |
| `CONSISTENCY-002` | Alias e forma canônica convivendo na mesma página |
| `CONSISTENCY-003` | Forma marcada como desaconselhada |
| `CONSISTENCY-004` | Sigla repetida que não está no glossário |
| `CONSISTENCY-005` | Sigla e forma extensa alternando depois da apresentação |

Cada problema aponta o termo do glossário correspondente, e a sugestão de
correção é o termo canônico.

Um exemplo do que isso pega:

```text
CONSISTENCY-003  "whitelist" está marcado como desaconselhado; prefira "allowlist".
                 Glossário: allowlist
```

## O que não vira aviso

`CONSISTENCY-004` procura vocabulário **do produto**, não exige que alguém
defina `HTTP` ou `JSON`. Siglas universais estão numa lista de exceções, e uma
sigla precisa aparecer três vezes na mesma página para valer o aviso — uma
menção isolada não é vocabulário estabelecido.

## Navegue pelo glossário

[`/glossary`](/glossary) lista todos os termos por letra inicial, com busca. A
página de cada termo mostra a definição completa, as outras escritas aceitas e
**em quais páginas ele aparece** — essa lista é derivada do conteúdo a cada
build, não guardada no arquivo do termo. Guardá-la ali criaria duas verdades.

Um termo com zero ocorrências não está errado: pode ser novo, ou específico de
conteúdo que ainda não foi escrito.

## Um detalhe sobre a bolha

A bolha mostra a definição como **texto puro**, sem formatação. A formatação
completa fica na página do termo.

A escolha não é de economia. O texto vai para um atributo e é escrito com
`textContent`, o que fecha o caminho para uma definição executar script na
página de quem lê. Uma definição é conteúdo como qualquer outro, e conteúdo não
deveria poder fazer isso.
