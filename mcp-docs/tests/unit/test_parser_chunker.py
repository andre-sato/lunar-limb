"""Parsing, chunking e metadata (§20, §21, §22, §32, §56)."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from mcp_docs.indexer.chunker import chunk_document
from mcp_docs.indexer.loader import locale_of, public_url, snippet_id
from mcp_docs.indexer.parser import content_hash, parse_document, split_frontmatter

NOW = datetime(2026, 8, 17, tzinfo=timezone.utc)

DOCUMENT = """---
title: Authentication
description: How to authenticate
---

Introdução ao fluxo.

## OAuth Flow

O cliente pede um authorization code.

```typescript
const token = await authenticate();
client.setToken(token);
```

## Rate limit

| Plano | Limite |
| --- | --- |
| Free | 100/min |
"""


def parse(raw: str = DOCUMENT):
    return parse_document(raw)


class TestFrontmatter:
    def test_le_pares_de_primeiro_nivel(self):
        data, body = split_frontmatter(DOCUMENT)
        assert data["title"] == "Authentication"
        assert data["description"] == "How to authenticate"
        assert not body.startswith("---")

    def test_documento_sem_frontmatter_passa_intacto(self):
        data, body = split_frontmatter("# Título\n\nTexto.")
        assert data == {}
        assert body.startswith("# Título")

    def test_ignora_estrutura_aninhada_em_vez_de_falhar(self):
        raw = "---\ntitle: T\nsidebar:\n  order: 3\n---\n\nTexto."
        data, _ = split_frontmatter(raw)
        assert data["title"] == "T"
        assert "order" not in data


class TestParser:
    def test_separa_secoes_por_heading(self):
        parsed = parse()
        headings = [section.heading for section in parsed.sections]
        assert "OAuth Flow" in headings
        assert "Rate limit" in headings

    def test_bloco_de_codigo_vira_bloco_proprio_com_linguagem(self):
        parsed = parse()
        oauth = next(section for section in parsed.sections if section.heading == "OAuth Flow")
        code = [block for block in oauth.blocks if block.kind == "code"]
        assert len(code) == 1
        assert code[0].code_language == "typescript"
        # A unidade é preservada: as duas linhas continuam juntas (§22).
        assert "authenticate()" in code[0].text
        assert "setToken" in code[0].text

    def test_hash_dentro_de_codigo_nao_e_heading(self):
        raw = "---\ntitle: T\n---\n\n```bash\n# isto é comentário\nnpm install\n```\n\nTexto real."
        parsed = parse_document(raw)
        assert all(section.heading != "isto é comentário" for section in parsed.sections)

    def test_tabela_vira_bloco_de_tabela(self):
        parsed = parse()
        rate = next(section for section in parsed.sections if section.heading == "Rate limit")
        assert any(block.kind == "table" for block in rate.blocks)

    def test_import_mdx_nao_e_prosa(self):
        raw = "---\ntitle: T\n---\n\nimport Alerta from '../../components/Alerta';\n\nTexto real."
        parsed = parse_document(raw)
        text = " ".join(section.text() for section in parsed.sections)
        assert "import" not in text
        assert "Texto real" in text

    def test_reconhece_referencias_a_conteudo_reutilizavel(self):
        raw = '---\ntitle: T\n---\n\n<ContentBlock id="rate-limit" />\n<IncludePage id="guides/setup" />'
        parsed = parse_document(raw)
        assert parsed.references == ["rate-limit", "guides/setup"]

    def test_bloco_de_codigo_nao_fechado_preserva_conteudo(self):
        parsed = parse_document("---\ntitle: T\n---\n\n```python\nprint('oi')\n")
        text = " ".join(section.text() for section in parsed.sections)
        assert "print('oi')" in text

    def test_hash_muda_com_o_conteudo(self):
        assert content_hash("a") != content_hash("b")
        assert content_hash("a") == content_hash("a")


class TestChunker:
    def chunks(self, raw: str = DOCUMENT, **kwargs):
        parsed = parse_document(raw)
        return chunk_document(
            path="api-reference/authentication.md",
            parsed=parsed,
            title=parsed.title("authentication"),
            updated_at=NOW,
            url="/api-reference/authentication/",
            **kwargs,
        )

    def test_heading_acompanha_o_conteudo(self):
        # É a regra da §21: sem o título, o parágrafo perde o assunto.
        oauth = next(chunk for chunk in self.chunks() if chunk.section == "OAuth Flow")
        assert "Document: Authentication" in oauth.content
        assert "Section: OAuth Flow" in oauth.content

    def test_codigo_recebe_content_type_e_linguagem(self):
        code = [chunk for chunk in self.chunks() if chunk.content_type == "code"]
        assert len(code) == 1
        assert code[0].code_language == "typescript"

    def test_tabela_recebe_content_type_proprio(self):
        assert any(chunk.content_type == "table" for chunk in self.chunks())

    def test_url_leva_ancora_da_secao(self):
        oauth = next(chunk for chunk in self.chunks() if chunk.section == "OAuth Flow")
        assert oauth.url == "/api-reference/authentication/#oauth-flow"

    def test_ids_sao_unicos(self):
        ids = [chunk.id for chunk in self.chunks()]
        assert len(ids) == len(set(ids))

    def test_prosa_longa_e_dividida_entre_paragrafos(self):
        paragraph = "Parágrafo com conteúdo suficiente. " * 30
        raw = f"---\ntitle: T\n---\n\n## Seção\n\n" + "\n\n".join([paragraph] * 4)
        chunks = self.chunks(raw)
        assert len(chunks) > 1
        # Nenhum chunk corta um parágrafo no meio.
        for chunk in chunks:
            assert not chunk.content.rstrip().endswith("Parágrafo com conteúdo")

    def test_metadata_completa(self):
        chunk = self.chunks()[0]
        assert chunk.source == "api-reference/authentication.md"
        assert chunk.title == "Authentication"
        assert chunk.updated_at == NOW
        assert chunk.repository == "default"

    def test_citation_usa_ancora_da_secao(self):
        oauth = next(chunk for chunk in self.chunks() if chunk.section == "OAuth Flow")
        assert oauth.citation() == "api-reference/authentication.md#oauth-flow"


class TestLoaderHelpers:
    @pytest.mark.parametrize(
        ("path", "expected"),
        [
            ("guides/auth.md", "/guides/auth/"),
            ("index.mdx", "/"),
            ("guides/index.md", "/guides/"),
        ],
    )
    def test_url_publica(self, path, expected):
        assert public_url(path) == expected

    @pytest.mark.parametrize(
        ("path", "expected"),
        [
            ("en/guides/auth.md", "en"),
            ("es/guides/auth.md", "es"),
            ("guides/auth.md", "pt-BR"),
            # `enterprise/` começa com "en" e não é inglês.
            ("enterprise/guia.md", "pt-BR"),
        ],
    )
    def test_idioma_pelo_prefixo(self, path, expected):
        assert locale_of(path) == expected

    def test_id_do_snippet_e_o_caminho_sem_extensao(self):
        assert snippet_id("rate-limit.md") == "rate-limit"
        assert snippet_id("avisos/beta.mdx") == "avisos/beta"
