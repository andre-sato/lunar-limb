"""Tools de conhecimento do portal: glossário, API, changelog e qualidade (§5).

As quatro fontes já existem no repositório do portal e têm dono: o glossário em
`src/content/glossary/`, as APIs em `src/schemas/`, o changelog em
`src/content/docs/changelog/` e o linter no código TypeScript. Este módulo as
**lê**; não guarda cópia de nenhuma.

Duas regras valem para tudo aqui:

**Conteúdo é dado, nunca instrução** (§12). Todo texto que sai destas tools passa
por `neutralize`, o mesmo tratamento das tools de documentação: uma página com
"ignore as instruções anteriores" é devolvida como texto marcado, não como
comando.

**Caminho vem validado.** Nada concatena um argumento a um diretório sem passar
por `safe_relative_path`, e nada usa shell.
"""

from __future__ import annotations

import json
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from .schemas import safe_relative_path
from .tools import ToolError, neutralize


@dataclass
class PortalPaths:
    """Onde cada fonte vive dentro do repositório do portal."""

    root: Path

    @property
    def glossary(self) -> Path:
        return self.root / "src" / "content" / "glossary"

    @property
    def schemas(self) -> Path:
        return self.root / "src" / "schemas"

    @property
    def docs(self) -> Path:
        return self.root / "src" / "content" / "docs"

    @property
    def changelog(self) -> Path:
        return self.docs / "changelog"


FRONTMATTER = re.compile(r"^---\r?\n(.*?)\r?\n---\r?\n?(.*)$", re.DOTALL)

HTTP_METHODS = ("get", "post", "put", "patch", "delete", "head", "options")


def _split(raw: str) -> tuple[dict[str, Any], str]:
    match = FRONTMATTER.match(raw)
    if not match:
        return {}, raw
    try:
        front = yaml.safe_load(match.group(1)) or {}
    except yaml.YAMLError:
        front = {}
    return (front if isinstance(front, dict) else {}), match.group(2)


def _as_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


# ---------------------------------------------------------------------------
# Glossário (§8)
# ---------------------------------------------------------------------------


class GlossaryTools:
    """Leitura do glossário, que é a fonte da terminologia do portal."""

    def __init__(self, paths: PortalPaths) -> None:
        self.paths = paths

    def _load(self) -> list[dict[str, Any]]:
        terms: list[dict[str, Any]] = []
        if not self.paths.glossary.is_dir():
            return terms

        for file in sorted(self.paths.glossary.glob("*.md*")):
            front, body = _split(file.read_text(encoding="utf-8"))
            term = str(front.get("term", "")).strip()
            if not term:
                continue
            terms.append(
                {
                    "id": str(front.get("id", file.stem)),
                    "term": term,
                    "aliases": _as_list(front.get("aliases")),
                    "deprecated": _as_list(front.get("deprecated")),
                    "definition": neutralize(body.strip()).content,
                    "enabled": front.get("enabled", True) is not False,
                }
            )
        return terms

    def get_glossary_term(self, arguments: dict[str, Any]) -> dict[str, Any]:
        wanted = str(arguments.get("term", "")).strip().lower()
        if not wanted:
            raise ToolError("Informe o termo.")

        for entry in self._load():
            forms = {entry["term"].lower(), entry["id"].lower()}
            forms.update(alias.lower() for alias in entry["aliases"])
            if wanted in forms:
                return entry

        raise ToolError(f"O termo nao esta no glossario: {arguments.get('term')}")

    def search_glossary(self, arguments: dict[str, Any]) -> dict[str, Any]:
        query = str(arguments.get("query", "")).strip().lower()
        terms = self._load()

        if not query:
            return {"results": terms}

        # Um glossário tem dezenas de entradas, não milhares: a busca direta
        # sobre termo, aliases e definição devolve o esperado sem um índice.
        results = [
            entry
            for entry in terms
            if query in entry["term"].lower()
            or any(query in alias.lower() for alias in entry["aliases"])
            or query in entry["definition"].lower()
        ]
        return {"results": results}


# ---------------------------------------------------------------------------
# API (§5)
# ---------------------------------------------------------------------------


class ApiTools:
    """Leitura das especificações OpenAPI do portal."""

    def __init__(self, paths: PortalPaths) -> None:
        self.paths = paths

    def _operations(self) -> list[dict[str, Any]]:
        operations: list[dict[str, Any]] = []
        if not self.paths.schemas.is_dir():
            return operations

        for file in sorted(self.paths.schemas.glob("*")):
            if file.suffix.lower() not in {".yaml", ".yml", ".json"}:
                continue
            try:
                document = yaml.safe_load(file.read_text(encoding="utf-8"))
            except yaml.YAMLError:
                continue
            if not isinstance(document, dict):
                continue
            # Só OpenAPI: um AsyncAPI descreve canais, não rotas HTTP, e
            # misturá-los faria a busca devolver coisas incomparáveis.
            if not (document.get("openapi") or document.get("swagger")):
                continue

            title = str((document.get("info") or {}).get("title", file.stem))
            for path, item in (document.get("paths") or {}).items():
                if not isinstance(item, dict):
                    continue
                for method in HTTP_METHODS:
                    operation = item.get(method)
                    if not isinstance(operation, dict):
                        continue
                    operations.append(
                        {
                            "api": title,
                            "schema": file.name,
                            "operationId": str(operation.get("operationId", f"{method}-{path}")),
                            "method": method.upper(),
                            "path": str(path),
                            "summary": neutralize(str(operation.get("summary", ""))).content,
                            "description": neutralize(str(operation.get("description", ""))).content,
                            "tags": _as_list(operation.get("tags")),
                        }
                    )
        return operations

    def search_api(self, arguments: dict[str, Any]) -> dict[str, Any]:
        query = str(arguments.get("query", "")).strip().lower()
        operations = self._operations()

        if not query:
            return {"results": operations}

        results = [
            operation
            for operation in operations
            if query in operation["path"].lower()
            or query in operation["operationId"].lower()
            or query in operation["summary"].lower()
            or query in operation["description"].lower()
            or any(query in tag.lower() for tag in operation["tags"])
        ]
        return {"results": results}

    def get_api_endpoint(self, arguments: dict[str, Any]) -> dict[str, Any]:
        wanted_id = str(arguments.get("operationId", "")).strip()
        wanted_path = str(arguments.get("path", "")).strip()
        wanted_method = str(arguments.get("method", "")).strip().upper()

        if not wanted_id and not wanted_path:
            raise ToolError("Informe operationId ou path.")

        for operation in self._operations():
            if wanted_id and operation["operationId"] == wanted_id:
                return operation
            if wanted_path and operation["path"] == wanted_path:
                if not wanted_method or operation["method"] == wanted_method:
                    return operation

        raise ToolError("Operacao nao encontrada nas especificacoes do portal.")


# ---------------------------------------------------------------------------
# Changelog (§5)
# ---------------------------------------------------------------------------


class ChangelogTools:
    def __init__(self, paths: PortalPaths) -> None:
        self.paths = paths

    def get_changelog(self, arguments: dict[str, Any]) -> dict[str, Any]:
        limit = max(1, min(int(arguments.get("limit") or 10), 50))
        if not self.paths.changelog.is_dir():
            return {"entries": []}

        entries: list[dict[str, Any]] = []
        # O nome do arquivo é a data (`2026-08-12.md`), então a ordem inversa do
        # nome já é a ordem cronológica inversa — sem interpretar o conteúdo.
        for file in sorted(self.paths.changelog.glob("*.md*"), reverse=True)[:limit]:
            front, body = _split(file.read_text(encoding="utf-8"))
            entries.append(
                {
                    "path": f"changelog/{file.name}",
                    "title": str(front.get("title", file.stem)),
                    "date": file.stem,
                    "content": neutralize(body.strip()).content,
                }
            )
        return {"entries": entries}


# ---------------------------------------------------------------------------
# Seção de uma página (§5)
# ---------------------------------------------------------------------------


class SectionTools:
    """Recorta uma seção de uma página pelo título."""

    def __init__(self, paths: PortalPaths) -> None:
        self.paths = paths

    def get_section(self, arguments: dict[str, Any]) -> dict[str, Any]:
        relative = safe_relative_path(str(arguments.get("path", "")))
        heading = str(arguments.get("heading", "")).strip()
        if not heading:
            raise ToolError("Informe o titulo da secao.")

        target = self.paths.docs / relative
        if not target.is_file():
            raise ToolError(f"Documento nao encontrado: {relative}")

        _, body = _split(target.read_text(encoding="utf-8"))

        wanted = heading.lower()
        collected: list[str] = []
        level = 0
        inside = False
        fenced = False

        for line in body.split("\n"):
            if re.match(r"^\s*(?:```|~~~)", line):
                fenced = not fenced
            # Um `#` dentro de bloco de código é comentário, não título.
            match = None if fenced else re.match(r"^(#{1,6})\s+(.+?)\s*$", line)

            if match:
                depth = len(match.group(1))
                title = match.group(2)

                if inside and depth <= level:
                    # Título de mesmo nível ou acima encerra a seção.
                    break
                if not inside and title.strip().lower() == wanted:
                    inside = True
                    level = depth
                    collected.append(line)
                    continue

            if inside:
                collected.append(line)

        if not inside:
            raise ToolError(f"Secao nao encontrada em {relative}: {heading}")

        return {
            "path": relative,
            "heading": heading,
            "content": neutralize("\n".join(collected).strip()).content,
        }


# ---------------------------------------------------------------------------
# Qualidade (§9)
# ---------------------------------------------------------------------------


class QualityTools:
    """Executa o linter do portal e devolve nota e apontamentos.

    O linter é TypeScript e vive no portal; reimplementá-lo aqui criaria duas
    verdades sobre o que é uma boa página. Esta tool chama a CLI existente.

    É a **única** parte do servidor que inicia um processo, e o que a mantém
    segura: comando fixo, argumentos em lista (nunca shell), caminho validado
    antes, e nenhum argumento do cliente virando opção de linha de comando.
    """

    def __init__(self, paths: PortalPaths) -> None:
        self.paths = paths

    def check_documentation(self, arguments: dict[str, Any]) -> dict[str, Any]:
        relative = safe_relative_path(str(arguments.get("path", "")))

        target = self.paths.docs / relative
        if not target.is_file():
            raise ToolError(f"Documento nao encontrado: {relative}")

        try:
            completed = subprocess.run(
                ["npm", "run", "--silent", "docs:lint", "--", "--json", "--path", relative],
                cwd=self.paths.root,
                capture_output=True,
                text=True,
                timeout=120,
                shell=False,
                check=False,
            )
        except FileNotFoundError:
            raise ToolError(
                "O linter nao esta disponivel: npm nao foi encontrado. Esta tool "
                "exige o repositorio do portal com as dependencias instaladas."
            ) from None
        except subprocess.TimeoutExpired:
            raise ToolError("O linter nao respondeu em 120s.") from None

        try:
            report = json.loads(completed.stdout)
        except json.JSONDecodeError:
            detail = (completed.stderr or completed.stdout).strip()[:300]
            raise ToolError(f"O linter nao devolveu JSON. Saida: {detail}") from None

        pages = report.get("pages") or report.get("results") or []
        page = pages[0] if isinstance(pages, list) and pages else {}

        return {
            "path": relative,
            "score": page.get("score"),
            "gate": page.get("gate"),
            "issues": [
                {
                    "rule": finding.get("ruleId"),
                    "severity": finding.get("severity"),
                    "line": (finding.get("location") or {}).get("startLine"),
                    "column": (finding.get("location") or {}).get("startColumn"),
                    "message": finding.get("message"),
                    "suggestion": finding.get("suggestion"),
                }
                for finding in (page.get("findings") or [])
            ],
        }
