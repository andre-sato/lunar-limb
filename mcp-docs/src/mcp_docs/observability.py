"""Logging estruturado e redação de segredos (§42, §44).

Duas regras que valem a existência deste módulo:

1. o log é JSON de uma linha, para ser consultável sem regex frágil;
2. token e chave nunca chegam ao log — e não por convenção, mas porque o
   emissor redige o que passa por ele. Convenção falha no dia em que alguém
   loga um dicionário de configuração inteiro por engano.

O conteúdo das perguntas **não** é registrado por padrão (§44): num ambiente
corporativo isso viraria um repositório de perguntas de funcionários. Quem
quiser depurar liga `DOC_LOG_QUERIES=1` conscientemente.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import uuid
from contextlib import contextmanager
from typing import Any, Iterator

SECRET_PATTERNS = [
    re.compile(r"sk-[A-Za-z0-9_\-]{12,}"),
    re.compile(r"\bBearer\s+[A-Za-z0-9._\-]{12,}", re.IGNORECASE),
    re.compile(r"\b(?:gh[pousr]|xox[baprs])-[A-Za-z0-9_\-]{10,}"),
]

SECRET_KEYS = {"token", "api_key", "apikey", "password", "secret", "authorization"}


def redact(value: Any) -> Any:
    """Mascara segredos em qualquer estrutura que vá para o log."""
    if isinstance(value, str):
        redacted = value
        for pattern in SECRET_PATTERNS:
            redacted = pattern.sub("[redacted]", redacted)
        return redacted
    if isinstance(value, dict):
        return {
            key: "[redacted]" if key.lower() in SECRET_KEYS else redact(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact(item) for item in value]
    return value


def log_queries_enabled() -> bool:
    return os.environ.get("DOC_LOG_QUERIES", "") not in {"", "0", "false", "no"}


def new_request_id() -> str:
    return uuid.uuid4().hex[:12]


def emit(event: str, **fields: Any) -> None:
    """Escreve um evento no stderr.

    stderr e não stdout: o stdout da CLI é a resposta, e um `--json` precisa
    poder ser canalizado para o `jq` sem log no meio.
    """
    if os.environ.get("DOC_LOG", "1") in {"0", "false", "no"}:
        return

    record = {"event": event, **{key: redact(item) for key, item in fields.items()}}
    print(json.dumps(record, ensure_ascii=False, default=str), file=sys.stderr)


@contextmanager
def timed(event: str, **fields: Any) -> Iterator[dict[str, Any]]:
    """Mede a duração e registra também quando dá erro."""
    started = time.perf_counter()
    extra: dict[str, Any] = {}
    try:
        yield extra
    except Exception as error:
        emit(
            event,
            duration_ms=round((time.perf_counter() - started) * 1000, 1),
            error=type(error).__name__,
            **fields,
            **extra,
        )
        raise
    else:
        emit(
            event,
            duration_ms=round((time.perf_counter() - started) * 1000, 1),
            **fields,
            **extra,
        )


# ---------------------------------------------------------------------------
# Métricas (§43)
# ---------------------------------------------------------------------------


class Metrics:
    """Contadores em processo.

    Deliberadamente simples: expõe os nomes da §43 num dicionário que o
    `doc doctor` e os testes leem. Um exportador Prometheus entra por cima
    disto sem mudar quem incrementa.
    """

    def __init__(self) -> None:
        self._counters: dict[str, float] = {}

    def increment(self, name: str, amount: float = 1) -> None:
        self._counters[name] = self._counters.get(name, 0) + amount

    def observe(self, name: str, value: float) -> None:
        self._counters[f"{name}_last"] = value
        self._counters[f"{name}_total"] = self._counters.get(f"{name}_total", 0) + value
        self._counters[f"{name}_count"] = self._counters.get(f"{name}_count", 0) + 1

    def snapshot(self) -> dict[str, float]:
        return dict(self._counters)


METRICS = Metrics()
