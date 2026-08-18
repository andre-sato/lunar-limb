"""Índice de documentos e busca híbrida (§23, §24, §52).

`DocumentIndex` é a interface que a spec pede: o MCP Server fala com ela, não
com o armazenamento. `JsonDocumentIndex` é a implementação local — um arquivo
JSON, suficiente para a escala de um portal de documentação e sem serviço
externo para subir. Trocá-la por Qdrant ou pgvector é implementar a mesma
interface.

A fusão dos dois rankings é feita por score normalizado, não por posição: cada
lado é dividido pelo seu próprio melhor resultado, o que os põe na mesma escala
0–1 sem depender do valor absoluto do BM25 (que não tem escala) nem do cosseno.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Protocol

from ..models import Chunk, DocumentMeta, SearchResult
from .keyword import LexicalIndex
from .vector import EmbeddingProvider, NullEmbeddingProvider, cosine_similarity


class DocumentIndex(Protocol):
    """Interface de armazenamento (§52)."""

    def add(self, documents: Iterable[Chunk]) -> None: ...

    def search(self, query: str, limit: int = 5, **filters: object) -> list[SearchResult]: ...

    def delete(self, document_id: str) -> None: ...

    def rebuild(self) -> None: ...


@dataclass
class SearchFilters:
    """Filtros de metadata (§23)."""

    source: str | None = None
    repository: str | None = None
    language: str | None = None
    content_type: str | None = None
    #: Contexto de leitura (Adaptive Documentation §11).
    audience: str | None = None
    version: str | None = None

    def matches(self, chunk: Chunk) -> bool:
        if self.source and not chunk.source.startswith(self.source):
            return False
        if self.repository and chunk.repository != self.repository:
            return False
        if self.language and chunk.language != self.language:
            return False
        if self.content_type and chunk.content_type != self.content_type:
            return False
        # Audiência **não exclui** conteúdo sem audiência declarada: a maior parte
        # do portal não declara nada, e tratar isso como "não é para você"
        # esconderia quase tudo de quem informou o perfil. O filtro só descarta o
        # que foi explicitamente escrito para outro público.
        if self.audience and chunk.audiences and self.audience not in chunk.audiences:
            return False
        if self.version and chunk.version and chunk.version != self.version:
            return False
        return True


class JsonDocumentIndex:
    """Índice persistido em JSON."""

    #: Muda quando o formato do arquivo muda, para um índice antigo ser
    #: detectado em vez de lido errado (§42: versão do índice no log).
    FORMAT_VERSION = 1

    def __init__(self, path: Path, embeddings: EmbeddingProvider | None = None) -> None:
        self.path = path
        self.embeddings = embeddings or NullEmbeddingProvider()
        self.chunks: list[Chunk] = []
        self.documents: dict[str, DocumentMeta] = {}
        self._lexical: LexicalIndex | None = None

    # -- persistência --------------------------------------------------------

    def load(self) -> "JsonDocumentIndex":
        if not self.path.is_file():
            return self

        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise IndexUnavailable(f"Índice ilegível em {self.path}: {error}") from error

        version = payload.get("format_version")
        if version != self.FORMAT_VERSION:
            raise IndexUnavailable(
                f"Índice em formato {version!r}, esperado {self.FORMAT_VERSION}. "
                "Rode `doc-index rebuild`."
            )

        self.chunks = [Chunk.model_validate(item) for item in payload.get("chunks", [])]
        self.documents = {
            key: DocumentMeta.model_validate(value)
            for key, value in payload.get("documents", {}).items()
        }
        self._lexical = None
        return self

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "format_version": self.FORMAT_VERSION,
            "documents": {key: value.model_dump(mode="json") for key, value in self.documents.items()},
            "chunks": [chunk.model_dump(mode="json") for chunk in self.chunks],
        }

        # Escrita atômica: um Ctrl+C no meio do dump não deve deixar um índice
        # truncado que falha na próxima leitura.
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        temporary.replace(self.path)

    # -- DocumentIndex -------------------------------------------------------

    def add(self, documents: Iterable[Chunk]) -> None:
        for chunk in documents:
            self.chunks.append(chunk)
        self._lexical = None

    def delete(self, document_id: str) -> None:
        """Remove todos os chunks de um documento."""
        self.chunks = [chunk for chunk in self.chunks if chunk.source != document_id]
        self.documents.pop(document_id, None)
        self._lexical = None

    def rebuild(self) -> None:
        self.chunks = []
        self.documents = {}
        self._lexical = None

    def search(self, query: str, limit: int = 5, **filters: object) -> list[SearchResult]:
        active = SearchFilters(
            source=_as_optional_str(filters.get("source")),
            repository=_as_optional_str(filters.get("repository")),
            language=_as_optional_str(filters.get("language")),
            content_type=_as_optional_str(filters.get("content_type")),
            audience=_as_optional_str(filters.get("audience")),
            version=_as_optional_str(filters.get("version")),
        )
        keyword_weight = float(filters.get("keyword_weight", 0.5) or 0.5)
        min_score = float(filters.get("min_score", 0.0) or 0.0)

        candidates = [chunk for chunk in self.chunks if active.matches(chunk)]
        if not candidates or not query.strip():
            return []

        lexical_scores = self._keyword_scores(query, candidates)
        vector_scores = self._vector_scores(query, candidates)

        fused: list[tuple[Chunk, float, str]] = []
        for chunk in candidates:
            lexical = lexical_scores.get(chunk.id, 0.0)
            vector = vector_scores.get(chunk.id, 0.0)

            if vector_scores:
                score = keyword_weight * lexical + (1 - keyword_weight) * vector
                if lexical > 0 and vector > 0:
                    matched_by = "hybrid"
                else:
                    matched_by = "keyword" if lexical > 0 else "vector"
            else:
                score = lexical
                matched_by = "keyword"

            if score > 0:
                fused.append((chunk, score, matched_by))

        fused.sort(key=lambda item: item[1], reverse=True)
        return [
            SearchResult(
                title=chunk.title,
                path=chunk.source,
                section=chunk.section,
                content=chunk.content,
                score=round(score, 4),
                url=chunk.url,
                repository=chunk.repository,
                kind=chunk.kind,
                used_by=chunk.used_by,
                matched_by=matched_by,  # type: ignore[arg-type]
            )
            for chunk, score, matched_by in fused
            if score >= min_score
        ][:limit]

    # -- internos ------------------------------------------------------------

    def _keyword_scores(self, query: str, candidates: list[Chunk]) -> dict[str, float]:
        lexical = self._lexical_index()
        raw = {
            chunk.id: lexical.score(query, chunk.id, f"{chunk.title} {chunk.section or ''}")
            for chunk in candidates
        }
        return _normalize(raw)

    def _vector_scores(self, query: str, candidates: list[Chunk]) -> dict[str, float]:
        embedded = [chunk for chunk in candidates if chunk.embedding]
        if not embedded or not self.embeddings.is_available():
            return {}

        try:
            query_vector = self.embeddings.embed([query])[0]
        except Exception:
            # Serviço de embeddings fora do ar não deve derrubar a busca: o
            # lexical continua respondendo.
            return {}

        raw = {
            chunk.id: max(cosine_similarity(query_vector, chunk.embedding or []), 0.0)
            for chunk in embedded
        }
        return _normalize(raw)

    def _lexical_index(self) -> LexicalIndex:
        if self._lexical is None:
            self._lexical = LexicalIndex.build(
                documents={chunk.id: chunk.content for chunk in self.chunks},
                titles={chunk.id: f"{chunk.title} {chunk.section or ''}" for chunk in self.chunks},
            )
        return self._lexical

    # -- consultas usadas pelas tools ---------------------------------------

    def get_document(self, path: str) -> tuple[DocumentMeta, str] | None:
        meta = self.documents.get(path)
        if meta is None:
            return None
        parts = [chunk.content for chunk in self.chunks if chunk.source == path]
        return meta, "\n\n".join(parts)

    def list_documents(self, prefix: str = "") -> list[str]:
        return sorted(path for path in self.documents if path.startswith(prefix))

    def references_for(self, path: str) -> list[tuple[str, str]]:
        """Referências de um documento (§16 da spec de tools, §36).

        Três direções: o que este documento inclui, quem o inclui, e páginas
        que compartilham um mesmo bloco reutilizável — que é o "related" com
        significado real, em vez de similaridade estatística.
        """
        meta = self.documents.get(path)
        if meta is None:
            return []

        references: list[tuple[str, str]] = []

        for other_path, other in self.documents.items():
            if other.kind == "snippet" and path in other.used_by:
                references.append((other_path, "includes"))

        if meta.kind == "snippet":
            for consumer in meta.used_by:
                references.append((consumer, "included_by"))

        shared: set[str] = set()
        for other in self.documents.values():
            if other.kind == "snippet" and path in other.used_by:
                shared.update(consumer for consumer in other.used_by if consumer != path)
        references.extend((consumer, "related") for consumer in sorted(shared))

        return references


class IndexUnavailable(Exception):
    """Índice ausente, corrompido ou em formato antigo (§45)."""


def _normalize(scores: dict[str, float]) -> dict[str, float]:
    """Normaliza pelo melhor resultado da própria consulta."""
    best = max(scores.values(), default=0.0)
    if best <= 0:
        return {}
    return {key: value / best for key, value in scores.items() if value > 0}


def _as_optional_str(value: object) -> str | None:
    return value if isinstance(value, str) and value else None
