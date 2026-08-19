# Glossário

> Extraído do README quando cada feature ganhou o seu guia. O guia explica **como
> usar**; este documento explica **como funciona** e por que foi construído assim.

Os termos ficam em `src/content/glossary/`, um arquivo Markdown por termo,
versionados pelo Git. Um termo cadastrado é destacado automaticamente nas
páginas, explicado numa bolha, listado em [`/glossary`](../src/pages/glossary/) e
**usado pelo linter** para avaliar consistência de terminologia.

O guia de uso é [Mantenha o glossário](../src/content/docs/guides/glossario.mdx). O
que segue é a arquitetura.

### O glossário é a fonte, o linter é consumidor

```text
        GlossDefs (src/content/glossary/*.md)
                     │
              Glossary Index
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
   Transformer                  Linter
   (destaque)              (Consistência)
```

Não existe uma nota "glossário" no linter: terminologia inconsistente **é**
consistência, e separá-la em duas notas esconderia o problema.

| Arquivo | Papel |
| --- | --- |
| `src/lib/glossary/types.ts` | O modelo, compartilhado pelos dois consumidores |
| `src/lib/glossary/index-build.ts` | Índice e busca de ocorrências |
| `src/lib/glossary/loader.ts` | Leitura do disco, com cache |
| `src/lib/glossary/remark-glossary.ts` | Transformer sobre o AST |
| `src/lib/linter/rules/glossary.ts` | Regras `CONSISTENCY-002` a `005` |

### Três decisões que valem registro

**O destaque acontece no AST, não no HTML.** Uma expressão regular sobre o HTML
final não distingue `OAuth` dentro de um `<code>`, de um `<a>` ou de um `<h2>` —
e ignorar esses três é requisito. No AST cada nó já diz o que é.

**Uma varredura, não uma por termo.** O índice ordena as formas da mais longa
para a mais curta, e cada posição do texto é testada uma vez. A ordem *é* a
regra de desempate: `API Gateway` vem antes de `API`, então a busca encontra a
maior primeiro. Com 100 termos isso é imperceptível.

**A bolha recebe texto puro.** A definição vai para um atributo e é escrita com
`textContent` — uma definição não consegue executar script na página nem que
tente. A formatação completa fica na página do termo, onde o pipeline do Astro
a renderiza com a sanitização de sempre.

### A numeração das regras

A spec numera de 001 a 005, mas `CONSISTENCY-001` já existia no portal (grafia
inconsistente na página), que é o conceito da `CONSISTENCY-003` da spec.
Renumerar quebraria configurações e histórico, então as regras novas ocupam
002–005. O mapa está no cabeçalho de `src/lib/linter/rules/glossary.ts`.
