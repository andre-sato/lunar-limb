---
type: Guide
title: Overlays e API Views
description: O que é um overlay de OpenAPI, por que ele substitui a segunda cópia da especificação, e o que muda na operação do dia a dia.
resource: https://docs.suaempresa.com/guides/overlays-e-api-views/
tags:
  - guia
  - api
  - portal
status: stable
generated:
  by: process:okf-export
  at: '2026-08-22T12:12:38.074Z'
verified:
  - by: human:mestre
    at: '2026-08-21T00:00:00.000Z'
stale_after: '2026-11-19T00:00:00.000Z'
sources:
  - id: repo
    resource: src/content/docs/guides/overlays-e-api-views.mdx
    title: src/content/docs/guides/overlays-e-api-views.mdx no repositório
    last_modified: '2026-08-22T00:41:25.391Z'
audiences:
  - developer
  - product
  - operations
owner:
  type: team
  id: platform
---

## O problema, antes da solução

Você tem uma especificação OpenAPI. Ela descreve tudo o que a sua API faz —
inclusive as rotas que existem para uma ferramenta interna e que ninguém de fora
deveria chamar.

Neste portal são duas: `/editor/lint` e `/editor/git/branches`. Elas **precisam**
estar na especificação: o [Digital Twin](/guides/digital-twin.md) as usa para saber
o que o produto implementa, e tirá-las de lá faria a cobertura reportar um número
falso. Mas publicá-las na referência externa convida alguém a integrar com um
endpoint que exige permissão de edição e pode mudar de forma sem aviso.

A saída óbvia é manter dois arquivos:

```text
src/schemas/openapi.yaml          ← tudo
src/schemas/openapi-public.yaml   ← só o que é público
```

Isso funciona por uma semana. Depois alguém corrige um código de erro no
primeiro e esquece o segundo, e as duas cópias divergem num ponto que ninguém
compara. Seis meses depois, ninguém sabe qual está certa.

## O que é um overlay

Um **overlay** é um arquivo que descreve *uma transformação* sobre a
especificação, em vez de uma cópia dela.

Ele não contém a API. Contém instruções — encontre este nó, remova; encontre
aquele, atualize:

```yaml
overlay: 1.0.0

info:
  title: Portal API — visão pública
  version: 1.0.0

actions:
  - target: "$.paths['/editor/lint']"
    description: Ferramenta interna. O linter é chamado pelo editor, não por integrações.
    remove: true
```

Isso é o [OpenAPI Overlay Specification 1.0.0](https://spec.openapis.org/overlay/latest.html),
um padrão aberto — não um formato deste portal.

A diferença com o segundo arquivo é a que decide tudo o mais:

| | Segunda cópia | Overlay |
| --- | --- | --- |
| Contém | a API inteira, de novo | só a diferença |
| Quando a base muda | precisa ser atualizada à mão | acompanha sozinho |
| Diz **por que** algo sumiu | não | sim, no `description` |
| Divergência silenciosa | é o modo de falha normal | não existe: só há uma fonte |

## Effective OpenAPI

O resultado de aplicar os overlays chama-se **Effective OpenAPI** — a
especificação efetiva.

```text
src/schemas/portal-api.yaml       (base, 5 operações)
            +
overlays/public.yaml              (remove 2, ajusta 2 descrições)
            ↓
.generated/openapi/public.yaml    (efetiva, 3 operações)
```

Do ponto de vista do resto do portal, a efetiva é uma OpenAPI comum. Ela alimenta
a documentação, os [contratos](/guides/contratos-de-documentacao.md), o
[SDK](/guides/sdk.md) e o Explorer exatamente como a base alimentaria.

**A base nunca é escrita**
Nenhum comando desta camada altera `src/schemas/portal-api.yaml`. A base continua
sendo a fonte de verdade do contrato; o overlay é uma leitura dela.

## API Views

Uma **API View** é a abstração deste portal acima do padrão: um nome, e a lista
ordenada de overlays que a produzem.

```yaml
# overlays.yml
overlays:
  views:
    public:
      overlays:
        - overlays/public.yaml

    partner:
      overlays:
        - overlays/public.yaml
        - overlays/partner.yaml
```

O padrão descreve um arquivo. A view é o que faz `--view public` significar a
mesma coisa na documentação, no SDK, nos contratos e nos testes.

Neste portal:

```text
base       5 operação(ões)   sem overlay
public     3 operação(ões)   1 overlay
partner    3 operação(ões)   2 overlays
```

`partner` empilha o overlay público e acrescenta o seu. Não é uma terceira cópia
— é a mesma base, lida duas vezes.

---

## O que muda na operação

Esta é a parte que costuma ser subestimada. Overlays não são só um recurso de
edição: eles mudam o que a sua equipe precisa verificar antes de publicar.

### 1. Existe uma classe de defeito nova

Um overlay age por endereço. Quando o endereço deixa de existir, a ação **roda
com sucesso e não faz efeito**:

```yaml
# O endpoint foi renomeado para /editor/analyze.
- target: "$.paths['/editor/lint']"
  remove: true
```

O overlay é válido. O motor roda. A efetiva sai sem erro. E o endpoint interno
continua publicado na referência externa.

Ninguém procura pela ausência de um efeito. Não há linha vermelha, não há
exceção — há uma rota a mais numa página que ninguém relê.

Por isso **alvo sem correspondência bloqueia a CI por padrão**:

```yaml
validation:
  failOnUnmatchedTarget: true
```

É o oposto da política do resto do portal, onde [portões bloqueiam
pouco](/guides/governanca.md). O critério é o mesmo, e aqui ele leva ao contrário:
só bloqueia o que torna algo publicado falso — e uma rota interna na referência
pública é exatamente isso.

### 2. A ordem passa a importar

As ações rodam na ordem em que aparecem, e uma pode atingir o que a anterior
produziu. Com duas views empilhadas, o mesmo vale entre arquivos.

Quando dois overlays mexem no mesmo nó, o motor chama de **conflito**:

```text
✓ partner
    conflito em info: Os dois overlays atualizam o mesmo nó. O último a rodar
    vence campo a campo, então trocar a ordem das views muda o documento efetivo.
```

Nem todo conflito é erro. Este é intencional — `partner` sobrescreve o título que
`public` definiu, e o resultado é o desejado. O que o relatório faz é dizer que
**o resultado depende da ordem**, para que a ordem seja uma decisão e não um
acidente.

O caso grave é outro:

| Combinação | Severidade | Por quê |
| --- | --- | --- |
| `remove` → `update` | **erro** | O segundo escreve num nó que não existe mais, e quem o escreveu não tem como perceber lendo o próprio arquivo |
| `update` → `update` | aviso | Definido, mas dependente da ordem |
| `remove` → `remove` | aviso | Um dos dois virou redundante |
| nós independentes | — | não é conflito |

### 3. Overlay é artefato governado

Um overlay altera o contrato que outras pessoas consomem. Ele declara dono e
finalidade:

```yaml
x-lunar:
  owner: platform
  purpose: public-api
  environment: production
```

Com `requireGovernance: true`, um overlay sem dono não passa na validação. A razão
é a mesma da [governança de páginas](/guides/governanca.md): um artefato sem dono é
um artefato que ninguém mantém — e este, especificamente, decide o que um cliente
externo enxerga.

### 4. O que a CI passa a verificar

```bash
npm run api -- check
```

Quatro degraus, nesta ordem:

1. **Os overlays são válidos?** Estrutura, versão, targets sintaticamente corretos.
2. **Os alvos existem?** É a verificação do item 1 desta seção.
3. **Há conflito de erro?** `remove` seguido de `update`.
4. **A efetiva ainda é uma OpenAPI?** Um overlay pode remover `info` inteiro e
   produzir um documento que o parser recusa. Melhor descobrir aqui.

Contratos, testes de documentação e SDK continuam com os seus comandos. Este
garante o degrau anterior: que a especificação que eles vão consumir existe e é
válida.

---

## Uso no dia a dia

### Ver o que existe

```bash
npm run overlay -- list
npm run api -- views
```

### Antes de publicar, sempre `preview`

```bash
npm run overlay -- preview --view public
```

```text
overlays/public.yaml
  ✓ $.paths['/editor/git/branches']
      remove · 1 nó(s)
      Ferramenta interna do editor. Exige `editor.access`.
  ✓ $.paths['/editor/lint']
      remove · 1 nó(s)
  ✓ $.info
      update · 1 nó(s)

Nada foi escrito: preview não grava arquivo.
```

O número de nós é a informação que importa. `1 nó` significa que a ação fez algo;
`0 nós` significa que ela não fez, e você quer saber disso antes de publicar.

### Ver a diferença semântica

```bash
npm run overlay -- diff --view public
```

```text
− /editor/git/branches  BREAKING
− /editor/lint          BREAKING
~ info.description
~ POST /feedback · description

2 removido(s) · 0 adicionado(s) · 2 atualizado(s) · 2 incompatível(is)
```

A comparação é da especificação **interpretada**, não do texto: reordenar chaves
do YAML não aparece aqui.

**Incompatível em relação à view, não à base**
`BREAKING` aqui significa que quem consome a view `public` não enxerga mais
aqueles endpoints. Do ponto de vista da API real nada foi removido — eles
continuam existindo e funcionando para quem tem permissão.

### Gerar as efetivas

```bash
npm run api -- build
npm run api -- build --view public
```

Elas vão para `.generated/openapi/`, que é **ignorado pelo Git** — versioná-las
criaria a segunda cópia do contrato que os overlays existem para evitar.

### Descobrir de onde veio uma alteração

```bash
npm run overlay -- provenance --view partner
```

Diz, por nó, qual overlay e qual ação o modificaram — na ordem em que aconteceu.

### Gerar um overlay a partir de duas versões

```bash
npm run overlay -- compare --before v1.yaml --after v2.yaml --output overlay.yaml
```

Útil para começar um overlay a partir de um recorte que já existe.

**Revise o resultado**
O overlay gerado descreve **o que mudou**, não o que deveria mudar. Ele é um
ponto de partida, e frequentemente contém ações que você não quer.

---

## Escrevendo um overlay

### Alvos

O `target` é JSONPath. Este portal suporta um subconjunto **declarado**:

```text
$                        raiz
$.paths                  filho por nome
$['paths']               com aspas — para nomes com barra ou ponto
$.paths['/users'].get    composição
$.servers[0]             índice
$.paths.*.get            curinga
$..parameters            descida recursiva
```

Filtros (`[?(@.deprecated)]`), expressões de script, uniões e fatias **não** são
suportados, e o motor os recusa com mensagem em vez de encontrar zero nós.

A recusa é deliberada, e a razão vale saber: avaliar um filtro significa executar
expressão vinda de um arquivo de configuração. E, mais prosaico, "0 nós
encontrados" por expressão não suportada é indistinguível de "0 nós encontrados"
porque o documento mudou — e os dois mandam você procurar em lugares opostos.

### `update` mescla, não substitui

```yaml
- target: "$.paths['/users'].get"
  update:
    description: Lista os usuários visíveis para consumidores externos.
```

Os outros campos do `get` continuam lá. A mesclagem é profunda para mapas, e
**substituição** para arrays — não há sintaxe no padrão para dizer se você quer
acrescentar ou trocar, e concatenar em silêncio transformaria "troque os
servidores" em "acrescente aos servidores".

### `remove` prevalece

Se uma ação traz `update` e `remove: true`, remove vence — é o que o padrão
define. O portal avisa, porque o resultado é claro e a intenção não.

### Sempre escreva `description`

Um overlay é lido meses depois por quem não o escreveu, e `remove: true` sobre um
JSONPath não explica por que aquele endpoint sumiu. O validador avisa quando
falta.

---

## Quando **não** usar overlay

Overlay é bom para recortar e enquadrar. Ele é a ferramenta errada para:

- **Esconder algo por segurança.** Remover o endpoint da referência pública não o
  torna inacessível — ele continua respondendo. Quem barra é a autorização.
- **Versionar a API.** Uma v2 com contrato diferente é outra especificação, não um
  recorte desta. Ver [versionamento](/guides/versionamento.md).
- **Corrigir a base.** Se a especificação está errada, corrija a especificação. Um
  overlay que conserta a base esconde o defeito de todas as views que não o usam.

---

## Referência de configuração

```yaml
api:
  specification: src/schemas/portal-api.yaml

overlays:
  enabled: true
  outputDir: .generated/openapi

  views:
    public:
      description: O que um consumidor externo enxerga.
      overlays:
        - overlays/public.yaml

  validation:
    failOnUnmatchedTarget: true   # alvo que não casa bloqueia
    failOnConflict: true          # conflito de erro bloqueia
    requireGovernance: true       # exige x-lunar.owner e x-lunar.purpose
```

## Arquitetura

A decisão de onde o motor entra, e por que não existe um segundo modelo de API,
está em [ADR-0017](https://github.com/andre-sato/lunar-limb/blob/master/docs/adr/0017-overlay-antes-do-apimodel.md).
A decisão sobre alvo sem correspondência e sobre o subconjunto de JSONPath está em
[ADR-0018](https://github.com/andre-sato/lunar-limb/blob/master/docs/adr/0018-alvo-sem-correspondencia.md).
