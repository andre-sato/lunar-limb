# Arquitetura — Content Graph (Fase 4)

Documento de engenharia do grafo bidirecional de conteúdo do editor. Para a
documentação voltada a quem *escreve* (sintaxe, botões, fluxo), veja a página
publicada [Conteúdo reutilizável](../src/content/docs/guides/conteudo-reutilizavel.mdx).

## Princípio

O grafo é **derivado**, nunca fonte de verdade. Os arquivos `.md`/`.mdx` em
`src/content/` continuam sendo o único lugar onde o conteúdo existe; o índice é
reconstruído a partir deles sob demanda e pode ser jogado fora a qualquer momento
sem perda. Nada é persistido em banco.

```text
src/content/{docs,snippets}/**.{md,mdx}     ← fonte de verdade (Git)
              │
              ▼
      content-graph.ts (leitura + montagem)
              │
              ▼
      graph-model.ts (algoritmos puros)
              │
     ┌────────┴────────┐
     ▼                 ▼
 /api/editor/*     UI do editor
```

## Modelo

Um **nó** é um arquivo; uma **aresta** é uma tag `<ContentBlock>`/`<IncludePage>`
encontrada dentro de um arquivo.

```ts
interface ContentNode {
  key: string;   // "docs:guides/payments.mdx" — identidade de arquivo
  id: string;    // "guides/payments"          — identidade de conteúdo (estável)
  type: 'page' | 'block';
  root: 'docs' | 'snippets';
  path: string;
  title?: string;
}

interface ContentEdge {
  source: string;      // key do nó de origem
  sourceId: string;
  target: string;      // id referenciado
  type: 'uses';
  refType: 'page' | 'block';
  resolved: boolean;   // existe um nó para refType:target?
  location: { line: number; column: number; offset: number };
}
```

### Por que `ref` e não `id`

`docs/auth.md` e `snippets/auth.md` têm o mesmo `id` (`auth`). O que desambigua é
**como** o conteúdo foi referenciado: `<ContentBlock>` sempre resolve em
`snippets/`, `<IncludePage>` sempre em `docs/`. Por isso o grafo é indexado por
`ref` — `block:auth` / `page:auth` — e não por `id` puro. Toda a API de consulta
(`getBacklinks`, `analyzeImpact`, `wouldCreateCycle`) fala em refs.

### Estabilidade do id

O `id` é o caminho sem extensão. Consequências, que são exatamente as regras
§18/§52 da especificação:

- renomear o **título** não quebra nada;
- renomear/mover o **arquivo** quebra as referências (o id muda junto);
- `x.md` e `x.mdx` lado a lado colidem — reportado como `duplicate-id`, e o
  primeiro (`.md`) vence, seguindo a mesma ordem de tentativa do resolver do
  preview.

## Onde cada coisa mora

| Arquivo | Responsabilidade |
| --- | --- |
| `src/lib/editor/graph-model.ts` | Tipos + algoritmos **puros** (sem `node:fs`). Extração de referências, backlinks, impacto, ciclos, problemas. |
| `src/lib/editor/content-graph.ts` | Lê o filesystem, monta o grafo, cache curto, consultas usadas pelas rotas. |
| `src/pages/api/editor/graph.ts` | `GET` do grafo + problemas; e checagem de ciclo pontual. |
| `src/pages/api/editor/references.ts` | Os dois lados do grafo para **um** arquivo. |
| `src/components/editor/ContentGraphModal.tsx` | Visão global (nós, arestas, problemas). |
| `src/components/editor/ReferencePanel.tsx` | Navegação bidirecional do arquivo aberto. |
| `src/components/editor/ProblemsPanel.tsx` | Problemas do arquivo aberto, com linha. |

`graph-model.ts` é puro **de propósito**: o mesmo código roda no servidor (ao
montar o grafo) e no browser (o modal de inserção calcula ciclos localmente, sem
uma ida extra à rede). Uma implementação, dois lugares.

## Extração de referências

Regex, não parse MDX completo:

```ts
/<(ContentBlock|IncludePage)\s+id=["']([^"']+)["']\s*\/?>/g
```

O motivo é que o grafo precisa rodar sobre arquivos **possivelmente inválidos** —
o autor está no meio de uma edição — sem explodir, e essa é a única forma que o
editor gera. Em compensação, a extração precisa emular o que o parser faria:

- o **frontmatter** é pulado (uma tag num campo YAML não é conteúdo);
- **blocos de código cercados** (``` / ~~~) e **código inline** são pulados —
  sem isso, uma página que documenta a própria sintaxe entraria no grafo como
  consumidora dos blocos que ela só está mostrando, e o grafo discordaria do
  preview (que resolve pela árvore mdast e naturalmente ignora nós `code`);
- linhas e colunas são contadas sobre o arquivo **inteiro**, incluindo o
  frontmatter, porque é assim que o Monaco numera.

Blocos indentados com 4 espaços não são tratados: dentro de listas eles são
conteúdo normal, e o falso negativo seria pior que o falso positivo.

## Cache

`content-graph.ts` mantém o grafo em memória por **1,5 s**. O editor pede
referências a cada save e a cada troca de arquivo; sem cache isso releria e
reparsearia o repositório inteiro toda vez. O TTL é curto de propósito: os
arquivos podem ser editados por fora (Git, VS Code, Codex), e um índice velho é
pior que um índice barato. Toda escrita por `/api/editor/file` chama
`invalidateGraphCache()`.

## Impacto (§23)

`analyzeImpact(graph, ref)` faz BFS sobre as arestas **invertidas** e separa:

- **diretos** — quem tem uma aresta apontando para o conteúdo;
- **indiretos** — quem chega nele por composição (A usa B, B usa o conteúdo).

É o que alimenta o aviso "conteúdo reutilizável — afeta N páginas" no painel de
referências e o modal de exclusão.

## Ciclos (§34)

`findCycles` é um DFS com marcação de estado (`visiting`/`done`). Cada ciclo é
normalizado (rotacionado para começar no menor ref) antes de ser registrado, para
não reportar o mesmo ciclo uma vez por ponto de entrada.

`wouldCreateCycle(graph, sourceRef, targetRef)` responde à pergunta diferente e
mais útil: *inserir isto aqui fecharia um laço?* Ela é chamada pelo modal de
inserção, que desabilita a opção antes de o autor cometer o erro — a Fase 3 só
descobria o problema quando o preview quebrava.

## Preview × build

Existem **duas** implementações do resolver, e isso é intencional:

| | Quem resolve | Pipeline |
| --- | --- | --- |
| Preview do editor | `src/lib/editor/remark-resolve-reusable.ts` | unified/remark |
| Site publicado | `src/components/content/{ContentBlock,IncludePage}.astro` | `getEntry`/`render` do `astro:content` |

Ambas resolvem `id` → o mesmo arquivo canônico. Se as duas divergirem, é bug.
O grafo é uma terceira leitura dos mesmos arquivos, e é por isso que a extração
precisa concordar com o que o remark enxerga (daí o cuidado com código e
frontmatter acima).

## Testes

```bash
npm test
```

- `tests/graph-model.test.ts` — algoritmos puros, incluindo o caso da §53 da
  especificação (`A → B`, `C → B`, `D → C` ⇒ backlinks de B = [A, C], de C = [D],
  de A = []).
- `tests/content-graph.test.ts` — integração: monta um repositório de conteúdo de
  verdade em diretório temporário e verifica o grafo saindo do disco, inclusive
  a garantia de que o conteúdo reutilizado **não é copiado** para o arquivo
  consumidor.

## Limites conhecidos

- Referências escritas com uma sintaxe diferente da que o editor gera (props em
  outra ordem, `id` vindo de uma expressão) não entram no grafo.
- Mover ou renomear um arquivo quebra as referências a ele; ainda não há um
  "rename refactor" que atualize os consumidores.
- Não há bloqueio de build em modo strict para referências quebradas — elas
  aparecem no Problems panel e no modal do grafo, mas o `astro build` só falha se
  o próprio `<ContentBlock>` não encontrar a entrada.
