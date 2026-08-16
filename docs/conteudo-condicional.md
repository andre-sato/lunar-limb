# Arquitetura — condicionais e visibilidade (Fase 5)

Documento de engenharia. Para a documentação voltada a quem escreve, veja a
página publicada [Conteúdo condicional](../src/content/docs/guides/conteudo-condicional.mdx).

## O modelo

Uma **variável de conteúdo** é um booleano ou uma string em
`src/config/content-variables.json`. Ela controla duas coisas:

| Escopo | Como | Efeito |
| --- | --- | --- |
| Trecho | `<If flag="beta">…</If>` em `.mdx` | O trecho entra ou não no HTML |
| Página | `showIf: beta` no frontmatter | A página some da navegação e da busca |

E, independente de variáveis, `visible: false` no frontmatter esconde a página
diretamente.

## Onde cada coisa mora

| Arquivo | Responsabilidade |
| --- | --- |
| `src/lib/content/variables.ts` | Tipos + avaliação **pura**. Sem `node:fs`, sem Astro. |
| `src/config/content-variables.json` | As variáveis. Versionado em Git, editável à mão. |
| `src/components/content/If.astro` | Condicional no **site publicado** (build time). |
| `src/lib/content/visibility-loader.ts` | Traduz `visible`/`showIf` para os mecanismos da Starlight. |
| `src/lib/editor/remark-resolve-conditionals.ts` | Condicional no **preview do editor**. |
| `src/lib/editor/variables-fs.ts` | Lê/escreve o JSON em runtime (só o editor). |

`variables.ts` é puro de propósito: os mesmos predicados decidem o que aparece
no site, no preview e na UI do editor. Uma regra, um lugar.

## Duas resoluções, de propósito diferentes

No **site publicado**, um trecho oculto não vai para o HTML — não está escondido
por CSS, não foi gerado. Isso é o ponto: conteúdo marcado como `interno` não
pode ser recuperável no navegador do leitor.

No **preview do editor** é o oposto: o trecho oculto vira um marcador cinza
dizendo qual condição falhou. Quem escreve precisa enxergar que existe conteúdo
condicional ali; sumir sem rastro seria péssimo para autoria.

## `visible: false` não é controle de acesso

"Invisível" aqui significa **fora da navegação e fora da busca**, mas ainda
publicada e acessível por URL direta. O `visibility-loader` faz isso escrevendo
`sidebar.hidden: true` e `pagefind: false` nas entradas da collection — dois
mecanismos que a Starlight já tem.

Deliberadamente **não** usamos `draft: true`, que removeria a página do build de
produção: o pedido é "publicada, porém invisível", não "não publicada".

Se o requisito for realmente esconder o conteúdo do leitor, a ferramenta é
`<If>` (que não emite o HTML) ou não publicar a página.

### O detalhe que fez isso funcionar

`store.set()` do Astro faz curto-circuito quando o `digest` recebido é igual ao
guardado. A primeira versão do loader repassava a entrada com spread — digest
original incluído — e virava um no-op silencioso: a página continuava na
sidebar. O loader agora passa os campos explicitamente e gera um digest novo com
`context.generateDigest(data)`.

## Variável desconhecida esconde

`isConditionMet` devolve `false` para uma variável que não existe. Um trecho
condicionado a algo que ninguém definiu fica oculto, em vez de vazar porque
alguém errou o nome ou apagou a definição. O editor reporta o caso à parte
(`conditionalIssues`, aviso no preview) para o erro não passar silencioso.

Com `not`, a negação continua coerente: `<If flag="inexistente" not>` aparece.

## Momento de resolução

As variáveis são resolvidas em **build time**. Mudar uma variável exige um novo
build para o site publicado refletir a mudança. No dev server, editar
`content-variables.json` dispara um reload completo da página (o JSON é
importado por `If.astro` e pelo loader), então o editor recarrega — inclusive
quando a mudança veio do próprio modal de variáveis.

## Fase 5 — o resto

| Recurso | Onde |
| --- | --- |
| Command Palette (`Ctrl/Cmd+P`, `Ctrl/Cmd+Shift+P`) | `CommandPalette.tsx` |
| Busca global (`Ctrl/Cmd+Shift+F`) | `SearchModal.tsx` + `lib/editor/search.ts` + `/api/editor/search` |
| Git awareness | `lib/editor/git-status.ts` + `/api/editor/git` — **somente leitura** |
| Detach | `detachReference` em `insert-helpers.ts` |
| Vim | `monaco-vim`, carregado sob demanda em `MarkdownEditorPane.tsx` |
| Atalhos de formatação | `wrapSelection` em `MarkdownEditorPane.tsx` |

### Git awareness é read-only

O editor mostra o estado do working tree, mas nunca faz commit, stage ou
checkout. Operações que mexem no histórico ficam com quem está no terminal.

### O alias do monaco-vim

`monaco-vim` importa caminhos internos como
`monaco-editor/esm/vs/editor/editor.api`. O campo `exports` do monaco-editor
0.56 mapeia `./*` para `./esm/vs/*.js`, o que transforma esse caminho em
`esm/vs/esm/vs/...` e quebra o build. `astro.config.mjs` tem um alias de Vite
apontando esses caminhos direto para os arquivos reais.

## Limites conhecidos

- `<If>` só funciona em `.mdx` — é JSX. Em `.md` a tag vira texto literal.
- A busca varre o conteúdo a cada consulta, sem índice. Adequado ao volume de um
  portal; não é uma estratégia para dezenas de milhares de arquivos.
- Condicionais aninhadas resolvem, mas a de fora decide primeiro: se ela está
  oculta, o que estiver dentro nem é avaliado no site publicado.
- `showIf` aceita uma variável só, com negação opcional — não há expressões
  booleanas compostas.
