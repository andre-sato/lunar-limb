"""Apresentação (§28, §45, §47).

Dois formatos: humano (Rich) e JSON. O JSON vai para o stdout **sozinho** — log
e mensagens de progresso vão para stderr — para que `doc ask --json | jq` funcione
sem tratamento especial.
"""

from __future__ import annotations

import json
import sys
from typing import Any

from rich.console import Console
from rich.table import Table

from ..models import Answer

#: Console de saída humana. `soft_wrap` evita que a Rich quebre caminhos longos
#: no meio, o que estragaria o copiar-e-colar de uma fonte (§28).
console = Console(soft_wrap=True)
error_console = Console(stderr=True)


def emit_json(payload: dict[str, Any]) -> None:
    """Escreve JSON em UTF-8, independente da codificação do terminal.

    No Windows o stdout costuma sair em cp1252, o que produz bytes inválidos
    para qualquer consumidor de `--json` assim que a documentação tem acento —
    e documentação em português tem. Escrever no buffer binário contorna isso
    sem depender da configuração do console.
    """
    text = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    buffer = getattr(sys.stdout, "buffer", None)
    if buffer is None:  # stdout capturado em teste
        sys.stdout.write(text)
        return
    buffer.write(text.encode("utf-8"))
    buffer.flush()


def render_answer(answer: Answer) -> None:
    console.print()
    console.print(answer.answer)

    if answer.sources:
        console.print()
        console.print("[bold]Sources:[/]")
        for source in answer.sources:
            console.print(f"  {source}")

    if answer.related:
        console.print()
        console.print("[bold]Related:[/]")
        for related in answer.related:
            console.print(f"  {related}")

    if answer.retrieval_only:
        console.print()
        console.print("[dim]Sem LLM configurado: resposta composta dos trechos recuperados.[/]")

    console.print()


def render_results(results: list[dict[str, Any]]) -> None:
    if not results:
        console.print("\n[yellow]Nenhum resultado.[/]\n")
        return

    console.print()
    for position, result in enumerate(results, start=1):
        section = f"  §{result['section']}" if result.get("section") else ""
        console.print(f"[bold]{position}. {result['title']}[/]{section}")
        console.print(f"   {result['path']}")
        console.print(f"   [dim]Score: {result['score']:.2f}  ({result.get('matched_by', 'keyword')})[/]")
        if result.get("used_by"):
            console.print(f"   [dim]Usado por: {', '.join(result['used_by'])}[/]")
        console.print()


def render_sources(sources: list[str]) -> None:
    console.print()
    console.print("[bold]Sources:[/]")
    console.print()
    for position, source in enumerate(sources, start=1):
        console.print(f"  {position}. {source}")
    console.print()


def render_document(document: dict[str, Any]) -> None:
    console.print()
    console.print(f"[bold]{document.get('title', '')}[/]")
    console.print(f"[dim]{document.get('path', '')}[/]")
    console.print()
    console.print(document.get("content", ""))
    console.print()


def render_doctor(checks: list[tuple[str, bool | None, str]]) -> None:
    table = Table(show_header=False, box=None, padding=(0, 1))
    for name, ok, detail in checks:
        mark = "[green]✓[/]" if ok else ("[yellow]•[/]" if ok is None else "[red]✗[/]")
        table.add_row(mark, name, f"[dim]{detail}[/]")

    console.print()
    console.print(table)
    console.print()


def render_error(message: str, hint: str | None = None) -> None:
    """Mensagem acionável (§45): o que falhou e o que fazer."""
    error_console.print()
    error_console.print(f"[red]{message}[/]")
    if hint:
        error_console.print()
        error_console.print(hint)
    error_console.print()
