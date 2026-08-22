---
type: Guide
title: Documentação adaptativa
description: Uma fonte, várias experiências — audiências, contexto de leitura, recomendações e o limite que a acessibilidade impõe à personalização.
resource: https://docs.suaempresa.com/guides/documentacao-adaptativa/
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
    resource: src/content/docs/guides/documentacao-adaptativa.mdx
    title: src/content/docs/guides/documentacao-adaptativa.mdx no repositório
    last_modified: '2026-08-22T00:41:25.387Z'
audiences:
  - developer
  - product
owner:
  type: team
  id: documentation
---

O princípio:

**Uma fonte de verdade, várias experiências contextuais.**

A mesma página serve a quem programa, a quem atende cliente e a quem opera — sem
duplicar arquivo. `authentication-developer.md` e `authentication-support.md`
divergem no terceiro mês, e ninguém percebe qual está certo.

## O limite vem primeiro

Personalização de documentação erra sempre do mesmo jeito: escondendo. Por isso a
regra que molda tudo aqui é a de acessibilidade, e ela é categórica.

**Nada é removido.** O conteúdo de outra audiência fica recolhido, com rótulo, e
continua no documento — alcançável por teclado, anunciado por leitor de tela e
encontrável pela busca do navegador (Ctrl+F). Adaptar é mudar **ordem e ênfase**,
nunca disponibilidade.

Isso vale também para a navegação e para as recomendações: elas reordenam e
destacam, e nunca tiram item da lista. Uma página que some porque alguém marcou
"suporte" é uma página que essa pessoa não sabe que existe.

**Diferente do `<If>`**
O portal já tem conteúdo condicional com `<If flag="beta">`. Aquilo resolve em
**build** e **apaga** o trecho — o certo para conteúdo interno, onde o objetivo é
não publicar. Aqui o objetivo é o oposto: publicar tudo e mudar só a ênfase.

## Declarando audiências

No frontmatter, na forma simples ou com prioridade:

```yaml
---
title: Autenticação
audiences: [developer, support]
---
```

```yaml
---
audience:
  developer: { priority: high }
  support: { priority: medium }
---
```

Página sem declaração serve a todo mundo — e é assim que a maior parte do portal
funciona. Ela não é penalizada em lugar nenhum: penalizá-la transformaria a
adaptação numa reordenação silenciosa de quase tudo.

## Conteúdo por audiência

Dentro da página, com a diretiva:

```markdown
:::audience{type="developer"}
O cabeçalho vale para toda requisição autenticada, inclusive as de leitura.

:::audience{type="support"}
Se a pessoa relatar erro 401, confira nesta ordem: cabeçalho presente, chave
revogada, ambiente correto.

```

O bloco vira um `<details>` com rótulo ("Para desenvolvimento", "Para suporte"),
**aberto** na renderização. Sem JavaScript, ou antes de ele rodar, a página
aparece inteira: a adaptação é melhoria progressiva, e o estado inicial precisa
ser o mais informativo.

Audiência escrita errada no atributo **não** faz o conteúdo sumir — o bloco vira
texto normal. Perder texto por causa de um erro de digitação seria a pior falha
possível para esta camada.

Veja o resultado em [Autenticação](/api-reference/authentication.md).

## O contexto de leitura

Quem lê escolhe o perfil na barra lateral, em **Como você está lendo**. A escolha
fica num cookie do próprio navegador.

Nada é inferido por comportamento. Adivinhar o papel de alguém e reorganizar a
documentação em cima do palpite é o tipo de esperteza que erra em silêncio.

O contexto também viaja por link: `?audience=support` tem precedência sobre o
cookie, para que "veja isto na visão de suporte" funcione para quem já tem
preferência salva.

Sem contexto nenhum, a documentação é a de sempre. Esse é o fallback, e ele é o
comportamento padrão, não uma exceção.

## Recomendações

No fim da página, **Você também pode precisar de** — montada a partir do Content
Graph (páginas ligadas a esta), das tags (mesmo assunto), do contexto e da
popularidade.

Cada item diz **por que** apareceu. Uma lista de links sem motivo é
indistinguível de uma lista aleatória, e depois de duas sugestões ruins ninguém
mais olha para a área.

A popularidade entra com peso pequeno e teto: ela mede o que já é encontrado, e
deixá-la dominar faria o portal recomendar sempre as mesmas cinco páginas,
enterrando o resto.

## No assistente

O contexto entra no prompt como **enquadramento**: recorte e tom, não fonte nem
permissão.

Três coisas que ele não faz. Não muda o que o assistente pode ler — a autorização
acontece antes, no filtro que decide quais trechos entram no contexto, e deixar
uma preferência de navegador mexer nisso seria transformá-la em controle de
acesso. Não autoriza inventar: continua valendo só a documentação recuperada. E
não some com informação — se a documentação só tem o detalhe técnico, quem atende
recebe o detalhe técnico. Melhor uma resposta fora do tom que uma resposta
faltando.

## No MCP

`search_docs` aceita `audience` e `version`. O filtro descarta apenas o que foi
escrito **explicitamente** para outro público; conteúdo sem audiência declarada
nunca é descartado — do contrário, informar o perfil esconderia quase todo o
portal.

Audiência desconhecida é **recusada**, não ignorada: um valor errado que passa
calado vira um filtro que nunca casa, e o agente conclui que não existe
documentação sobre o assunto.

## Analytics

Contadores por perfil, e nada além: quantas consultas vieram de cada audiência e
quantas ficaram sem resposta. Sem pergunta, sem página, sem quem perguntou.

A distribuição é o que muda a prioridade do backlog — saber que a maior parte das
consultas vem de quem atende move trabalho. O rastro individual não moveria nada
que a distribuição já não movesse, e criaria um arquivo para proteger para sempre.

O resultado aparece em **Settings → Health**, junto do resto da saúde da
documentação.
