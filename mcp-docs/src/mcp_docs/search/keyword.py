"""Busca lexical BM25 (§23).

Existe porque a busca semântica erra exatamente onde a documentação técnica mais
precisa acertar: nome de método, código de erro, identificador. `RATE_LIMIT_429`
não tem vizinhança semântica útil — tem uma ocorrência literal.
"""

from __future__ import annotations

import math
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass

K1 = 1.5
B = 0.75
#: Peso extra para casamento no título ou no heading, onde o assunto da seção
#: está declarado.
TITLE_BOOST = 2.2

TOKEN = re.compile(r"[a-z0-9_]+")

STOPWORDS = {
    "a", "as", "o", "os", "um", "uma", "de", "do", "da", "dos", "das", "em", "no", "na",
    "nos", "nas", "por", "para", "com", "sem", "que", "e", "ou", "se", "ao", "aos", "à",
    "the", "of", "and", "or", "to", "in", "on", "for", "with", "is", "are", "how", "what",
    "como", "qual", "quais", "onde", "quando", "porque", "meu", "minha", "eu",
}


def tokenize(text: str) -> list[str]:
    normalized = unicodedata.normalize("NFD", text.lower())
    without_accents = "".join(char for char in normalized if unicodedata.category(char) != "Mn")
    return [token for token in TOKEN.findall(without_accents) if token not in STOPWORDS]


@dataclass
class LexicalIndex:
    """Estatísticas do corpus para o BM25."""

    document_frequency: dict[str, int]
    chunk_tokens: dict[str, list[str]]
    average_length: int
    total: int

    @classmethod
    def build(cls, documents: dict[str, str], titles: dict[str, str]) -> "LexicalIndex":
        document_frequency: dict[str, int] = {}
        chunk_tokens: dict[str, list[str]] = {}
        lengths = 0

        for chunk_id, text in documents.items():
            tokens = tokenize(f"{titles.get(chunk_id, '')} {text}")
            chunk_tokens[chunk_id] = tokens
            lengths += len(tokens)
            for token in set(tokens):
                document_frequency[token] = document_frequency.get(token, 0) + 1

        total = max(len(documents), 1)
        return cls(
            document_frequency=document_frequency,
            chunk_tokens=chunk_tokens,
            average_length=max(lengths // total, 1),
            total=total,
        )

    def score(self, query: str, chunk_id: str, title_text: str) -> float:
        tokens = self.chunk_tokens.get(chunk_id)
        if not tokens:
            return 0.0

        counts = Counter(tokens)
        title_tokens = set(tokenize(title_text))
        query_tokens = tokenize(query)
        score = 0.0

        for token in query_tokens:
            frequency = counts.get(token)
            if not frequency:
                continue

            df = self.document_frequency.get(token, 1)
            idf = math.log(1 + (self.total - df + 0.5) / (df + 0.5))
            normalization = frequency + K1 * (1 - B + (B * len(tokens)) / self.average_length)
            contribution = idf * ((frequency * (K1 + 1)) / normalization)
            if token in title_tokens:
                contribution *= TITLE_BOOST
            score += contribution

        return score
