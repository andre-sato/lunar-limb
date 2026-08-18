"""Proveniência declarada, para o MCP (§12 da spec de Trust & Provenance).

Um agente que consome documentação por MCP não tem como julgar se o que recebeu
ainda vale. Devolver o estado de verificação junto do conteúdo é o que permite a
ele preferir a página verificada e avisar quando usou uma vencida.

**O limite desta leitura, dito de frente.** O portal (TypeScript) resolve as
evidências de verdade: abre a especificação OpenAPI e confere o ponteiro, olha o
arquivo de código e confere a linha, checa se o id de teste existe. Este módulo
**não** faz nada disso — ele lê o que a página declara e confere a data contra o
prazo de validade. Por isso ele nunca devolve ``invalid``: dizer que uma evidência
não confere exige tê-la conferido, e reimplementar essa conferência em Python
criaria uma segunda verdade que divergiria da primeira na primeira mudança.

O que ele devolve é honesto sobre isso: ``checked: "declaracao"``.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime, timezone

#: Prazo padrão, igual ao do portal (`trust.yml`).
DEFAULT_FRESHNESS_DAYS = 180

_FRONTMATTER = re.compile(r"^---\r?\n(.*?)\r?\n---", re.DOTALL)
# `.md` usa `<!-- -->`; `.mdx` usa `{/* */}`, porque MDX tenta ler comentário
# HTML como JSX e falha no build. As duas formas valem.
_ANNOTATION = re.compile(r"(?:<!--|\{\s*/\*)\s*provenance:\s*(.*?)(?:-->|\*/\s*\})", re.DOTALL)
_ENTRY = re.compile(r"^-?\s*([A-Za-z]+)\s*:\s*(.*)$")


@dataclass
class Evidence:
    source: str
    source_type: str
    verified_at: str | None = None
    verified_by: str | None = None
    owner: str | None = None


@dataclass
class DeclaredTrust:
    """O que a página declara sobre a própria proveniência."""

    status: str = "unverified"
    verified_at: str | None = None
    owner: str | None = None
    evidence: list[Evidence] = field(default_factory=list)

    def as_dict(self) -> dict[str, object]:
        return {
            "status": self.status,
            "verified_at": self.verified_at,
            "owner": self.owner,
            "sources": [item.source for item in self.evidence],
            # O agente precisa saber **como** este estado foi apurado para não
            # tratá-lo como se a evidência tivesse sido conferida.
            "checked": "declaracao",
        }


def infer_source_type(source: str) -> str:
    """Mesma inferência do portal, pela forma da referência."""
    explicit = re.match(r"^(code|openapi|asyncapi|test|manual|generated):", source, re.IGNORECASE)
    if explicit:
        return explicit.group(1).lower()

    if re.search(r"asyncapi[^#]*#", source, re.IGNORECASE):
        return "asyncapi"
    if re.search(r"\.(ya?ml|json)#", source):
        return "openapi"
    if re.fullmatch(r"[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+", source.strip()):
        return "test"
    if re.search(r"\.(ts|tsx|js|jsx|py|astro|mjs|cjs)(?::\d+)?$", source):
        return "code"

    return "manual"


def _strip_prefix(source: str) -> str:
    return re.sub(r"^(code|openapi|asyncapi|test|manual|generated):\s*", "", source, flags=re.IGNORECASE).strip()


def _parse_entries(block: str) -> list[Evidence]:
    entries: list[Evidence] = []
    current: dict[str, str] = {}

    def flush() -> None:
        if current.get("source"):
            source = _strip_prefix(current["source"])
            entries.append(
                Evidence(
                    source=source,
                    source_type=current.get("sourcetype") or infer_source_type(current["source"]),
                    verified_at=current.get("verifiedat"),
                    verified_by=current.get("verifiedby"),
                    owner=current.get("owner"),
                )
            )
        current.clear()

    for line in block.splitlines():
        match = _ENTRY.match(line.strip())
        if not match:
            continue

        key = match.group(1).lower()
        value = match.group(2).strip()

        # Cada `source` começa uma evidência nova.
        if key == "source":
            flush()
            current["source"] = value
        elif current:
            current[key] = value

    flush()
    return entries


def _frontmatter_section(raw: str, key: str) -> str:
    match = _FRONTMATTER.match(raw)
    if not match:
        return ""

    lines = match.group(1).splitlines()
    try:
        start = next(index for index, line in enumerate(lines) if re.fullmatch(rf"{key}:\s*", line))
    except StopIteration:
        return ""

    collected: list[str] = []
    for line in lines[start + 1 :]:
        if not line.strip():
            continue
        if not line[:1].isspace():
            break
        collected.append(line)

    return "\n".join(collected)


def _page_owner(raw: str) -> str | None:
    match = _FRONTMATTER.match(raw)
    if not match:
        return None
    owner = re.search(r"^owner:\s*(.+)$", match.group(1), re.MULTILINE)
    return owner.group(1).strip() if owner else None


def _age_days(iso: str, today: date) -> int | None:
    try:
        parsed = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return None
    parsed_date = parsed.date() if parsed.tzinfo is None else parsed.astimezone(timezone.utc).date()
    return (today - parsed_date).days


_FENCE = re.compile(r"^\s*(`{3,}|~{3,})")


def _blank_code_fences(raw: str) -> str:
    """Esvazia blocos de código, preservando as linhas.

    Anotação dentro de bloco de código é **exemplo**, não declaração: a página
    que ensina a sintaxe mostra a anotação de propósito. Sem isso, o guia de
    proveniência do portal era lido como se declarasse as próprias evidências de
    exemplo — o caso apareceu rodando o coletor de saúde contra o repositório.
    """
    lines: list[str] = []
    fence: str | None = None

    for line in raw.split("\n"):
        marker = _FENCE.match(line)

        if fence is not None:
            if marker and marker.group(1)[0] == fence[0] and len(marker.group(1)) >= len(fence):
                fence = None
            lines.append("")
            continue

        if marker:
            fence = marker.group(1)
            lines.append("")
            continue

        lines.append(line)

    return "\n".join(lines)


def read_trust(raw: str, *, freshness_days: int = DEFAULT_FRESHNESS_DAYS, today: date | None = None) -> DeclaredTrust:
    """Lê a proveniência declarada num arquivo de conteúdo."""
    reference = today or datetime.now(timezone.utc).date()

    evidence = _parse_entries(_frontmatter_section(raw, "provenance"))
    for match in _ANNOTATION.finditer(_blank_code_fences(raw)):
        evidence.extend(_parse_entries(match.group(1)))

    owner = _page_owner(raw) or next((item.owner for item in evidence if item.owner), None)

    if not evidence:
        return DeclaredTrust(status="unverified", owner=owner)

    dates = sorted(item.verified_at for item in evidence if item.verified_at)
    if not dates:
        # Evidência declarada e nunca confirmada: ninguém assinou embaixo.
        return DeclaredTrust(status="unverified", owner=owner, evidence=evidence)

    latest = dates[-1]
    age = _age_days(latest, reference)

    if age is None:
        status = "unverified"
    elif age > freshness_days:
        status = "stale"
    else:
        status = "verified"

    return DeclaredTrust(status=status, verified_at=latest, owner=owner, evidence=evidence)
