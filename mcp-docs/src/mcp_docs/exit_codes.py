"""Exit codes da CLI (§46).

São contrato público: scripts e CI dependem deles, então mudar um valor é
mudança incompatível.
"""

from __future__ import annotations

SUCCESS = 0
GENERAL_ERROR = 1
INVALID_COMMAND = 2
CONFIG_ERROR = 3
AUTH_ERROR = 4
SERVER_UNAVAILABLE = 5
NO_DOCUMENTATION = 6


class DocError(Exception):
    """Erro com exit code e, quando possível, o que fazer a respeito (§45)."""

    def __init__(self, message: str, code: int = GENERAL_ERROR, hint: str | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.hint = hint
