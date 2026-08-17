"""Busca, ranking, filtros e o grafo de origem (§23, §24, §36, §52, §56)."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from mcp_docs.models import Chunk, DocumentMeta
from mcp_docs.search.hybrid import JsonDocumentIndex, SearchFilters
from mcp_docs.search.keyword import LexicalIndex, tokenize
from mcp_docs.search.vector import cosine_similarity

NOW = datetime(2026, 8, 17, tzinfo=timezone.utc)


def chunk(chunk_id: str, source: str, content: str, **kwargs) -> Chunk:
    defaults = dict(title="Doc", updated_at=NOW)
    defaults.update(kwargs)
    return Chunk(id=chunk_id, source=source, content=content, **defaults)  # type: ignore[arg-type]


def build_index(tmp_path, chunks: list[Chunk], documents: dict[str, DocumentMeta] | None = None):
    index = JsonDocumentIndex(tmp_path / "index.json")
    index.add(chunks)
    index.documents = documents or {
        item.source: DocumentMeta(
            path=item.source,
            title=item.title,
            content_hash="x",
            updated_at=NOW,
            kind=item.kind,
            used_by=item.used_by,
        )
        for item in chunks
    }
    return index


class TestTokenize:
    def test_remove_acentos_e_stopwords(self):
        assert tokenize("Como funciona a autenticação?") == ["funciona", "autenticacao"]

    def test_preserva_identificadores_tecnicos(self):
        # É o motivo de existir a busca lexical (§23).
        assert "rate_limit_429" in tokenize("erro RATE_LIMIT_429 na API")


class TestLexicalRanking:
    def test_termo_no_titulo_pesa_mais(self):
        documents = {"a": "texto qualquer sobre coisas", "b": "texto qualquer sobre coisas"}
        titles = {"a": "Autenticação", "b": "Outro assunto"}
        lexical = LexicalIndex.build(documents, titles)

        score_a = lexical.score("autenticação", "a", "Autenticação")
        score_b = lexical.score("autenticação", "b", "Outro assunto")
        assert score_a > score_b

    def test_chunk_sem_o_termo_pontua_zero(self):
        lexical = LexicalIndex.build({"a": "sobre pagamentos"}, {"a": "Pagamentos"})
        assert lexical.score("webhooks", "a", "Pagamentos") == 0.0


class TestSearch:
    def test_ordena_por_relevancia_e_normaliza_para_0_1(self, tmp_path):
        index = build_index(
            tmp_path,
            [
                chunk("1", "rate-limit.md", "O rate limit é de 600 requisições por minuto"),
                chunk("2", "outro.md", "Texto sobre outra coisa qualquer"),
            ],
        )
        results = index.search("rate limit", limit=5)
        assert results[0].path == "rate-limit.md"
        assert results[0].score == 1.0
        assert all(0 < result.score <= 1 for result in results)

    def test_consulta_vazia_devolve_nada(self, tmp_path):
        index = build_index(tmp_path, [chunk("1", "a.md", "texto")])
        assert index.search("   ") == []

    def test_filtro_por_prefixo_de_caminho(self, tmp_path):
        index = build_index(
            tmp_path,
            [
                chunk("1", "api/auth.md", "autenticação da api"),
                chunk("2", "guides/auth.md", "autenticação no guia"),
            ],
        )
        results = index.search("autenticação", source="api")
        assert [result.path for result in results] == ["api/auth.md"]

    def test_filtro_por_tipo_de_conteudo(self, tmp_path):
        index = build_index(
            tmp_path,
            [
                chunk("1", "a.md", "exemplo de autenticação", content_type="code"),
                chunk("2", "b.md", "explicação de autenticação"),
            ],
        )
        results = index.search("autenticação", content_type="code")
        assert [result.path for result in results] == ["a.md"]

    def test_min_score_corta_resultado_fraco(self, tmp_path):
        index = build_index(
            tmp_path,
            [
                chunk("1", "a.md", "rate limit rate limit rate limit"),
                chunk("2", "b.md", "menção passageira a limit em outro contexto bem diferente"),
            ],
        )
        assert len(index.search("rate limit", min_score=0.0)) == 2
        assert len(index.search("rate limit", min_score=0.9)) == 1

    def test_limit_recorta_o_resultado(self, tmp_path):
        index = build_index(
            tmp_path, [chunk(str(i), f"{i}.md", "autenticação da api") for i in range(10)]
        )
        assert len(index.search("autenticação", limit=3)) == 3

    def test_matched_by_indica_a_origem(self, tmp_path):
        index = build_index(tmp_path, [chunk("1", "a.md", "rate limit")])
        assert index.search("rate limit")[0].matched_by == "keyword"


class TestHybridFusion:
    class FakeEmbeddings:
        """Devolve sempre o mesmo vetor de consulta.

        O teste verifica a fusão dos dois rankings, não o modelo: o que importa
        é que a consulta aponte para o vetor de um dos documentos.
        """

        def __init__(self, query_vector):
            self.query_vector = query_vector

        def is_available(self):
            return True

        def embed(self, texts):
            return [list(self.query_vector) for _ in texts]

    def test_vetorial_reordena_quando_o_lexical_empata(self, tmp_path):
        a = chunk("1", "a.md", "documento sobre credenciais", embedding=[1.0, 0.0])
        b = chunk("2", "b.md", "documento sobre credenciais", embedding=[0.0, 1.0])

        index = build_index(tmp_path, [a, b])
        index.embeddings = self.FakeEmbeddings([0.0, 1.0])  # type: ignore[assignment]

        results = index.search("documento credenciais", limit=2, keyword_weight=0.2)
        assert results[0].path == "b.md"
        assert results[0].matched_by in {"hybrid", "vector"}

    def test_falha_do_servico_de_embeddings_nao_derruba_a_busca(self, tmp_path):
        class Broken:
            def is_available(self):
                return True

            def embed(self, texts):
                raise RuntimeError("503")

        index = build_index(tmp_path, [chunk("1", "a.md", "rate limit", embedding=[1.0, 0.0])])
        index.embeddings = Broken()  # type: ignore[assignment]

        results = index.search("rate limit")
        assert results and results[0].matched_by == "keyword"


class TestCosine:
    def test_vetores_iguais_dao_um(self):
        # `approx` e não igualdade exata: o cosseno de um vetor com ele mesmo
        # dá 0.9999999999999998 em ponto flutuante.
        assert cosine_similarity([1.0, 2.0], [1.0, 2.0]) == pytest.approx(1.0)

    def test_ortogonais_dao_zero(self):
        assert cosine_similarity([1.0, 0.0], [0.0, 1.0]) == 0.0

    def test_dimensoes_diferentes_ou_vazio_dao_zero(self):
        assert cosine_similarity([1.0], [1.0, 2.0]) == 0.0
        assert cosine_similarity([], [1.0]) == 0.0


class TestSourceGraph:
    """§36 — quem usa o quê."""

    def index_with_snippet(self, tmp_path):
        documents = {
            "rate-limit.md": DocumentMeta(
                path="rate-limit.md",
                title="Aviso de rate limit",
                content_hash="x",
                updated_at=NOW,
                kind="snippet",
                used_by=["api/overview.md", "api/payments.md"],
            ),
            "api/overview.md": DocumentMeta(
                path="api/overview.md", title="Overview", content_hash="x", updated_at=NOW
            ),
            "api/payments.md": DocumentMeta(
                path="api/payments.md", title="Payments", content_hash="x", updated_at=NOW
            ),
        }
        return build_index(tmp_path, [chunk("1", "rate-limit.md", "600 por minuto")], documents)

    def test_snippet_aponta_quem_o_inclui(self, tmp_path):
        index = self.index_with_snippet(tmp_path)
        references = index.references_for("rate-limit.md")
        assert ("api/overview.md", "included_by") in references
        assert ("api/payments.md", "included_by") in references

    def test_pagina_aponta_o_bloco_que_inclui(self, tmp_path):
        index = self.index_with_snippet(tmp_path)
        references = index.references_for("api/overview.md")
        assert ("rate-limit.md", "includes") in references

    def test_paginas_que_compartilham_bloco_sao_relacionadas(self, tmp_path):
        index = self.index_with_snippet(tmp_path)
        references = index.references_for("api/overview.md")
        assert ("api/payments.md", "related") in references
        # Uma página não é relacionada a si mesma.
        assert ("api/overview.md", "related") not in references

    def test_documento_desconhecido_nao_tem_referencias(self, tmp_path):
        index = self.index_with_snippet(tmp_path)
        assert index.references_for("não-existe.md") == []


class TestPersistence:
    def test_salva_e_recarrega(self, tmp_path):
        index = build_index(tmp_path, [chunk("1", "a.md", "conteúdo com acento: ação")])
        index.save()

        reloaded = JsonDocumentIndex(tmp_path / "index.json").load()
        assert len(reloaded.chunks) == 1
        assert "ação" in reloaded.chunks[0].content

    def test_delete_remove_documento_e_chunks(self, tmp_path):
        index = build_index(tmp_path, [chunk("1", "a.md", "x"), chunk("2", "b.md", "y")])
        index.delete("a.md")
        assert [c.source for c in index.chunks] == ["b.md"]
        assert "a.md" not in index.documents

    def test_rebuild_esvazia(self, tmp_path):
        index = build_index(tmp_path, [chunk("1", "a.md", "x")])
        index.rebuild()
        assert index.chunks == [] and index.documents == {}

    def test_list_documents_filtra_por_prefixo(self, tmp_path):
        index = build_index(
            tmp_path, [chunk("1", "api/a.md", "x"), chunk("2", "guides/b.md", "y")]
        )
        assert index.list_documents("api") == ["api/a.md"]
        assert len(index.list_documents()) == 2


class TestFilters:
    def test_source_e_prefixo_nao_substring(self):
        item = chunk("1", "api-reference/auth.md", "x")
        assert SearchFilters(source="api-reference").matches(item)
        assert not SearchFilters(source="reference").matches(item)
