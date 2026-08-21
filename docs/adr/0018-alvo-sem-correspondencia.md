# ADR-0018 — Alvo sem correspondência bloqueia, e JSONPath é um subconjunto declarado

**Status:** Aceita · **Data:** 2026-08 · **Nível C4:** Componente

## Contexto

Um overlay age por endereço. `target: "$.paths['/editor/lint']"` diz *encontre
este nó*, e `remove: true` diz o que fazer com ele.

Isso cria uma classe de defeito que não existe em quase nenhuma outra camada do
portal: **a ação que roda com sucesso e não faz efeito**.

```yaml
# O endpoint mudou de `/editor/lint` para `/editor/analyze`.
- target: "$.paths['/editor/lint']"
  remove: true
```

O overlay é válido. O motor roda. A especificação efetiva sai sem erro. E o
endpoint interno continua publicado na referência externa.

Ninguém procura pela ausência de um efeito. Não há linha vermelha, não há
exceção, não há diff estranho — há uma rota a mais numa página que ninguém
relê. O defeito é descoberto quando um integrador externo escreve para o suporte
perguntando por que `/editor/lint` devolve 403.

A mesma armadilha tem uma segunda entrada. Se o `target` usa uma construção de
JSONPath que a implementação não suporta, o resultado natural é encontrar zero
nós — **indistinguível** de um alvo legítimo que não existe mais. As duas
situações mandam o autor investigar coisas opostas.

## Decisão

**Alvo sem correspondência bloqueia a CI por padrão** (`failOnUnmatchedTarget:
true`), e **expressão fora do subconjunto suportado falha com mensagem**, nunca
com lista vazia.

O motor separa três desfechos que seriam um só:

| Desfecho | Significado | Efeito |
| --- | --- | --- |
| `matched > 0` | O alvo existe e a ação rodou | segue |
| `matched === 0` | O documento não tem esse nó | bloqueia por padrão |
| `error` | A expressão está fora do subconjunto | bloqueia sempre |

O terceiro bloqueia independentemente de política: ali não há resultado a
avaliar, a ação simplesmente não rodou.

### O subconjunto de JSONPath

A Overlay Specification remete a JSONPath sem fixar um dialeto. A implementação
suporta, e documenta em `src/lib/overlay/jsonpath.ts`:

```text
$                        raiz
$.paths                  filho por nome
$['paths']               idem, com aspas — para nomes com barra ou ponto
$.paths['/users'].get    composição
$.servers[0]             índice
$.paths.*                curinga
$..parameters            descida recursiva
```

E recusa, com mensagem que diz o porquê:

```text
$.paths[?(@.deprecated)]   filtro
$.paths[(@.length-1)]      expressão de script
$.paths['a','b']           união
$.servers[0:2]             fatia
```

Filtro e script são o motivo principal de esta implementação existir em vez de
uma biblioteca: avaliá-los significa **executar expressão vinda de um arquivo de
configuração**, que é o que a spec § 41 pede para não fazer.

## Consequências

**O que melhorou.** O overlay que parou de casar aparece na CI no mesmo pull
request que mexeu na especificação — que é o único momento em que a pessoa tem
contexto para consertá-lo.

A recusa explícita de filtro dá uma mensagem acionável (`use um alvo literal`) no
lugar de um "0 nós encontrados" que manda o autor procurar no documento errado.

**O que custou.** Rigidez. Um overlay que mira algo opcional — um endpoint que
existe em produção e não em staging — passa a exigir `failOnUnmatchedTarget:
false` no projeto inteiro, porque a política não é por ação. É a granularidade
que faltou, e o caminho de saída existe.

O subconjunto também cobra: quem chega de outra ferramenta com um `target` de
filtro precisa reescrevê-lo em alvos literais. Em troca, o que roda é
navegação de estrutura, não avaliação de expressão.

**O que passou a ser possível.** Confiar no relatório. Um `preview` que mostra
`✓ 4 ações, 4 nós` significa que as quatro fizeram algo — que é a única pergunta
que importa antes de publicar a view.

## Alternativas consideradas

**Avisar sem bloquear.** Consistente com a
[ADR-0012](0012-portoes-que-bloqueiam-pouco.md), que diz que portões devem
bloquear pouco. Foi descartado aqui pelo critério que aquela mesma ADR fixa: só
bloqueia o que **torna algo publicado falso**. Um endpoint interno que continua
na referência pública é exatamente isso — a página promete um contrato que não
existe para quem a lê.

**Uma biblioteca de JSONPath.** Cobre o padrão inteiro, incluindo filtros, e traz
avaliação de expressão para dentro do build. Para um arquivo que descreve
transformação de contrato e é revisado em pull request, o ganho não compensa a
superfície.

**Inferir a correção do alvo** — o endpoint mudou de nome, o motor tenta o nome
novo. Foi descartado pelo mesmo princípio da
[ADR-0010](0010-guardrails-por-construcao.md): adivinhar sobre um contrato é como
se propaga uma alteração que ninguém aprovou. O self-healing pode **sugerir** um
alvo novo; aplicá-lo continua exigindo aprovação humana.
