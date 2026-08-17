"""Busca vetorial (§23, §52).

O provedor de embeddings é um endpoint compatível com a API da OpenAI — o
`base_url` é configurável, então um serviço local que fale o mesmo protocolo
serve sem alteração de código.

Sem chave configurada, `NullEmbeddingProvider` responde "não disponível" e a
busca híbrida opera só no lexical. Isso é degradação, não falha: BM25 sozinho
já responde bem à maior parte das perguntas de documentação técnica, e a
alternativa — exigir uma chave para o `doc search` funcionar — deixaria a
ferramenta inútil para quem só quer consultar o próprio repositório.
"""

from __future__ import annotations

import math
from typing import Protocol

import httpx


class EmbeddingProvider(Protocol):
    def is_available(self) -> bool: ...

    def embed(self, texts: list[str]) -> list[list[float]]: ...


class NullEmbeddingProvider:
    """Sem serviço de embeddings configurado."""

    def is_available(self) -> bool:
        return False

    def embed(self, texts: list[str]) -> list[list[float]]:
        raise RuntimeError("Nenhum serviço de embeddings configurado.")


class OpenAICompatibleEmbeddingProvider:
    def __init__(self, *, api_key: str, base_url: str, model: str, timeout: float = 30.0) -> None:
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._model = model
        self._timeout = timeout

    def is_available(self) -> bool:
        return self._api_key != ""

    def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        if not self.is_available():
            raise RuntimeError("Nenhum serviço de embeddings configurado.")

        response = httpx.post(
            f"{self._base_url}/embeddings",
            headers={"authorization": f"Bearer {self._api_key}"},
            json={"model": self._model, "input": texts},
            timeout=self._timeout,
        )
        response.raise_for_status()
        payload = response.json()

        # Ordenar por `index` em vez de confiar na ordem do array: a API
        # documenta o campo justamente porque a ordem não é garantida.
        items = sorted(payload["data"], key=lambda item: item.get("index", 0))
        return [item["embedding"] for item in items]


def cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0

    dot = sum(a * b for a, b in zip(left, right))
    left_norm = math.sqrt(sum(a * a for a in left))
    right_norm = math.sqrt(sum(b * b for b in right))
    if left_norm == 0 or right_norm == 0:
        return 0.0

    # Cosseno pode dar levemente acima de 1 por erro de ponto flutuante; o
    # recorte evita um score > 1 vazando para a normalização adiante.
    return max(-1.0, min(1.0, dot / (left_norm * right_norm)))


def build_provider(config) -> EmbeddingProvider:  # noqa: ANN001 - evita import circular
    if not config.has_embeddings():
        return NullEmbeddingProvider()
    return OpenAICompatibleEmbeddingProvider(
        api_key=config.embedding_api_key,
        base_url=config.embedding.base_url,
        model=config.embedding.model,
    )
