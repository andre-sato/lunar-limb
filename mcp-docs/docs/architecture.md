# Arquitetura

```text
Markdown/MDX (fonte de verdade, versionada em Git)
      │
      ▼
Indexer ── parse ── metadata ── chunking semântico ── embeddings (opcional)
      │
      ▼
Search Index (JSON local; interface DocumentIndex)
      │
      ▼
MCP Server ── search_docs · get_document · list_documents · find_references
      │
      ├──▶ CLI (doc ask, doc search, …)
      ├──▶ IDE
      └──▶ agentes de IA
```

## Por que o servidor é separado da CLI

Porque a CLI é apenas um cliente. Se a busca vivesse dentro dela, uma IDE ou um
agente precisariam reimplementá-la — e as duas implementações divergiriam. Com o
servidor MCP no meio, `doc ask` e um agente numa IDE veem as mesmas ferramentas,
com o mesmo comportamento e as mesmas validações.

É também o que torna o modo local e o remoto indistinguíveis para quem usa: a
mesma CLI fala stdio com um subprocesso ou streamable-http com um servidor
corporativo, decidido por uma linha de configuração.

## Chunking

A unidade é a **seção**, não N caracteres. Cada chunk carrega o título do
documento e o heading da seção no próprio texto:

```text
Document: Authentication
Section: OAuth Flow

O fluxo com PKCE tem quatro passos…
```

Sem esse cabeçalho, um parágrafo perde o assunto e deixa de ser encontrável por
quem pergunta pelo tema em vez das palavras exatas.

Blocos de código não são fragmentados: meio exemplo é pior que nenhum, porque
parece completo. Eles viram unidades próprias com `content_type: "code"` e a
linguagem em `code_language`, o que permite pedir só exemplos de código.

Prosa longa é dividida **entre parágrafos**, nunca no meio de um.

## Busca híbrida

```text
consulta ──┬──▶ BM25 (título e heading valem 2.2×)
           └──▶ cosseno sobre embeddings
                        │
              normalização por consulta
                        │
                    fusão ponderada
                        │
                     top-K
```

Os dois lados são normalizados pelo próprio melhor resultado antes da fusão. É o
que os põe na mesma escala sem depender do valor absoluto do BM25 (que não tem
escala) nem do cosseno.

O lexical existe porque é onde a busca semântica falha: `RATE_LIMIT_429` não tem
vizinhança semântica útil — tem uma ocorrência literal. O vetorial existe porque
é onde o lexical falha: "como faço para entrar no sistema" não compartilha
nenhuma palavra com "autenticação via OAuth".

Sem serviço de embeddings a fusão simplesmente não acontece, e o lexical responde
sozinho.

## Indexação incremental

```text
conteúdo ──▶ SHA-256 ──▶ content_hash
                              │
                    hash igual? não reprocessa
```

Com uma exceção que importa: quando um **bloco reutilizável** muda, as páginas que
o consomem também são reindexadas, mesmo com o hash delas inalterado. O conteúdo
efetivo delas mudou. Sem isso, editar um aviso reutilizado em cinco páginas
deixaria as cinco com o texto antigo no índice — uma classe de erro silenciosa e
difícil de perceber.

## Grafo de conteúdo reutilizável

O editor Starlight tem blocos reutilizáveis (`<ContentBlock id="rate-limit" />`).
O indexador extrai essas referências e monta o mapa inverso:

```text
rate-limit
    ├── api-reference/overview.md
    ├── api-reference/payments.md
    └── guides/webhooks.md
```

Isso resolve dois problemas. Citação: um bloco não tem página que o leitor possa
abrir, então a fonte citada é a página consumidora. E descoberta: dá para
responder "quais páginas usam o aviso de rate limit?".

## Abstrações

`DocumentIndex` (add/search/delete/rebuild) e `LLMProvider` (answer) existem para
que trocar FAISS por Qdrant, ou de provedor de LLM, não toque o MCP Server. A
implementação local é um JSON — suficiente para a escala de um portal e sem
serviço externo para subir.

## Observabilidade

Log estruturado de uma linha em **stderr** — o stdout é a resposta, e `--json`
precisa poder ir para o `jq`. Cada evento leva `request_id`, tool, duração e
contagem de resultados.

O emissor redige chaves e tokens em qualquer estrutura que passe por ele. Não por
convenção: convenção falha no dia em que alguém loga um dicionário de
configuração inteiro. O texto das perguntas fica fora por padrão.
