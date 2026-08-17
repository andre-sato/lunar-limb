"""Parsing de Markdown/MDX (§19, §20).

Sem dependência de parser Markdown completo: o que o indexador precisa é
frontmatter, headings, blocos de código e referências a conteúdo reutilizável.
Um AST completo seria mais rigoroso e traria uma dependência grande para
resolver um problema que a estrutura de linhas já resolve — a única sutileza
real é não confundir `#` dentro de bloco de código com heading, e isso a
máquina de estados abaixo trata.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field

FRONTMATTER = re.compile(r"^---\r?\n(.*?)\r?\n---\r?\n?", re.DOTALL)
HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
FENCE = re.compile(r"^(\s*)(`{3,}|~{3,})\s*([A-Za-z0-9_+-]*)")

#: Referências que o editor Starlight gera (§35).
CONTENT_BLOCK = re.compile(r"<(ContentBlock|IncludePage)\s+[^>]*id=[\"']([^\"']+)[\"'][^>]*/?>")
MDX_IMPORT = re.compile(r"^\s*import\s.+$|^\s*export\s.+$")


def content_hash(raw: str) -> str:
    """SHA-256 do conteúdo bruto (§32)."""
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def split_frontmatter(raw: str) -> tuple[dict[str, str], str]:
    """Separa frontmatter e corpo.

    Lê pares `chave: valor` de primeiro nível, que é o que o Starlight exige
    para `title`/`description`. Estruturas aninhadas são ignoradas em vez de
    causar erro — o indexador não é um validador de schema.
    """
    match = FRONTMATTER.match(raw)
    if not match:
        return {}, raw

    data: dict[str, str] = {}
    for line in match.group(1).splitlines():
        if line.startswith((" ", "\t", "-")) or ":" not in line:
            continue
        key, _, value = line.partition(":")
        data[key.strip()] = value.strip().strip("\"'")

    return data, raw[match.end() :]


@dataclass
class Block:
    """Pedaço homogêneo do documento: prosa, código ou tabela."""

    kind: str  # "prose" | "code" | "table"
    text: str
    code_language: str | None = None


@dataclass
class Section:
    """Um heading e o conteúdo até o próximo heading de mesmo nível ou acima."""

    heading: str | None
    depth: int
    blocks: list[Block] = field(default_factory=list)

    def text(self) -> str:
        return "\n\n".join(block.text for block in self.blocks).strip()


@dataclass
class ParsedDocument:
    frontmatter: dict[str, str]
    sections: list[Section]
    #: `id`s de blocos reutilizáveis referenciados por este documento (§35).
    references: list[str]
    content_hash: str

    def title(self, fallback: str) -> str:
        return self.frontmatter.get("title") or fallback


def parse_document(raw: str) -> ParsedDocument:
    frontmatter, body = split_frontmatter(raw)
    references = [match.group(2) for match in CONTENT_BLOCK.finditer(body)]

    sections: list[Section] = []
    current = Section(heading=None, depth=0)
    buffer: list[str] = []

    fence: str | None = None
    fence_language: str | None = None
    code_lines: list[str] = []
    table_lines: list[str] = []

    def flush_prose() -> None:
        text = "\n".join(buffer).strip()
        buffer.clear()
        if text:
            current.blocks.append(Block(kind="prose", text=text))

    def flush_table() -> None:
        if table_lines:
            current.blocks.append(Block(kind="table", text="\n".join(table_lines).strip()))
            table_lines.clear()

    for line in body.splitlines():
        fence_match = FENCE.match(line)

        if fence is not None:
            # Dentro de bloco de código nada é interpretado — nem heading, nem
            # tabela. É por isso que o parser é uma máquina de estados.
            if fence_match and fence_match.group(2)[0] == fence[0] and len(fence_match.group(2)) >= len(fence):
                current.blocks.append(
                    Block(kind="code", text="\n".join(code_lines), code_language=fence_language)
                )
                code_lines.clear()
                fence = None
                fence_language = None
            else:
                code_lines.append(line)
            continue

        if fence_match:
            flush_prose()
            flush_table()
            fence = fence_match.group(2)
            fence_language = fence_match.group(3) or None
            continue

        heading_match = HEADING.match(line)
        if heading_match:
            flush_prose()
            flush_table()
            if current.heading is not None or current.blocks:
                sections.append(current)
            current = Section(heading=heading_match.group(2).strip(), depth=len(heading_match.group(1)))
            continue

        if line.lstrip().startswith("|"):
            flush_prose()
            table_lines.append(line)
            continue
        flush_table()

        # `import`/`export` de MDX é maquinário, não prosa: indexá-los faria a
        # busca casar em nomes de componentes.
        if MDX_IMPORT.match(line):
            continue

        buffer.append(line)

    flush_prose()
    flush_table()
    if fence is not None and code_lines:
        # Bloco de código não fechado: o conteúdo é preservado em vez de sumir.
        current.blocks.append(Block(kind="code", text="\n".join(code_lines), code_language=fence_language))
    if current.heading is not None or current.blocks:
        sections.append(current)

    return ParsedDocument(
        frontmatter=frontmatter,
        sections=sections,
        references=references,
        content_hash=content_hash(raw),
    )
