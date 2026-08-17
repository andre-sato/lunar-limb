"""Configuração em camadas (§11).

Precedência, da menor para a maior: valores padrão → arquivo de configuração →
variáveis de ambiente → argumentos da linha de comando. Argumento explícito
sempre vence, porque é o que a pessoa acabou de digitar.

Segredos vêm **só** do ambiente (ou de um `.env` fora do Git). O arquivo de
configuração é feito para ser versionado e compartilhado com o time; aceitar
token nele convidaria a commitá-lo.
"""

from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass, field, replace
from pathlib import Path

from dotenv import load_dotenv

DEFAULT_CONFIG_PATH = Path.home() / ".config" / "mcp-docs" / "config.toml"


@dataclass(frozen=True)
class ServerConfig:
    #: Vazio significa "suba o servidor em processo próprio" (§38).
    url: str = ""
    #: Comando do servidor local. Lista, nunca string — nada passa por shell (§48.4).
    command: list[str] = field(default_factory=lambda: ["doc-mcp-server"])


@dataclass(frozen=True)
class SearchConfig:
    limit: int = 5
    #: Score mínimo, 0–1. Abaixo dele o resultado não conta como evidência (§27).
    min_score: float = 0.15
    #: Peso do lexical na fusão híbrida; o vetorial recebe o complemento (§23).
    keyword_weight: float = 0.5


@dataclass(frozen=True)
class LLMConfig:
    provider: str = "anthropic"
    model: str = "claude-opus-5"
    max_output_tokens: int = 2048
    effort: str = "low"


@dataclass(frozen=True)
class EmbeddingConfig:
    #: Endpoint compatível com a API de embeddings da OpenAI.
    base_url: str = "https://api.openai.com/v1"
    model: str = "text-embedding-3-small"


@dataclass(frozen=True)
class IndexConfig:
    #: Raízes da documentação. Padrão: o conteúdo do portal Starlight vizinho.
    docs_roots: list[str] = field(default_factory=lambda: ["../src/content/docs"])
    snippets_roots: list[str] = field(default_factory=lambda: ["../src/content/snippets"])
    path: str = "data/index.json"
    repository: str = "default"


@dataclass(frozen=True)
class Config:
    server: ServerConfig = field(default_factory=ServerConfig)
    search: SearchConfig = field(default_factory=SearchConfig)
    llm: LLMConfig = field(default_factory=LLMConfig)
    embedding: EmbeddingConfig = field(default_factory=EmbeddingConfig)
    index: IndexConfig = field(default_factory=IndexConfig)
    #: Diretório-base para resolver caminhos relativos da configuração.
    root: Path = field(default_factory=Path.cwd)

    # -- segredos, só do ambiente -------------------------------------------
    mcp_token: str = ""
    llm_api_key: str = ""
    embedding_api_key: str = ""

    @property
    def index_path(self) -> Path:
        return self._resolve(self.index.path)

    def docs_roots(self) -> list[Path]:
        return [self._resolve(entry) for entry in self.index.docs_roots]

    def snippets_roots(self) -> list[Path]:
        return [self._resolve(entry) for entry in self.index.snippets_roots]

    def _resolve(self, value: str) -> Path:
        candidate = Path(value).expanduser()
        return candidate if candidate.is_absolute() else (self.root / candidate).resolve()

    def has_llm(self) -> bool:
        return self.llm_api_key != ""

    def has_embeddings(self) -> bool:
        return self.embedding_api_key != ""


class ConfigError(Exception):
    """Configuração inválida — mapeada para o exit code 3 (§46)."""


def _read_toml(path: Path) -> dict:
    if not path.is_file():
        return {}
    try:
        with path.open("rb") as handle:
            return tomllib.load(handle)
    except (tomllib.TOMLDecodeError, OSError) as error:
        raise ConfigError(f"Não foi possível ler {path}: {error}") from error


def _as_int(value: str | None, fallback: int) -> int:
    try:
        return int(value) if value else fallback
    except ValueError as error:
        raise ConfigError(f"Valor inteiro inválido: {value!r}") from error


def _as_float(value: str | None, fallback: float) -> float:
    try:
        return float(value) if value else fallback
    except ValueError as error:
        raise ConfigError(f"Valor numérico inválido: {value!r}") from error


def config_path() -> Path:
    return Path(os.environ.get("DOC_CONFIG", DEFAULT_CONFIG_PATH)).expanduser()


def load_config(**overrides: object) -> Config:
    """Monta a configuração efetiva.

    `overrides` são os argumentos da CLI; valores `None` são ignorados, para que
    "não passei a opção" e "passei zero" não se confundam.
    """
    load_dotenv(override=False)

    path = config_path()
    raw = _read_toml(path)

    server_raw = raw.get("server", {})
    search_raw = raw.get("search", {})
    llm_raw = raw.get("llm", {})
    embedding_raw = raw.get("embedding", {})
    index_raw = raw.get("index", {})

    command = server_raw.get("command", ["doc-mcp-server"])
    if isinstance(command, str):
        # Uma string aqui é ambígua: dividir por espaços já é uma forma de
        # interpretação de shell. A configuração exige lista.
        raise ConfigError("server.command deve ser uma lista de argumentos, não uma string.")

    config = Config(
        server=ServerConfig(
            url=os.environ.get("DOC_MCP_SERVER_URL", server_raw.get("url", "")),
            command=list(command),
        ),
        search=SearchConfig(
            limit=_as_int(os.environ.get("DOC_SEARCH_LIMIT"), int(search_raw.get("limit", 5))),
            min_score=_as_float(
                os.environ.get("DOC_SEARCH_MIN_SCORE"), float(search_raw.get("min_score", 0.15))
            ),
            keyword_weight=float(search_raw.get("keyword_weight", 0.5)),
        ),
        llm=LLMConfig(
            provider=os.environ.get("DOC_LLM_PROVIDER", llm_raw.get("provider", "anthropic")),
            model=os.environ.get("DOC_LLM_MODEL", llm_raw.get("model", "claude-opus-5")),
            max_output_tokens=int(llm_raw.get("max_output_tokens", 2048)),
            effort=str(llm_raw.get("effort", "low")),
        ),
        embedding=EmbeddingConfig(
            base_url=os.environ.get(
                "DOC_EMBEDDING_BASE_URL", embedding_raw.get("base_url", "https://api.openai.com/v1")
            ),
            model=os.environ.get(
                "DOC_EMBEDDING_MODEL", embedding_raw.get("model", "text-embedding-3-small")
            ),
        ),
        index=IndexConfig(
            docs_roots=list(index_raw.get("docs_roots", ["../src/content/docs"])),
            snippets_roots=list(index_raw.get("snippets_roots", ["../src/content/snippets"])),
            path=os.environ.get("DOC_INDEX_PATH", index_raw.get("path", "data/index.json")),
            repository=index_raw.get("repository", "default"),
        ),
        root=Path(os.environ.get("DOC_ROOT", Path.cwd())).expanduser().resolve(),
        mcp_token=os.environ.get("DOC_MCP_TOKEN", ""),
        llm_api_key=os.environ.get("ANTHROPIC_API_KEY", "") or os.environ.get("DOC_LLM_API_KEY", ""),
        embedding_api_key=os.environ.get("DOC_EMBEDDING_API_KEY", "")
        or os.environ.get("OPENAI_API_KEY", ""),
    )

    return apply_overrides(config, **overrides)


def apply_overrides(config: Config, **overrides: object) -> Config:
    """Aplica argumentos da CLI sobre uma configuração já montada."""
    limit = overrides.get("limit")
    if isinstance(limit, int):
        config = replace(config, search=replace(config.search, limit=limit))

    server_url = overrides.get("server_url")
    if isinstance(server_url, str) and server_url:
        config = replace(config, server=replace(config.server, url=server_url))

    model = overrides.get("model")
    if isinstance(model, str) and model:
        config = replace(config, llm=replace(config.llm, model=model))

    index_path = overrides.get("index_path")
    if isinstance(index_path, str) and index_path:
        config = replace(config, index=replace(config.index, path=index_path))

    return config
