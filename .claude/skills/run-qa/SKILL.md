---
name: run-qa
description: Roda a bateria de qualidade do portal e caça bugs de robustez nas rotas de API — testes, lint, type check, contratos, saúde da documentação e varredura de 500 em toda a API. Use para "rodar o QA", "bug hunt", "testes e2e", "checar qualidade".
---

# Quality Assurance do lunar-limb

Duas ferramentas, para dois trabalhos diferentes:

| Ferramenta | Responde |
| --- | --- |
| `driver.mjs` | Os portões de qualidade passam? (testes, tipos, lint, contratos, saúde) |
| `api-sweep.mjs` | Alguma rota de API estoura com entrada malformada? |

Caminhos relativos à raiz do repositório.

## Pré-requisitos

Node >= 20.19.0 e as dependências instaladas:

```bash
npm install
```

## Bateria de qualidade

```bash
node .claude/skills/run-qa/driver.mjs
```

Roda sete verificações em série e imprime um resumo com tempo por etapa. Sai com
0 quando todas passam, 1 quando alguma falha.

O que ele roda, e o que cada uma significa quando falha:

| Etapa | Comando | Falha quer dizer |
| --- | --- | --- |
| type-check | `npm run check` | erro de tipo — sempre corrigir |
| unit-tests | `npm run test` | teste vermelho |
| lint | `npm run docs:lint` | **quality gate** editorial reprovou |
| docs-test | `npm run docs:test` | link ou âncora quebrada |
| docs-code | `npm run docs:code` | bloco de código da documentação não roda |
| contract | `npm run contract` | exemplo discorda da especificação |
| health | `npm run docs:health` | nota de saúde abaixo do SLO |

Duas dessas falham por **política**, não por defeito: `lint` reprova quando a
nota editorial fica abaixo do mínimo, e `health` quando o SLO é violado. São
sinais para priorizar, não necessariamente para bloquear.

Leva cerca de 90 s, e a maior parte é o `astro check`.

## Varredura de robustez da API

```bash
node .claude/skills/run-qa/api-sweep.mjs
```

Sobe uma instância isolada (`PORTAL_DATA_DIR` descartável, admin próprio), entra
como administrador e bate em toda rota de `src/pages/api` com nove formas de
corpo × quatro métodos — 43 rotas, ~1550 requisições, cerca de 3 min.

Procura **500**, e só. Um 400 é a rota recusando entrada ruim, que é o trabalho
dela; um 500 é a rota estourando, que nunca é.

Contra um servidor já no ar:

```bash
node .claude/skills/run-qa/api-sweep.mjs --port 4331
```

Sai com 0 quando não há 500, 1 quando há. Use `--json` para consumir a saída.

## O que a rodada de bug hunt (#19) encontrou

Dezoito rotas devolviam 500. Três defeitos, uma raiz só: **o corpo da
requisição era presumido objeto**.

1. **Corpo vazio ou malformado.** `request.json()` lança, e o `catch` da rota
   mandava tudo para 500 repetindo a mensagem do interpretador
   (`Unexpected end of JSON input`) para o cliente.
2. **Corpo `null`, `[]`, `"texto"`, `123`.** Este é o traiçoeiro: **não lança**.
   O JSON é válido, o `as Record<string, unknown>` promete um objeto que o valor
   não é, e o `TypeError` estoura na linha seguinte — longe do lugar onde dava
   para responder "corpo inválido". Um `try/catch` em volta do `json()` não pega
   nenhum destes.
3. **`plan.files: [null]`** no lote: a lista era conferida, as entradas não.

O mais exposto era `/api/auth/login` — público e anterior à autenticação, ou
seja, derrubável sem credencial nenhuma.

A correção foi um ponto único, `readJsonObject` em `src/lib/auth/api.ts`, e o
que impede a volta é `tests/request-body.test.ts`: ele varre `src/pages/api` e
reprova qualquer rota que chame `request.json()` direto, com uma lista curta de
exceções conferidas à mão.

## Gotchas

**O Astro barra escrita sem `Origin`.** Um `curl -X DELETE` sem cabeçalho
`Origin` recebe `403 Cross-site DELETE form submissions are forbidden` — é a
proteção CSRF nativa, não a autorização do portal. Sem esse cabeçalho os
métodos de escrita nunca chegam ao handler, e a varredura mediria nada. O
`api-sweep.mjs` já manda `Origin`.

**A porta pode não ser a que você pediu.** Se `4330` já estiver ocupada, o
`astro dev` sobe na seguinte e **avisa só no log**. Confira antes de concluir
que uma correção não funcionou:

```bash
npx astro dev status
```

**Cookie de sessão é por host, não por porta.** `localhost:4330` e
`localhost:4331` compartilham a sessão — uma instância nova pode aparecer já
autenticada, e um teste de "acesso anônimo" pode passar por engano.

**`504 Outdated Optimize Dep` no console do editor** é cache do Vite depois de
muitos hot reloads, não defeito do app. Reinicie limpando:

```bash
rm -rf node_modules/.vite .astro
```

**Nunca aponte o `api-sweep` para uma instância real.** Ele espera um
administrador semeado com credencial conhecida e apaga o diretório de dados no
fim.

**`PORTAL_DATA_DIR` isola usuários e sessões, não o conteúdo.** As rotas do
editor escrevem em `src/content/` e `src/config/` — o repositório de verdade,
mesmo numa instância "isolada". Um `PUT /api/editor/variables` de teste apagou
duas variáveis reais de `src/config/content-variables.json` (a escrita é do mapa
completo, por design). Rode a caçada com a árvore limpa e confira depois:

```bash
git status --porcelain src/content src/config
```

Criar página pelo editor também gera os espelhos `en/` e `es/` — apague os três,
não só o que você criou.

## Falha conhecida, anterior a este trabalho

`tests/asyncapi.test.ts > corresponde ao arquivo comitado` falha em checkout
Windows: o arquivo comitado é LF, o gerado sai CRLF. Não é regressão, e não
acontece no CI Linux.

## Instância de verificação, à mão

Quando precisar dirigir a UI em vez de bater na API:

```bash
PORTAL_DATA_DIR=.verify-qa PORTAL_ADMIN_EMAIL=qa@example.com PORTAL_ADMIN_PASSWORD=qa-bug-hunt-2026 npx astro dev --port 4330
```

`.verify-*/` é ignorado pelo Git — o padrão que o próprio projeto reserva para
isso. Apague o diretório no fim; ele guarda hash de senha e sessões.
