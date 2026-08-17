# Desenvolvimento

## Ambiente

```bash
pip install -e ".[dev]"
```

## Testes

```bash
pytest
```

Se o diretório temporário do sistema não for escrevível (acontece em alguns
ambientes restritos), aponte outro:

```bash
pytest --basetemp=.pytest-tmp
```

Os testes de integração sobem o servidor MCP real sobre streams em memória, sem
subprocesso. Isso exercita protocolo, schemas e validação de verdade, e mantém a
suíte rápida — o subprocesso é exercitado pelo `doc doctor`.

Um detalhe de implementação vale explicação: a sessão MCP é aberta por um context
manager **dentro de cada teste**, e não por uma fixture `yield`. O pytest-asyncio
finaliza fixtures em outra task, e os task groups do anyio recusam sair de um
escopo aberto em task diferente.

## Estrutura

```text
src/mcp_docs/
├── cli/        main.py (comandos), commands.py (fluxo), output.py (apresentação)
├── client/     mcp_client.py — a CLI como cliente MCP
├── server/     server.py (transporte, auth), tools.py (as 4 tools), schemas.py
├── indexer/    loader, parser, chunker, indexer, cli
├── search/     keyword (BM25), vector (embeddings), hybrid (índice e fusão)
├── llm/        client.py (provedores), prompt.py (contexto RAG)
├── config.py   configuração em camadas
├── models.py   tipos de domínio
└── observability.py  logging estruturado e métricas
```

## Adicionando uma tool

1. O schema de entrada em `server/schemas.py`, com validação Pydantic. Todo
   caminho passa por `safe_relative_path`.
2. A implementação em `server/tools.py`, sobre `JsonDocumentIndex`. Conteúdo que
   sai passa por `neutralize`.
3. O registro em `server/server.py`, com uma descrição que diga a um agente
   *quando* usar a ferramenta — é a descrição que ele lê para decidir.
4. Um atalho em `client/mcp_client.py`, se a CLI for usá-la.
5. Testes: schema (unidade) e round trip MCP (integração).

Ferramenta de escrita não entra aqui. A primeira versão é somente leitura, e
misturar leitura e escrita no mesmo servidor tira do cliente a possibilidade de
conceder apenas leitura.

## Avaliação do retrieval

`tests/fixtures/questions.json` lista perguntas com as fontes esperadas. Ao mexer
no ranking, rode a suíte: a piora aparece como teste vermelho, não como
impressão.

Para inspecionar contra a documentação real:

```bash
doc search "sua pergunta" --json
```

e confira `matched_by` e `score`.

## Convenções

- Todo argumento externo é validado antes de tocar índice ou disco.
- Nada de shell: comando é lista de argumentos.
- Sem `eval` nem `exec`.
- Segredo não entra em log nem em arquivo de configuração.
- Falha de serviço opcional degrada a funcionalidade; não derruba o comando.
