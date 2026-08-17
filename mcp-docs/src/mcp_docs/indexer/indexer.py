"""Pipeline de indexação (§19, §31, §32, §35, §36).

Duas coisas merecem destaque:

**Indexação incremental por hash.** Cada documento guarda o SHA-256 do conteúdo
bruto. Um `update` só reprocessa o que mudou — e reprocessa também os
*consumidores* de um bloco reutilizável alterado, porque o conteúdo deles mudou
mesmo que o arquivo não tenha sido tocado. Sem isso, editar um aviso reutilizado
em cinco páginas deixaria as cinco com o texto antigo no índice.

**Grafo de origem.** Um bloco reutilizável não tem página própria. O indexador
registra quem o consome, e é isso que permite responder "quais páginas usam o
aviso de autenticação?" e citar uma página real como fonte, em vez de um arquivo
que ninguém pode abrir.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from ..models import Chunk, DocumentMeta
from ..observability import METRICS, emit
from ..search.hybrid import JsonDocumentIndex
from ..search.vector import EmbeddingProvider, NullEmbeddingProvider
from .chunker import chunk_document
from .loader import LoadedFile, load_files, locale_of, public_url, snippet_id
from .parser import ParsedDocument, parse_document

#: Quantos textos vão por requisição ao serviço de embeddings.
EMBEDDING_BATCH = 64


@dataclass
class IndexReport:
    indexed: int = 0
    updated: int = 0
    unchanged: int = 0
    removed: int = 0
    chunks: int = 0
    embedded: int = 0
    errors: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, object]:
        return {
            "documents_indexed": self.indexed,
            "documents_updated": self.updated,
            "documents_unchanged": self.unchanged,
            "documents_removed": self.removed,
            "chunks": self.chunks,
            "embedded": self.embedded,
            "errors": self.errors,
        }


@dataclass
class _Prepared:
    file: LoadedFile
    parsed: ParsedDocument
    title: str


class Indexer:
    def __init__(
        self,
        *,
        index: JsonDocumentIndex,
        docs_roots: list[Path],
        snippets_roots: list[Path],
        repository: str = "default",
        embeddings: EmbeddingProvider | None = None,
    ) -> None:
        self.index = index
        self.docs_roots = docs_roots
        self.snippets_roots = snippets_roots
        self.repository = repository
        self.embeddings = embeddings or NullEmbeddingProvider()

    # -- entrada pública -----------------------------------------------------

    def rebuild(self) -> IndexReport:
        self.index.rebuild()
        return self._run(incremental=False)

    def update(self) -> IndexReport:
        return self._run(incremental=True)

    # -- pipeline ------------------------------------------------------------

    def _run(self, *, incremental: bool) -> IndexReport:
        report = IndexReport()

        pages = load_files(self.docs_roots, kind="page")
        snippets = load_files(self.snippets_roots, kind="snippet")

        prepared: list[_Prepared] = []
        for file in pages + snippets:
            try:
                parsed = parse_document(file.raw)
            except Exception as error:  # parser robusto, mas nunca fatal
                report.errors.append(f"{file.path}: {error}")
                continue
            fallback = file.path.rsplit(".", 1)[0]
            prepared.append(_Prepared(file=file, parsed=parsed, title=parsed.title(fallback)))

        # Grafo: qual página consome qual bloco reutilizável (§35).
        consumers = self._build_consumer_map(prepared)

        present = {item.file.path for item in prepared}
        for existing in list(self.index.documents):
            if existing not in present:
                self.index.delete(existing)
                report.removed += 1

        # Um bloco alterado invalida quem o consome, mesmo com hash igual.
        changed_snippets = {
            item.file.path
            for item in prepared
            if item.file.kind == "snippet" and self._changed(item)
        }
        invalidated = {
            consumer
            for path in changed_snippets
            for consumer in consumers.get(snippet_id(path), [])
        }

        to_process: list[_Prepared] = []
        for item in prepared:
            if not incremental:
                to_process.append(item)
                continue
            if self._changed(item) or item.file.path in invalidated:
                to_process.append(item)
            else:
                report.unchanged += 1

        for item in to_process:
            existed = item.file.path in self.index.documents
            self.index.delete(item.file.path)
            chunks = self._index_one(item, consumers)
            report.chunks += len(chunks)
            if existed:
                report.updated += 1
            else:
                report.indexed += 1

        report.embedded = self._embed_missing()
        self.index.save()

        METRICS.increment("documents_indexed", report.indexed)
        METRICS.increment("documents_updated", report.updated)
        emit("index_completed", incremental=incremental, **report.as_dict())

        return report

    def _changed(self, item: _Prepared) -> bool:
        existing = self.index.documents.get(item.file.path)
        return existing is None or existing.content_hash != item.parsed.content_hash

    def _build_consumer_map(self, prepared: list[_Prepared]) -> dict[str, list[str]]:
        """`id` do bloco reutilizável → páginas que o incluem."""
        consumers: dict[str, list[str]] = {}
        for item in prepared:
            if item.file.kind != "page":
                continue
            for reference in item.parsed.references:
                consumers.setdefault(reference, []).append(item.file.path)
        return {key: sorted(set(value)) for key, value in consumers.items()}

    def _index_one(self, item: _Prepared, consumers: dict[str, list[str]]) -> list[Chunk]:
        file = item.file
        language = locale_of(file.path) if file.kind == "page" else "pt-BR"
        used_by = consumers.get(snippet_id(file.path), []) if file.kind == "snippet" else []
        url = public_url(file.path) if file.kind == "page" else None

        chunks = chunk_document(
            path=file.path,
            parsed=item.parsed,
            title=item.title,
            updated_at=file.updated_at,
            repository=self.repository,
            language=language,
            kind=file.kind,
            url=url,
            used_by=used_by,
        )

        self.index.documents[file.path] = DocumentMeta(
            path=file.path,
            title=item.title,
            repository=self.repository,
            language=language,
            content_hash=item.parsed.content_hash,
            updated_at=file.updated_at,
            kind=file.kind,  # type: ignore[arg-type]
            url=url,
            used_by=used_by,
        )
        self.index.add(chunks)
        return chunks

    def _embed_missing(self) -> int:
        """Gera embeddings para os chunks que ainda não têm.

        Falha do serviço não invalida a indexação: o índice fica utilizável em
        modo lexical, e a próxima execução tenta de novo.
        """
        if not self.embeddings.is_available():
            return 0

        pending = [chunk for chunk in self.index.chunks if chunk.embedding is None]
        if not pending:
            return 0

        embedded = 0
        for start in range(0, len(pending), EMBEDDING_BATCH):
            batch = pending[start : start + EMBEDDING_BATCH]
            try:
                vectors = self.embeddings.embed([chunk.content for chunk in batch])
            except Exception as error:
                emit("embedding_failed", error=type(error).__name__, pending=len(pending) - embedded)
                break

            for chunk, vector in zip(batch, vectors):
                chunk.embedding = vector
                embedded += 1

        return embedded


def now() -> datetime:
    return datetime.now(tz=timezone.utc)
