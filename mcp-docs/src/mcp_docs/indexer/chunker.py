"""Chunking semântico (§21, §22).

Duas regras que a spec faz questão de dizer, e que definem este módulo:

* não dividir a cada N caracteres — a unidade é a seção;
* o heading acompanha o conteúdo, porque um parágrafo sem o título da seção
  perde o assunto e a busca deixa de encontrá-lo.

E uma consequência: bloco de código não é fragmentado. Meio exemplo de código
é pior que nenhum, porque parece completo.
"""

from __future__ import annotations

from datetime import datetime

from ..models import Chunk, ContentType
from .parser import Block, ParsedDocument, Section

#: Alvo de tamanho para uma seção de prosa. Acima disto ela é dividida entre
#: parágrafos — nunca no meio de um.
MAX_PROSE_CHARS = 1800


def _context_header(title: str, section: str | None) -> str:
    """Cabeçalho que preserva o contexto dentro do próprio texto do chunk (§21)."""
    lines = [f"Document: {title}"]
    if section:
        lines.append(f"Section: {section}")
    return "\n".join(lines)


def _split_prose(text: str) -> list[str]:
    """Divide prosa longa entre parágrafos, acumulando até o alvo."""
    paragraphs = [part.strip() for part in text.split("\n\n") if part.strip()]
    parts: list[str] = []
    current: list[str] = []
    size = 0

    for paragraph in paragraphs:
        if current and size + len(paragraph) > MAX_PROSE_CHARS:
            parts.append("\n\n".join(current))
            current = []
            size = 0
        current.append(paragraph)
        size += len(paragraph)

    if current:
        parts.append("\n\n".join(current))
    return parts or ([text.strip()] if text.strip() else [])


def _blocks_to_units(blocks: list[Block]) -> list[tuple[ContentType, str, str | None]]:
    """Agrupa os blocos de uma seção em unidades indexáveis.

    Prosa vizinha é juntada; código e tabela viram unidades próprias, com o
    `content_type` correspondente — é o que permite filtrar por tipo depois.
    """
    units: list[tuple[ContentType, str, str | None]] = []
    prose: list[str] = []

    def flush_prose() -> None:
        if not prose:
            return
        joined = "\n\n".join(prose)
        prose.clear()
        for part in _split_prose(joined):
            units.append(("documentation", part, None))

    for block in blocks:
        if block.kind == "prose":
            prose.append(block.text)
        elif block.kind == "code":
            flush_prose()
            units.append(("code", block.text, block.code_language))
        else:
            flush_prose()
            units.append(("table", block.text, None))

    flush_prose()
    return units


def chunk_document(
    *,
    path: str,
    parsed: ParsedDocument,
    title: str,
    updated_at: datetime,
    repository: str = "default",
    language: str = "pt-BR",
    kind: str = "page",
    url: str | None = None,
    used_by: list[str] | None = None,
) -> list[Chunk]:
    chunks: list[Chunk] = []
    index = 0

    for section in parsed.sections:
        units = _blocks_to_units(section.blocks)
        if not units:
            continue

        for content_type, text, code_language in units:
            if not text.strip():
                continue

            header = _context_header(title, section.heading)
            chunks.append(
                Chunk(
                    id=f"{path}#{index}",
                    source=path,
                    title=title,
                    section=section.heading,
                    content=f"{header}\n\n{text}".strip(),
                    content_type=content_type,
                    code_language=code_language,
                    language=language,
                    repository=repository,
                    updated_at=updated_at,
                    kind=kind,  # type: ignore[arg-type]
                    url=_section_url(url, section),
                    used_by=list(used_by or []),
                )
            )
            index += 1

    return chunks


def _section_url(url: str | None, section: Section) -> str | None:
    if not url:
        return None
    if not section.heading:
        return url
    from ..models import slugify

    return f"{url}#{slugify(section.heading)}"
