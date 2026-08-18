"""Testes da leitura de proveniência do MCP (§12).

O ponto que mais importa aqui é o limite: esta leitura reporta o que a página
declara, e não deve nunca afirmar que uma evidência confere. Se algum dia um
teste destes esperar `invalid`, alguém reimplementou a verificação em Python — e
criou uma segunda verdade.
"""

from __future__ import annotations

from datetime import date

from mcp_docs.trust import DEFAULT_FRESHNESS_DAYS, infer_source_type, read_trust

TODAY = date(2026, 8, 18)


def page(body: str, frontmatter: str = "title: X") -> str:
    return f"---\n{frontmatter}\n---\n\n{body}\n"


def test_pagina_sem_proveniencia_e_nao_verificada() -> None:
    trust = read_trust(page("Texto comum."), today=TODAY)
    assert trust.status == "unverified"
    assert trust.evidence == []


def test_proveniencia_no_frontmatter_com_data_recente() -> None:
    raw = page(
        "Texto.",
        "title: X\nowner: Time de Plataforma\nprovenance:\n  - source: portal-api.yaml#/paths\n    verifiedAt: 2026-08-01",
    )
    trust = read_trust(raw, today=TODAY)

    assert trust.status == "verified"
    assert trust.verified_at == "2026-08-01"
    assert trust.owner == "Time de Plataforma"
    assert [item.source for item in trust.evidence] == ["portal-api.yaml#/paths"]


def test_bloco_no_ultimo_lugar_do_frontmatter_ainda_e_lido() -> None:
    # O caso que quebrava calado na primeira versão do lado TypeScript: o bloco
    # é o último do frontmatter, e o parser parava antes dele.
    raw = page("Texto.", "title: X\nprovenance:\n  - source: DOC-LINK-001\n    verifiedAt: 2026-08-01")
    assert read_trust(raw, today=TODAY).status == "verified"


def test_anotacao_inline_e_lida() -> None:
    raw = page("<!-- provenance:\nsource: src/lib/auth/session.ts:42\nverifiedAt: 2026-07-01\n-->\n\nA sessão expira.")
    trust = read_trust(raw, today=TODAY)

    assert trust.status == "verified"
    assert trust.evidence[0].source_type == "code"


def test_duas_fontes_na_mesma_anotacao() -> None:
    raw = page(
        "<!-- provenance:\nsource: DOC-LINK-001\nverifiedAt: 2026-08-01\nsource: src/lib/doctest/checks.ts\nverifiedAt: 2026-08-02\n-->\n\nTexto."
    )
    trust = read_trust(raw, today=TODAY)

    assert len(trust.evidence) == 2
    # A data reportada é a mais recente entre as evidências.
    assert trust.verified_at == "2026-08-02"


def test_verificacao_vencida_vira_stale() -> None:
    raw = page("Texto.", "title: X\nprovenance:\n  - source: portal-api.yaml#/paths\n    verifiedAt: 2025-01-01")
    assert read_trust(raw, today=TODAY).status == "stale"


def test_o_prazo_e_configuravel() -> None:
    raw = page("Texto.", "title: X\nprovenance:\n  - source: portal-api.yaml#/paths\n    verifiedAt: 2026-06-01")
    assert read_trust(raw, today=TODAY).status == "verified"
    assert read_trust(raw, freshness_days=30, today=TODAY).status == "stale"


def test_evidencia_sem_data_nao_conta_como_verificada() -> None:
    raw = page("Texto.", "title: X\nprovenance:\n  - source: portal-api.yaml#/paths")
    assert read_trust(raw, today=TODAY).status == "unverified"


def test_owner_sozinho_nao_e_evidencia() -> None:
    # Dizer quem responde pela página é contato, não evidência — e não deve
    # produzir uma afirmação falsa de proveniência.
    trust = read_trust(page("Texto.", "title: X\nowner: Time de Plataforma"), today=TODAY)
    assert trust.owner == "Time de Plataforma"
    assert trust.evidence == []


def test_nunca_reporta_invalid() -> None:
    # Esta leitura não confere evidência nenhuma; afirmar que algo é inválido
    # exigiria tê-lo conferido.
    for raw in [
        page("Texto."),
        page("Texto.", "title: X\nprovenance:\n  - source: nao-existe.yaml#/nada\n    verifiedAt: 2026-08-01"),
    ]:
        assert read_trust(raw, today=TODAY).status != "invalid"


def test_a_saida_declara_como_o_estado_foi_apurado() -> None:
    payload = read_trust(page("Texto."), today=TODAY).as_dict()
    assert payload["checked"] == "declaracao"


def test_inferencia_do_tipo_de_fonte() -> None:
    assert infer_source_type("portal-api.yaml#/paths") == "openapi"
    assert infer_source_type("asyncapi.yaml#/channels") == "asyncapi"
    assert infer_source_type("DOC-LINK-001") == "test"
    assert infer_source_type("src/lib/auth/session.ts:42") == "code"
    assert infer_source_type("confirmado pelo time") == "manual"
    assert infer_source_type("manual:qualquer coisa") == "manual"


def test_prazo_padrao_igual_ao_do_portal() -> None:
    assert DEFAULT_FRESHNESS_DAYS == 180
