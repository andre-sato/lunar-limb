"""Coleta dos arquivos de documentação (§19, §33, §34).

O Git continua sendo a fonte de verdade: o loader lê o diretório de trabalho,
não um banco. Um webhook de commit, no futuro, só precisa disparar o mesmo
`update` que a pessoa roda à mão.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

EXTENSIONS = {".md", ".mdx"}
#: Idiomas com pasta própria no portal Starlight.
TRANSLATED_LOCALES = ("en", "es")
DEFAULT_LOCALE = "pt-BR"


@dataclass
class LoadedFile:
    #: Caminho relativo à raiz, sempre com `/` — é a identidade do documento.
    path: str
    absolute: Path
    raw: str
    updated_at: datetime
    kind: str  # "page" | "snippet"


def _walk(root: Path) -> list[Path]:
    if not root.is_dir():
        return []
    return sorted(
        entry
        for entry in root.rglob("*")
        if entry.is_file() and entry.suffix.lower() in EXTENSIONS
    )


def load_files(roots: list[Path], kind: str) -> list[LoadedFile]:
    files: list[LoadedFile] = []

    for root in roots:
        for absolute in _walk(root):
            try:
                raw = absolute.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                # Um arquivo ilegível não deve derrubar a indexação inteira.
                continue

            relative = absolute.relative_to(root).as_posix()
            stat = absolute.stat()
            files.append(
                LoadedFile(
                    path=relative,
                    absolute=absolute,
                    raw=raw,
                    updated_at=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc),
                    kind=kind,
                )
            )

    return files


def locale_of(path: str) -> str:
    first = path.split("/")[0]
    return first if first in TRANSLATED_LOCALES else DEFAULT_LOCALE


def public_url(path: str) -> str:
    """URL pública da página no portal (§28)."""
    without_extension = path.rsplit(".", 1)[0]
    slug = without_extension
    if slug == "index":
        slug = ""
    elif slug.endswith("/index"):
        slug = slug[: -len("/index")]
    return f"/{slug}/".replace("//", "/")


def snippet_id(path: str) -> str:
    """`id` do bloco reutilizável, no mesmo formato usado pelo editor."""
    return path.rsplit(".", 1)[0]
