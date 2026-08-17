"""CLI do indexador (§31).

    doc-index rebuild    reconstrói o índice inteiro
    doc-index update     processa só o que mudou
    doc-index status     mostra o estado do índice
"""

from __future__ import annotations

import sys

import typer
from rich.console import Console

from ..config import ConfigError, load_config
from ..exit_codes import CONFIG_ERROR, GENERAL_ERROR, SUCCESS
from ..search.hybrid import IndexUnavailable, JsonDocumentIndex
from ..search.vector import build_provider
from .indexer import IndexReport, Indexer

app = typer.Typer(add_completion=False, help="Indexador da documentação.")
console = Console()


def _build_indexer(fresh: bool) -> Indexer:
    config = load_config()
    embeddings = build_provider(config)
    index = JsonDocumentIndex(config.index_path, embeddings=embeddings)
    if not fresh:
        index.load()
    return Indexer(
        index=index,
        docs_roots=config.docs_roots(),
        snippets_roots=config.snippets_roots(),
        repository=config.index.repository,
        embeddings=embeddings,
    )


def _report(report: IndexReport, embeddings_available: bool) -> None:
    console.print()
    console.print(f"  documentos indexados   {report.indexed}")
    console.print(f"  documentos atualizados {report.updated}")
    console.print(f"  sem alteração          {report.unchanged}")
    console.print(f"  removidos              {report.removed}")
    console.print(f"  chunks                 {report.chunks}")
    if embeddings_available:
        console.print(f"  embeddings gerados     {report.embedded}")
    else:
        console.print("  embeddings             [yellow]sem serviço configurado (busca lexical)[/]")
    for error in report.errors:
        console.print(f"  [red]erro[/] {error}")
    console.print()


@app.command()
def rebuild() -> None:
    """Reconstrói o índice do zero."""
    indexer = _build_indexer(fresh=True)
    _report(indexer.rebuild(), indexer.embeddings.is_available())


@app.command()
def update() -> None:
    """Indexa apenas os documentos alterados."""
    indexer = _build_indexer(fresh=False)
    _report(indexer.update(), indexer.embeddings.is_available())


@app.command()
def status() -> None:
    """Mostra o estado atual do índice."""
    config = load_config()
    index = JsonDocumentIndex(config.index_path)
    try:
        index.load()
    except IndexUnavailable as error:
        console.print(f"[red]{error}[/]")
        raise typer.Exit(GENERAL_ERROR)

    pages = sum(1 for meta in index.documents.values() if meta.kind == "page")
    snippets = len(index.documents) - pages
    embedded = sum(1 for chunk in index.chunks if chunk.embedding)

    console.print()
    console.print(f"  índice   {config.index_path}")
    console.print(f"  páginas  {pages}")
    console.print(f"  blocos   {snippets}")
    console.print(f"  chunks   {len(index.chunks)} ({embedded} com embedding)")
    console.print()


def main() -> int:
    try:
        app()
    except ConfigError as error:
        console.print(f"[red]Configuração inválida:[/] {error}")
        return CONFIG_ERROR
    except SystemExit as error:  # Typer sinaliza saída por exceção
        return int(error.code or SUCCESS)
    return SUCCESS


if __name__ == "__main__":
    sys.exit(main())
