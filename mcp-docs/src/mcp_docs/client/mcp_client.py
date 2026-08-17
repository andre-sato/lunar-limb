"""Cliente MCP (§37).

A CLI **não** reimplementa busca: ela fala MCP com o servidor. É o que garante
que o `doc ask` e um agente numa IDE vejam exatamente as mesmas ferramentas com
o mesmo comportamento.

Dois modos, escolhidos pela configuração:

* sem `server.url`, o servidor sobe como subprocesso e conversa por stdio (§38);
* com `server.url`, conecta por streamable-http com token bearer (§39, §40).

O comando do servidor local é uma **lista** de argumentos e é executado sem
shell (§48.4) — não há string de comando para alguém injetar argumento.
"""

from __future__ import annotations

import json
import shutil
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from ..config import Config
from ..exit_codes import AUTH_ERROR, SERVER_UNAVAILABLE, DocError
from ..observability import emit


class DocumentationClient:
    """Sessão MCP com as quatro tools de documentação."""

    def __init__(self, session: ClientSession) -> None:
        self._session = session

    async def list_tools(self) -> list[str]:
        result = await self._session.list_tools()
        return [tool.name for tool in result.tools]

    async def call(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        # `None` não é omissão para o servidor: remover as chaves vazias deixa
        # os defaults do schema valerem.
        cleaned = {key: value for key, value in arguments.items() if value is not None}
        result = await self._session.call_tool(name, cleaned)

        payload = getattr(result, "structuredContent", None)
        if isinstance(payload, dict):
            # O SDK embrulha retorno não-dict em {"result": …}.
            payload = payload.get("result", payload) if set(payload) == {"result"} else payload
            if isinstance(payload, dict):
                if "error" in payload:
                    raise DocError(str(payload["error"]))
                return payload

        texts = [block.text for block in getattr(result, "content", []) if getattr(block, "type", "") == "text"]
        if getattr(result, "isError", False):
            raise DocError(texts[0] if texts else "A ferramenta MCP retornou erro.")

        # Sem `structuredContent`, o corpo vem como texto — que é o caso de boa
        # parte dos servidores MCP e também deste, dependendo da versão do SDK.
        # Tentar decodificar é o que mantém o cliente interoperável em vez de
        # depender de um detalhe de serialização do servidor.
        joined = "\n".join(texts)
        try:
            decoded = json.loads(joined)
        except (json.JSONDecodeError, ValueError):
            return {"text": joined}

        if isinstance(decoded, dict):
            if "error" in decoded:
                raise DocError(str(decoded["error"]))
            return decoded
        return {"text": joined}

    # -- atalhos por tool ----------------------------------------------------

    async def search_docs(self, query: str, **options: Any) -> list[dict[str, Any]]:
        payload = await self.call("search_docs", {"query": query, **options})
        results = payload.get("results", [])
        return results if isinstance(results, list) else []

    async def get_document(self, path: str) -> dict[str, Any]:
        return await self.call("get_document", {"path": path})

    async def list_documents(self, prefix: str = "") -> list[str]:
        payload = await self.call("list_documents", {"prefix": prefix})
        documents = payload.get("documents", [])
        return documents if isinstance(documents, list) else []

    async def find_references(self, path: str) -> list[dict[str, Any]]:
        payload = await self.call("find_references", {"path": path})
        references = payload.get("references", [])
        return references if isinstance(references, list) else []


@asynccontextmanager
async def connect(config: Config) -> AsyncIterator[DocumentationClient]:
    if config.server.url:
        async with _connect_http(config) as client:
            yield client
    else:
        async with _connect_stdio(config) as client:
            yield client


#: Prefixos de variáveis que o servidor local precisa receber.
#
# O SDK MCP herda um conjunto mínimo de variáveis para o subprocesso — o que é
# um bom padrão, mas silenciosamente ignoraria `DOC_INDEX_PATH` e companhia:
# a CLI leria uma configuração e o servidor outra. Repassar é explícito.
_FORWARDED_PREFIXES = ("DOC_", "ANTHROPIC_", "OPENAI_")


def _server_environment() -> dict[str, str]:
    import os

    from mcp.client.stdio import get_default_environment

    environment = dict(get_default_environment())
    for key, value in os.environ.items():
        if key.startswith(_FORWARDED_PREFIXES):
            environment[key] = value
    return environment


@asynccontextmanager
async def _connect_stdio(config: Config) -> AsyncIterator[DocumentationClient]:
    command, *arguments = config.server.command
    resolved = shutil.which(command)
    if resolved is None:
        raise DocError(
            f"Executável do servidor MCP não encontrado: {command}",
            SERVER_UNAVAILABLE,
            hint="Instale o pacote com `pip install -e .` e confirme que o Scripts/ do Python está no PATH.",
        )

    parameters = StdioServerParameters(
        command=resolved,
        args=list(arguments),
        cwd=str(config.root),
        env=_server_environment(),
    )

    emit("client_connect", transport="stdio", command=command)
    try:
        async with stdio_client(parameters) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                yield DocumentationClient(session)
    except DocError:
        raise
    except Exception as error:
        raise DocError(
            f"Não foi possível iniciar o servidor MCP local: {error}",
            SERVER_UNAVAILABLE,
            hint="Rode `doc doctor` para diagnosticar.",
        ) from error


@asynccontextmanager
async def _connect_http(config: Config) -> AsyncIterator[DocumentationClient]:
    from mcp.client.streamable_http import create_mcp_http_client, streamable_http_client

    url = config.server.url.rstrip("/")
    if not url.endswith("/mcp"):
        url = f"{url}/mcp"

    # O transporte não recebe cabeçalhos direto: eles vão no cliente HTTP.
    headers = {"authorization": f"Bearer {config.mcp_token}"} if config.mcp_token else None

    emit("client_connect", transport="streamable-http", url=url, authenticated=bool(config.mcp_token))
    try:
        http_client = create_mcp_http_client(headers=headers)
        async with streamable_http_client(url, http_client=http_client) as streams:
            read, write = streams[0], streams[1]
            async with ClientSession(read, write) as session:
                await session.initialize()
                yield DocumentationClient(session)
    except Exception as error:
        # O SDK reporta qualquer falha de transporte como um erro JSON-RPC
        # genérico (-32603), sem o status HTTP. Sem distinguir 401 de "servidor
        # fora do ar", um token errado devolveria exit code 5 e o script de
        # quem chamou trataria como indisponibilidade. Uma requisição extra,
        # só no caminho de erro, recupera essa informação.
        status = await _probe_status(url, headers)

        if status in (401, 403):
            raise DocError(
                "O servidor MCP recusou as credenciais.",
                AUTH_ERROR,
                hint="Defina DOC_MCP_TOKEN com um token válido.",
            ) from error

        raise DocError(
            f"Não foi possível conectar ao Documentation MCP Server.\n\nServidor:\n{url}",
            SERVER_UNAVAILABLE,
            hint="Rode `doc doctor`.",
        ) from error


async def _probe_status(url: str, headers: dict[str, str] | None) -> int | None:
    """Status HTTP do endpoint MCP, ou `None` se nem conectar foi possível."""
    import httpx

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.post(
                url,
                headers={**(headers or {}), "accept": "application/json, text/event-stream"},
                json={"jsonrpc": "2.0", "id": 0, "method": "ping"},
            )
            return response.status_code
    except Exception:
        return None
