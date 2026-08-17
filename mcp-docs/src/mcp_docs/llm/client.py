"""Camada de LLM (§53).

`LLMProvider` é a interface; a implementação padrão usa o SDK oficial da
Anthropic. Sem chave configurada, `RetrievalOnlyProvider` responde com os
próprios trechos recuperados e as fontes.

Esse modo não é um stub: é o comportamento correto quando não há credencial. Uma
CLI de documentação que só sabe dizer "configure uma chave" é inútil; uma que
devolve as passagens relevantes com o caminho já responde à maior parte das
perguntas — e, por não haver modelo, não tem como alucinar.
"""

from __future__ import annotations

from typing import Protocol

from ..models import Answer, SearchResult
from ..observability import METRICS, emit
from .prompt import NO_ANSWER, SYSTEM_PROMPT, build_user_message, citations

#: Modelos que rejeitam `temperature` com HTTP 400. A família Claude 5 e a Opus
#: 4.7+ removeram os parâmetros de amostragem; enviá-los derruba a requisição.
NO_SAMPLING_PREFIXES = (
    "claude-opus-5",
    "claude-sonnet-5",
    "claude-fable-5",
    "claude-mythos-5",
    "claude-opus-4-7",
    "claude-opus-4-8",
)


def accepts_temperature(model: str) -> bool:
    return not model.startswith(NO_SAMPLING_PREFIXES)


class LLMProvider(Protocol):
    def is_available(self) -> bool: ...

    def answer(self, question: str, results: list[SearchResult]) -> Answer: ...


class RetrievalOnlyProvider:
    """Compõe a resposta a partir dos trechos, sem gerar prosa."""

    def is_available(self) -> bool:
        return True

    def answer(self, question: str, results: list[SearchResult]) -> Answer:
        if not results:
            return Answer(answer=NO_ANSWER, sources=[], retrieval_only=True, insufficient_context=True)

        parts = [
            "Sem provedor de LLM configurado — estes são os trechos mais relevantes da documentação:",
            "",
        ]
        for result in results[:3]:
            heading = f" — {result.section}" if result.section else ""
            parts.append(f"## {result.title}{heading}")
            parts.append("")
            parts.append(_strip_context_header(result.content)[:900].strip())
            parts.append("")

        return Answer(
            answer="\n".join(parts).strip(),
            sources=citations(results),
            retrieval_only=True,
        )


class AnthropicProvider:
    def __init__(self, *, api_key: str, model: str, max_output_tokens: int = 2048, effort: str = "low") -> None:
        self._api_key = api_key
        self._model = model
        self._max_output_tokens = max_output_tokens
        self._effort = effort

    def is_available(self) -> bool:
        return self._api_key != ""

    def answer(self, question: str, results: list[SearchResult]) -> Answer:
        if not results:
            return Answer(answer=NO_ANSWER, sources=[], insufficient_context=True)

        try:
            import anthropic
        except ImportError as error:
            raise RuntimeError(
                "O provedor Anthropic exige o extra `anthropic`: pip install 'mcp-docs-cli[anthropic]'"
            ) from error

        client = anthropic.Anthropic(api_key=self._api_key)

        body: dict[str, object] = {
            "model": self._model,
            "max_tokens": self._max_output_tokens,
            "system": SYSTEM_PROMPT,
            "messages": [{"role": "user", "content": build_user_message(question, results)}],
            "output_config": {"effort": self._effort},
        }
        if accepts_temperature(self._model):
            body["temperature"] = 0

        response = client.messages.create(**body)  # type: ignore[arg-type]
        METRICS.increment("llm_calls")

        # A checagem de recusa vem **antes** de ler o conteúdo: numa recusa o
        # array pode estar vazio e indexá-lo quebraria.
        if getattr(response, "stop_reason", None) == "refusal":
            emit("llm_refusal", model=self._model)
            return Answer(answer="Não posso responder a esse pedido.", sources=[])

        text = "\n".join(
            block.text for block in response.content if getattr(block, "type", "") == "text"
        ).strip()

        return Answer(
            answer=text or NO_ANSWER,
            sources=citations(results),
            insufficient_context=not text,
        )


def build_provider(config) -> LLMProvider:  # noqa: ANN001 - evita import circular
    if not config.has_llm():
        return RetrievalOnlyProvider()
    if config.llm.provider != "anthropic":
        # Provedor desconhecido não deve virar chamada errada: cai no modo que
        # sempre funciona, e o `doc doctor` mostra o motivo.
        emit("llm_provider_unknown", provider=config.llm.provider)
        return RetrievalOnlyProvider()
    return AnthropicProvider(
        api_key=config.llm_api_key,
        model=config.llm.model,
        max_output_tokens=config.llm.max_output_tokens,
        effort=config.llm.effort,
    )


def _strip_context_header(content: str) -> str:
    """Remove o cabeçalho `Document:/Section:` que o chunker adiciona.

    Ele serve ao retrieval e ao modelo; para o leitor humano é ruído, porque a
    CLI já mostra o título e a seção separadamente.
    """
    lines = content.splitlines()
    while lines and (lines[0].startswith(("Document:", "Section:")) or lines[0].strip() == ""):
        lines.pop(0)
    return "\n".join(lines)
