# mcp-docs — Documentation MCP Server + CLI

Consulta à documentação técnica pelo terminal, através do **Model Context
Protocol**.

```bash
doc ask "Como funciona o rate limit?"
```

```text
O limite é de 600 requisições por minuto por credencial. Acima disso a API
responde 429 Too Many Requests com o cabeçalho Retry-After.

Sources:
  api-reference/overview.md#url-base
  guides/getting-started.md#3-faca-uma-requisicao-autenticada
```

O Markdown/MDX continua sendo a fonte de verdade. Este projeto não substitui o
Git, o Starlight nem o editor: ele expõe o mesmo conteúdo por uma interface
padronizada que a CLI, uma IDE ou um agente de IA podem consumir.

## Três coisas separadas

A separação é o ponto de partida do desenho, e vale explicitá-la porque é comum
confundir as duas primeiras:

| | O que é | Onde |
| --- | --- | --- |
| **MCP Server** | Serviço que expõe *ferramentas* de documentação pelo protocolo MCP. Não é uma biblioteca de tool calling: é um servidor que qualquer cliente MCP consome. | `src/mcp_docs/server/` |
| **CLI** | Um *cliente* MCP entre outros. Não reimplementa busca — pede ao servidor. | `src/mcp_docs/cli/` |
| **Indexer + RAG** | Pipeline que transforma Markdown em unidades pesquisáveis, e a busca híbrida sobre elas. | `src/mcp_docs/indexer/`, `src/mcp_docs/search/` |

```text
Developer ──▶ CLI ──MCP──▶ MCP Server ──▶ Search Index ◀── Indexer ◀── Markdown/MDX
                 │                            │
              IDE, agentes                 read-only
```

## Instalação

Para desenvolvimento:

```bash
cd mcp-docs
pip install -e ".[dev]"
```

Com provedor de LLM:

```bash
pip install -e ".[dev,anthropic]"
```

Depois da instalação, `doc --help` funciona de qualquer diretório. Se o comando
não for encontrado, o diretório `Scripts/` (Windows) ou `bin/` (Unix) do Python
não está no `PATH`.

## Primeiro uso

```bash
doc-index rebuild
```

```bash
doc doctor
```

```bash
doc ask "Como funciona a autenticação?"
```

Por padrão o índice cobre a documentação do portal Starlight vizinho
(`../src/content/docs` e `../src/content/snippets`) — é a integração da §34 da
especificação: o que se escreve no editor vira conhecimento consultável na
próxima atualização do índice.

## Comandos

| Comando | O que faz |
| --- | --- |
| `doc ask "…"` | Responde com base na documentação, citando as fontes. |
| `doc search "…"` | Busca trechos sem gerar resposta — para depurar o retrieval. |
| `doc open <nome>` | Exibe um documento; `--editor` abre no editor do sistema. |
| `doc sources "…"` | Só as fontes que responderiam à pergunta. |
| `doc references <caminho>` | Documentos relacionados, incluindo conteúdo reutilizável. |
| `doc doctor` | Diagnóstico. |
| `doc server` | Sobe o MCP Server localmente. |
| `doc-index rebuild` / `update` / `status` | Indexação total, incremental, e estado. |

Todos aceitam `--json`, para uso em script e CI:

```bash
doc ask "Como autenticar?" --json | jq -r '.sources[]'
```

Exit codes: `0` sucesso · `1` erro geral · `2` comando inválido · `3`
configuração · `4` autenticação · `5` servidor MCP indisponível · `6` nenhuma
documentação relevante.

## Funciona sem chave de API

Duas capacidades são opcionais, e a ausência de cada uma **degrada** em vez de
quebrar:

- **Sem serviço de embeddings**, a busca é lexical (BM25 com reforço de título).
  Para documentação técnica isso já acerta em nome de método, código de erro e
  identificador — justamente onde a busca semântica costuma errar.
- **Sem provedor de LLM**, o `doc ask` devolve os trechos recuperados com as
  fontes, sem redigir prosa. Esse modo não tem como alucinar, porque não há
  modelo envolvido.

Uma CLI de documentação que só sabe dizer "configure uma chave" é inútil. As duas
chaves ampliam a qualidade; nenhuma delas é requisito para usar.

## Configuração

Precedência: argumentos → variáveis de ambiente → arquivo → padrões.

Em `~/.config/mcp-docs/config.toml`:

```toml
[server]
url = ""

[search]
limit = 5
min_score = 0.15
keyword_weight = 0.5

[llm]
model = "claude-opus-5"

[index]
docs_roots = ["../src/content/docs"]
snippets_roots = ["../src/content/snippets"]
path = "data/index.json"
```

`server.url` vazio significa "suba o servidor local por stdio", sem abrir porta.

Variáveis de ambiente: `DOC_MCP_SERVER_URL`, `DOC_SEARCH_LIMIT`,
`DOC_LLM_MODEL`, `DOC_INDEX_PATH`, `DOC_ROOT`, `DOC_CONFIG`, `DOC_LOG`,
`DOC_LOG_QUERIES`.

**Segredos vêm só do ambiente** (`ANTHROPIC_API_KEY`, `DOC_EMBEDDING_API_KEY`,
`DOC_MCP_TOKEN`), nunca do arquivo de configuração — que é feito para ser
versionado e compartilhado com o time. Ver `.env.example`.

## Usando como servidor MCP em outro cliente

O mesmo servidor serve Claude Desktop, uma IDE ou outro agente:

```json
{
  "mcpServers": {
    "documentation": {
      "command": "doc-mcp-server",
      "env": { "DOC_ROOT": "/caminho/para/mcp-docs" }
    }
  }
}
```

Modo remoto, com token:

```bash
DOC_MCP_TOKEN=seu-token doc server --transport streamable-http --port 8000
```

## Segurança

- **Somente leitura.** Nenhuma ferramenta escreve arquivo, executa comando, faz
  commit ou abre PR. O módulo das tools não importa `subprocess` nem `os`, e um
  teste verifica isso na AST — não por busca de texto, que a própria docstring
  contaminaria.
- **Todo argumento é validado** por Pydantic antes de tocar o índice. Um caminho
  como `../../etc/passwd` é recusado, e o servidor só entrega documentos
  presentes no índice: duas barreiras independentes.
- **Nada é executado como shell.** O comando do servidor local é uma lista de
  argumentos; a configuração recusa uma string, porque dividi-la já seria
  interpretar shell. Não há `eval` nem `exec`.
- **Documento é dado, não instrução.** Conteúdo com forma de instrução ("ignore
  all previous instructions") é neutralizado em citação inerte antes de sair do
  servidor, e o system prompt declara a documentação como material não confiável.
  Neutralizar e não descartar: uma página que *documenta* prompt injection
  continua consultável.
- **Segredos não vão para o log.** O emissor redige chaves e tokens em qualquer
  estrutura que passe por ele; o conteúdo das perguntas só é registrado se
  `DOC_LOG_QUERIES` for ligado explicitamente.

## Testes

```bash
pytest
```

129 testes: unidade (parsing, chunking, ranking, filtros, schemas, injeção,
configuração, redação de segredos) e integração (CLI → cliente MCP → servidor →
busca, com sessão MCP real sobre streams em memória).

`tests/fixtures/questions.json` é o dataset de avaliação: perguntas com as fontes
que deveriam ser recuperadas. É o que permite medir uma mudança no retrieval
antes de adotá-la.

## Estado em relação à especificação

**Pronto:** as quatro tools MCP, CLI instalável com todos os comandos,
indexação total e incremental por hash de conteúdo, busca híbrida com abstração
de vector store, grafo de conteúdo reutilizável, citações, saída JSON, exit
codes, logging estruturado com redação, token bearer, tratamento de injeção,
testes de unidade e integração, dataset de avaliação.

**Ainda não:** reranking (a própria spec o adia), webhook de commit, autorização
por usuário/equipe/documento (a estrutura existe — metadata de repositório e
filtros aplicados **antes** da recuperação), multi-repositório de verdade (o
campo existe; falta indexar mais de uma origem por execução), integração com
Notion/Confluence, cache e exportador de métricas.

Detalhes em [docs/architecture.md](docs/architecture.md),
[docs/mcp-tools.md](docs/mcp-tools.md) e
[docs/development.md](docs/development.md).
