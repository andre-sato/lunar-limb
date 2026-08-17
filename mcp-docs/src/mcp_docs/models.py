"""Modelos de domínio (§20, §30).

Um único lugar define o que é um documento, um chunk e um resultado de busca.
O MCP Server, o indexador, a busca e a CLI falam esses tipos — o que impede a
divergência clássica em que cada camada inventa o seu próprio dicionário.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

ContentType = Literal["documentation", "code", "table"]


class DocumentMeta(BaseModel):
    """Metadata de um documento inteiro."""

    path: str
    title: str
    repository: str = "default"
    language: str = "pt-BR"
    #: SHA-256 do conteúdo bruto. É o que evita reprocessar o que não mudou (§32).
    content_hash: str
    updated_at: datetime
    #: `snippet` é conteúdo reutilizável do editor Starlight; não tem página própria.
    kind: Literal["page", "snippet"] = "page"
    #: URL pública, quando o portal publica a página (§28).
    url: str | None = None
    #: Caminhos que incluem este documento — preenchido para snippets (§35, §36).
    used_by: list[str] = Field(default_factory=list)


class Chunk(BaseModel):
    """Unidade pesquisável (§21)."""

    id: str
    source: str
    title: str
    section: str | None = None
    content: str
    content_type: ContentType = "documentation"
    language: str = "pt-BR"
    repository: str = "default"
    updated_at: datetime
    kind: Literal["page", "snippet"] = "page"
    url: str | None = None
    used_by: list[str] = Field(default_factory=list)
    #: Linguagem do bloco quando `content_type == "code"` (§22).
    code_language: str | None = None
    #: Vetor do chunk. Ausente quando não há serviço de embeddings configurado.
    embedding: list[float] | None = None

    def citation(self) -> str:
        """Fonte citável: caminho e âncora da seção (§28)."""
        if self.section:
            return f"{self.source}#{slugify(self.section)}"
        return self.source


class SearchResult(BaseModel):
    title: str
    path: str
    section: str | None = None
    content: str
    score: float
    url: str | None = None
    repository: str = "default"
    kind: Literal["page", "snippet"] = "page"
    used_by: list[str] = Field(default_factory=list)
    #: De onde veio o resultado, útil para depurar o retrieval (§10.2).
    matched_by: Literal["keyword", "vector", "hybrid"] = "keyword"


class Reference(BaseModel):
    path: str
    type: Literal["includes", "included_by", "related"]


class Answer(BaseModel):
    answer: str
    sources: list[str]
    #: `True` quando não houve LLM e a resposta é composta dos próprios trechos.
    retrieval_only: bool = False
    #: `True` quando o retrieval não trouxe evidência suficiente (§27).
    insufficient_context: bool = False
    related: list[str] = Field(default_factory=list)


def slugify(text: str) -> str:
    """Âncora no mesmo formato que o Starlight gera para os headings."""
    import re
    import unicodedata

    normalized = unicodedata.normalize("NFD", text.lower())
    without_accents = "".join(char for char in normalized if unicodedata.category(char) != "Mn")
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", without_accents))
