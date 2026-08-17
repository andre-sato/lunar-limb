"""Ponto de entrada da CLI (§7.1, §10, §46).

    doc ask "Como funciona a autenticação da API?"
    doc search "OAuth PKCE"
    doc open authentication
    doc sources "Como funciona o rate limit?"
    doc references api-reference/authentication.md
    doc doctor
    doc server

Todo comando aceita `--json` (§47) e devolve os exit codes da §46 — o que
permite usar a CLI em script e em CI.
"""

from __future__ import annotations

import sys

import click
import typer

from ..config import ConfigError, load_config
from ..exit_codes import (
    CONFIG_ERROR,
    GENERAL_ERROR,
    INVALID_COMMAND,
    SUCCESS,
    DocError,
)
from . import commands, output

app = typer.Typer(
    add_completion=False,
    no_args_is_help=True,
    help="Consulta a documentação técnica pelo terminal, via MCP.",
)


def _framework_exceptions(name: str) -> tuple[type[BaseException], ...]:
    """Coleta uma exceção do Click e da cópia que o Typer traz consigo.

    O Typer moderno empacota o próprio Click em `typer._click`, então
    `typer._click.exceptions.UsageError` **não** é `click.exceptions.UsageError`.
    Capturar só uma das duas deixa "comando inexistente" cair no tratamento
    genérico e devolver o exit code errado.
    """
    found: list[type[BaseException]] = []
    for module in ("click.exceptions", "typer._click.exceptions"):
        try:
            imported = __import__(module, fromlist=[name])
        except ImportError:
            continue
        candidate = getattr(imported, name, None)
        if isinstance(candidate, type) and issubclass(candidate, BaseException):
            found.append(candidate)
    return tuple(found)


USAGE_ERRORS = _framework_exceptions("UsageError")
EXIT_EXCEPTIONS = _framework_exceptions("Exit") or (typer.Exit,)


def _config(limit: int | None = None, server_url: str | None = None, model: str | None = None):  # noqa: ANN202
    return load_config(limit=limit, server_url=server_url, model=model)


@app.command()
def ask(
    question: str = typer.Argument(..., help="A pergunta, em linguagem natural."),
    source: str | None = typer.Option(None, "--source", help="Restringe a um prefixo de caminho."),
    limit: int | None = typer.Option(None, "--limit", help="Trechos recuperados."),
    project: str | None = typer.Option(None, "--project", help="Projeto/repositório (§29)."),
    as_json: bool = typer.Option(False, "--json", help="Saída legível por máquina."),
) -> None:
    """Responde uma pergunta com base na documentação."""
    config = _config(limit=limit)
    if project:
        from dataclasses import replace

        config = replace(config, index=replace(config.index, repository=project))
    raise typer.Exit(commands.ask(question, source=source, as_json=as_json, config=config))


@app.command()
def search(
    query: str = typer.Argument(..., help="Termos de busca."),
    source: str | None = typer.Option(None, "--source", help="Restringe a um prefixo de caminho."),
    limit: int | None = typer.Option(None, "--limit", help="Máximo de resultados."),
    as_json: bool = typer.Option(False, "--json", help="Saída legível por máquina."),
) -> None:
    """Busca trechos sem gerar resposta — útil para depurar o retrieval."""
    raise typer.Exit(
        commands.search(query, source=source, as_json=as_json, config=_config(limit=limit))
    )


@app.command(name="open")
def open_document(
    name: str = typer.Argument(..., help="Caminho ou nome parcial do documento."),
    editor: bool = typer.Option(False, "--editor", help="Abre no editor do sistema."),
    as_json: bool = typer.Option(False, "--json", help="Saída legível por máquina."),
) -> None:
    """Exibe ou abre um documento."""
    raise typer.Exit(
        commands.open_document(name, as_json=as_json, editor=editor, config=_config())
    )


@app.command()
def sources(
    question: str = typer.Argument(..., help="A pergunta."),
    limit: int | None = typer.Option(None, "--limit", help="Trechos considerados."),
    as_json: bool = typer.Option(False, "--json", help="Saída legível por máquina."),
) -> None:
    """Mostra as fontes que responderiam a uma pergunta."""
    raise typer.Exit(commands.sources(question, as_json=as_json, config=_config(limit=limit)))


@app.command()
def references(
    path: str = typer.Argument(..., help="Caminho ou nome parcial do documento."),
    as_json: bool = typer.Option(False, "--json", help="Saída legível por máquina."),
) -> None:
    """Lista documentos relacionados, incluindo conteúdo reutilizável."""
    raise typer.Exit(commands.references(path, as_json=as_json, config=_config()))


@app.command()
def doctor(
    as_json: bool = typer.Option(False, "--json", help="Saída legível por máquina."),
) -> None:
    """Verifica configuração, índice, servidor MCP e serviços."""
    raise typer.Exit(commands.doctor(as_json=as_json, config=_config()))


@app.command()
def server(
    transport: str = typer.Option("stdio", help="stdio, streamable-http ou sse."),
    host: str = typer.Option("127.0.0.1", help="Host do transporte HTTP."),
    port: int = typer.Option(8000, help="Porta do transporte HTTP."),
) -> None:
    """Sobe o Documentation MCP Server localmente (§38)."""
    raise typer.Exit(commands.serve(transport=transport, host=host, port=port))


def main() -> int:
    """Traduz exceções em exit codes (§46)."""
    _force_utf8()
    try:
        # Com `standalone_mode=False`, o Click **devolve** o código de saída em
        # vez de levantar `Exit` — ignorá-lo faria todo comando terminar em 0,
        # inclusive "nenhuma documentação encontrada".
        result = app(standalone_mode=False)
    except DocError as error:
        output.render_error(str(error), error.hint)
        return error.code
    except ConfigError as error:
        output.render_error(f"Configuração inválida: {error}", "Verifique ~/.config/mcp-docs/config.toml")
        return CONFIG_ERROR
    except EXIT_EXCEPTIONS as error:
        return int(getattr(error, "exit_code", SUCCESS) or SUCCESS)
    except USAGE_ERRORS as error:
        # Comando inexistente, opção desconhecida, argumento faltando.
        output.render_error(str(error))
        return INVALID_COMMAND
    except KeyboardInterrupt:
        return GENERAL_ERROR
    except Exception as error:  # noqa: BLE001
        output.render_error(f"Erro inesperado: {type(error).__name__}: {error}")
        return GENERAL_ERROR

    return int(result) if isinstance(result, int) else SUCCESS


def _force_utf8() -> None:
    """Garante saída UTF-8 mesmo em console cp1252 (Windows).

    Documentação em português tem acento; sem isto o texto sai corrompido e o
    `--json` produz bytes que nenhum consumidor decodifica.
    """
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            try:
                reconfigure(encoding="utf-8", errors="replace")
            except (ValueError, OSError):
                pass


if __name__ == "__main__":
    sys.exit(main())
