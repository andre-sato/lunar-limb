"""Implementação dos comandos (§10, §54).

Cada comando é uma função síncrona que abre uma sessão MCP, chama tools e
formata. O fluxo do `ask` é o da §54: CLI → MCP → search_docs → LLM → saída.

A CLI não pontua, não filtra e não rankeia nada por conta própria (§37): quem
faz isso é o servidor. O que ela faz é decidir *quais* tools chamar e como
mostrar o resultado.
"""

from __future__ import annotations

import asyncio
import os
import platform
import subprocess
from pathlib import Path
from typing import Any

from ..config import Config, load_config
from ..exit_codes import NO_DOCUMENTATION, SERVER_UNAVAILABLE, DocError
from ..llm.client import build_provider
from ..models import Answer, SearchResult
from ..observability import METRICS, emit, log_queries_enabled, timed
from ..client.mcp_client import DocumentationClient, connect
from ..search.hybrid import IndexUnavailable, JsonDocumentIndex
from ..search.vector import build_provider as build_embeddings
from . import output


def _run(coroutine):  # noqa: ANN001, ANN202
    """Roda a corrotina e desembrulha grupos de exceção.

    O cliente MCP usa task groups do anyio, que agrupam falhas em
    `BaseExceptionGroup`. Sem desembrulhar, um `DocError` com exit code 5
    ("servidor indisponível") chegaria à CLI como erro genérico 1 — perdendo
    justamente a informação que um script precisa.
    """
    try:
        return asyncio.run(coroutine)
    except BaseExceptionGroup as group:  # noqa: F821 - builtin em 3.11+
        doc_errors = _collect_doc_errors(group)
        if doc_errors:
            raise doc_errors[0] from group
        raise


def _collect_doc_errors(error: BaseException) -> list[DocError]:
    if isinstance(error, DocError):
        return [error]
    if isinstance(error, BaseExceptionGroup):  # noqa: F821
        found: list[DocError] = []
        for nested in error.exceptions:
            found.extend(_collect_doc_errors(nested))
        return found
    cause = error.__cause__ or error.__context__
    return _collect_doc_errors(cause) if cause is not None else []


def _to_results(raw: list[dict[str, Any]]) -> list[SearchResult]:
    results: list[SearchResult] = []
    for item in raw:
        results.append(
            SearchResult(
                title=item.get("title", ""),
                path=item.get("path", ""),
                section=item.get("section"),
                content=item.get("content", ""),
                score=float(item.get("score", 0)),
                url=item.get("url"),
                repository=item.get("repository", "default"),
                kind="snippet" if item.get("used_by") else "page",
                used_by=list(item.get("used_by", [])),
                matched_by=item.get("matched_by", "keyword"),
            )
        )
    return results


async def _search(client: DocumentationClient, config: Config, query: str, source: str | None) -> list[SearchResult]:
    raw = await client.search_docs(
        query,
        limit=config.search.limit,
        source=source,
        repository=None if config.index.repository == "default" else config.index.repository,
    )
    return _to_results(raw)


# ---------------------------------------------------------------------------
# ask (§10.1)
# ---------------------------------------------------------------------------


def ask(question: str, *, source: str | None, as_json: bool, config: Config) -> int:
    if log_queries_enabled():
        emit("ask", question=question)

    async def run() -> Answer:
        async with connect(config) as client:
            with timed("search", tool="search_docs") as extra:
                results = await _search(client, config, question, source)
                extra["results"] = len(results)

            provider = build_provider(config)
            with timed("llm", model=config.llm.model if config.has_llm() else "retrieval-only"):
                answer = provider.answer(question, results)

            # Mesmo sem resposta, mostrar o que existe perto é mais útil que
            # apenas dizer "não encontrei" (§27).
            if answer.insufficient_context:
                answer.related = [result.path for result in results[:3]]

            return answer

    answer = _run(run())

    if answer.insufficient_context:
        METRICS.increment("no_answer")
    if answer.sources:
        METRICS.increment("with_citation")

    if as_json:
        output.emit_json(
            {
                "answer": answer.answer,
                "sources": answer.sources,
                "related": answer.related,
                "retrieval_only": answer.retrieval_only,
            }
        )
    else:
        output.render_answer(answer)

    return NO_DOCUMENTATION if answer.insufficient_context else 0


# ---------------------------------------------------------------------------
# search (§10.2)
# ---------------------------------------------------------------------------


def search(query: str, *, source: str | None, as_json: bool, config: Config) -> int:
    async def run() -> list[dict[str, Any]]:
        async with connect(config) as client:
            return await client.search_docs(
                query, limit=config.search.limit, source=source
            )

    results = _run(run())

    if as_json:
        output.emit_json({"query": query, "results": results})
    else:
        output.render_results(results)

    return 0 if results else NO_DOCUMENTATION


# ---------------------------------------------------------------------------
# open (§10.3)
# ---------------------------------------------------------------------------


def open_document(name: str, *, as_json: bool, editor: bool, config: Config) -> int:
    async def run() -> dict[str, Any]:
        async with connect(config) as client:
            documents = await client.list_documents()
            match = _match_document(name, documents)
            if match is None:
                raise DocError(
                    f"Nenhum documento corresponde a '{name}'.",
                    NO_DOCUMENTATION,
                    hint="Use `doc search` para descobrir o caminho, ou `doc open --list`.",
                )
            return await client.get_document(match)

    document = _run(run())

    if editor:
        return _open_in_editor(document["path"], config)

    if as_json:
        output.emit_json(document)
    else:
        output.render_document(document)
    return 0


def _match_document(name: str, documents: list[str]) -> str | None:
    """Resolve um nome parcial para um caminho.

    Exato > nome de arquivo igual > contém. A preferência por igualdade evita
    que `doc open authentication` abra `authentication-warning` só porque veio
    antes na ordem alfabética.
    """
    if name in documents:
        return name

    stem = name.rsplit(".", 1)[0].lower()
    by_stem = [path for path in documents if Path(path).stem.lower() == stem]
    if by_stem:
        return sorted(by_stem, key=len)[0]

    contains = [path for path in documents if stem in path.lower()]
    return sorted(contains, key=len)[0] if contains else None


def _open_in_editor(path: str, config: Config) -> int:
    """Abre o arquivo no editor configurado (§10.3).

    O comando vem de `$VISUAL`/`$EDITOR` e é executado **sem shell**, com o
    caminho como argumento separado (§48.4) — um nome de arquivo com `;` não
    vira comando.
    """
    for root in config.docs_roots() + config.snippets_roots():
        candidate = root / path
        if candidate.is_file():
            editor = os.environ.get("VISUAL") or os.environ.get("EDITOR")
            if not editor:
                if platform.system() == "Windows":
                    os.startfile(candidate)  # type: ignore[attr-defined]  # noqa: S606
                    return 0
                editor = "open" if platform.system() == "Darwin" else "xdg-open"
            subprocess.run([editor, str(candidate)], check=False)  # noqa: S603
            return 0

    output.render_error(
        f"Arquivo não encontrado no disco: {path}",
        "O índice conhece o documento, mas o arquivo não está nas raízes configuradas.",
    )
    return NO_DOCUMENTATION


# ---------------------------------------------------------------------------
# sources (§10.4)
# ---------------------------------------------------------------------------


def sources(question: str, *, as_json: bool, config: Config) -> int:
    async def run() -> list[str]:
        async with connect(config) as client:
            results = await _search(client, config, question, None)
            from ..llm.prompt import citations

            return citations(results)

    found = _run(run())

    if as_json:
        output.emit_json({"question": question, "sources": found})
    else:
        if not found:
            output.render_error(
                "Nenhuma fonte encontrada para essa pergunta.",
                "Verifique se o índice está atualizado com `doc-index update`.",
            )
            return NO_DOCUMENTATION
        output.render_sources(found)

    return 0 if found else NO_DOCUMENTATION


# ---------------------------------------------------------------------------
# references
# ---------------------------------------------------------------------------


def references(path: str, *, as_json: bool, config: Config) -> int:
    async def run() -> list[dict[str, Any]]:
        async with connect(config) as client:
            documents = await client.list_documents()
            match = _match_document(path, documents)
            if match is None:
                raise DocError(f"Nenhum documento corresponde a '{path}'.", NO_DOCUMENTATION)
            return await client.find_references(match)

    found = _run(run())

    if as_json:
        output.emit_json({"path": path, "references": found})
    else:
        output.console.print()
        if not found:
            output.console.print("[yellow]Nenhuma referência encontrada.[/]")
        for reference in found:
            # `markup=False`: `[included_by]` seria interpretado como tag da
            # Rich e desapareceria da saída.
            output.console.print(f"  [{reference['type']}] {reference['path']}", markup=False)
        output.console.print()

    return 0


# ---------------------------------------------------------------------------
# doctor (§10.5)
# ---------------------------------------------------------------------------


def doctor(*, as_json: bool, config: Config) -> int:
    checks: list[tuple[str, bool | None, str]] = []

    from ..config import config_path

    path = config_path()
    checks.append(("Configuration", True, f"{path}{'' if path.is_file() else ' (padrões)'}"))

    # Índice: lido direto, sem passar pelo servidor, para distinguir "índice
    # ruim" de "servidor fora do ar".
    index_ok = False
    try:
        index = JsonDocumentIndex(config.index_path, embeddings=build_embeddings(config)).load()
        if index.documents:
            index_ok = True
            embedded = sum(1 for chunk in index.chunks if chunk.embedding)
            detail = f"{len(index.documents)} documentos, {len(index.chunks)} chunks, {embedded} com embedding"
        else:
            detail = f"vazio — rode `doc-index rebuild` ({config.index_path})"
    except IndexUnavailable as error:
        detail = str(error)
    checks.append(("Documentation index", index_ok, detail))

    # Servidor MCP: conectar de verdade e listar as tools.
    server_ok = False
    tools_detail = ""
    try:
        async def probe() -> list[str]:
            async with connect(config) as client:
                return await client.list_tools()

        tools = _run(probe())
        server_ok = True
        transport = "streamable-http" if config.server.url else "stdio (local)"
        tools_detail = f"{transport} — tools: {', '.join(sorted(tools))}"
    except DocError as error:
        tools_detail = str(error).splitlines()[0]
    except Exception as error:  # noqa: BLE001
        tools_detail = f"{type(error).__name__}: {error}"
    checks.append(("MCP server", server_ok, tools_detail))

    checks.append(
        (
            "Authentication",
            None if not config.mcp_token else True,
            "token configurado" if config.mcp_token else "sem token (modo local)",
        )
    )
    checks.append(
        (
            "Embedding service",
            None if not config.has_embeddings() else True,
            f"{config.embedding.model} @ {config.embedding.base_url}"
            if config.has_embeddings()
            else "não configurado — busca lexical",
        )
    )
    checks.append(
        (
            "LLM service",
            None if not config.has_llm() else True,
            config.llm.model if config.has_llm() else "não configurado — modo só-retrieval",
        )
    )

    if as_json:
        output.emit_json(
            {
                "checks": [
                    {"name": name, "ok": ok, "detail": detail} for name, ok, detail in checks
                ],
                "metrics": METRICS.snapshot(),
            }
        )
    else:
        output.render_doctor(checks)

    # Só índice e servidor são bloqueantes: sem chave de LLM a ferramenta
    # continua útil, e reportar isso como falha seria mentira.
    if not index_ok:
        return NO_DOCUMENTATION
    if not server_ok:
        return SERVER_UNAVAILABLE
    return 0


# ---------------------------------------------------------------------------
# server (§38)
# ---------------------------------------------------------------------------


def serve(*, transport: str, host: str, port: int) -> int:
    from ..server.server import build_server

    server = build_server(load_config())
    if transport == "stdio":
        server.run(transport="stdio")
    else:
        server.run(transport=transport, host=host, port=port)  # type: ignore[arg-type]
    return 0
