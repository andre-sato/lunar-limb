"""Schemas de entrada das MCP tools (§13–§16, §48.3).

Pydantic aqui não é decoração: é a fronteira de validação. Todo argumento vindo
de um cliente MCP passa por um destes modelos antes de tocar o índice ou o
sistema de arquivos.

O caso que exige atenção é `path`. Ele vem de fora e é usado para procurar um
documento; se fosse concatenado a um diretório sem validação, `../../etc/passwd`
sairia do repositório. `safe_relative_path` recusa caminho absoluto, `..` e
barra invertida — e o servidor só entrega documentos que estejam no índice, o
que é uma segunda barreira independente da primeira.
"""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

MAX_QUERY_CHARS = 1000
MAX_LIMIT = 20


def safe_relative_path(value: str) -> str:
    candidate = value.strip().replace("\\", "/")

    if candidate == "":
        raise ValueError("caminho vazio")
    if candidate.startswith("/") or (len(candidate) > 1 and candidate[1] == ":"):
        raise ValueError("caminho absoluto não é aceito")
    if any(part in {"..", "~"} for part in candidate.split("/")):
        raise ValueError("caminho não pode subir de diretório")
    if "\x00" in candidate:
        raise ValueError("caminho inválido")

    return candidate


class SearchDocsInput(BaseModel):
    query: str = Field(min_length=1, max_length=MAX_QUERY_CHARS)
    limit: int = Field(default=5, ge=1, le=MAX_LIMIT)
    #: Prefixo de caminho: `api` restringe a busca a `api…`.
    source: str | None = None
    repository: str | None = None
    language: str | None = None
    content_type: str | None = None
    #: Contexto do agente (Adaptive Documentation §11). Ambos opcionais: sem eles
    #: a busca é a de sempre, que é o fallback pedido pela §14.
    audience: str | None = None
    version: str | None = None

    @field_validator("audience")
    @classmethod
    def _validate_audience(cls, value: str | None) -> str | None:
        if value in (None, ""):
            return None
        if value not in ("developer", "support", "product", "operations", "ai-agent"):
            # Recusar em vez de ignorar: um valor errado que passa calado vira um
            # filtro que nunca casa, e o agente conclui que não há documentação.
            raise ValueError("audience desconhecida")
        return value

    @field_validator("version")
    @classmethod
    def _validate_version(cls, value: str | None) -> str | None:
        if value in (None, ""):
            return None
        assert value is not None
        if len(value) > 40 or not all(char.isalnum() or char in "._-" for char in value):
            raise ValueError("version inválida")
        return value

    @field_validator("source")
    @classmethod
    def _validate_source(cls, value: str | None) -> str | None:
        if value is None or value == "":
            return None
        return safe_relative_path(value)

    @field_validator("content_type")
    @classmethod
    def _validate_content_type(cls, value: str | None) -> str | None:
        if value in (None, "", "documentation", "code", "table"):
            return value or None
        raise ValueError("content_type deve ser documentation, code ou table")


class GetDocumentInput(BaseModel):
    path: str

    @field_validator("path")
    @classmethod
    def _validate_path(cls, value: str) -> str:
        return safe_relative_path(value)


class ListDocumentsInput(BaseModel):
    prefix: str = ""

    @field_validator("prefix")
    @classmethod
    def _validate_prefix(cls, value: str) -> str:
        if value in ("", "/"):
            return ""
        return safe_relative_path(value)


class FindReferencesInput(BaseModel):
    path: str

    @field_validator("path")
    @classmethod
    def _validate_path(cls, value: str) -> str:
        return safe_relative_path(value)
