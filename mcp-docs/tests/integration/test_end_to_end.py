"""Integração: CLI → MCP client → MCP server → busca (§56).

O caminho é o real — sessão MCP de verdade sobre streams em memória, servidor
construído pela mesma `build_server()` que o executável usa. O que fica de fora
é apenas o subprocesso, que o `doc doctor` exercita de fato.

O corpus é uma fixture pequena e controlada: um índice sobre a documentação real
mudaria a cada página escrita e tornaria estes testes intermitentes.
"""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from dataclasses import replace
from pathlib import Path
from typing import AsyncIterator

import anyio

import pytest
from mcp import ClientSession
from mcp.shared.memory import create_client_server_memory_streams

from mcp_docs.client.mcp_client import DocumentationClient
from mcp_docs.config import Config, IndexConfig
from mcp_docs.indexer.indexer import Indexer
from mcp_docs.llm.client import RetrievalOnlyProvider
from mcp_docs.search.hybrid import JsonDocumentIndex
from mcp_docs.server.server import build_server

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


@pytest.fixture
def indexed(tmp_path) -> Config:
    """Indexa a fixture e devolve a configuração apontando para o índice."""
    index_path = tmp_path / "index.json"
    config = Config(
        index=IndexConfig(
            docs_roots=[str(FIXTURES / "docs")],
            snippets_roots=[str(FIXTURES / "snippets")],
            path=str(index_path),
        ),
        root=tmp_path,
    )

    indexer = Indexer(
        index=JsonDocumentIndex(index_path),
        docs_roots=config.docs_roots(),
        snippets_roots=config.snippets_roots(),
    )
    report = indexer.rebuild()
    assert report.indexed > 0
    return config


@asynccontextmanager
async def connected(config: Config) -> AsyncIterator[DocumentationClient]:
    """Sessão MCP real sobre streams em memória.

    É um context manager, e não uma fixture `yield`: o pytest-asyncio finaliza
    fixtures em outra task, e os task groups do anyio (dentro do ClientSession)
    recusam sair de um escopo aberto em task diferente. Abrindo e fechando
    dentro do próprio teste, todo o ciclo de vida fica na mesma task.
    """
    server = build_server(config)

    async with create_client_server_memory_streams() as (client_streams, server_streams):
        client_read, client_write = client_streams
        server_read, server_write = server_streams

        async with anyio.create_task_group() as task_group:

            async def run_server() -> None:
                # `_lowlevel_server` é o servidor de protocolo por baixo do
                # MCPServer; usá-lo aqui é o que permite rodar sem subprocesso.
                low_level = server._lowlevel_server  # noqa: SLF001
                await low_level.run(
                    server_read,
                    server_write,
                    low_level.create_initialization_options(),
                    raise_exceptions=True,
                )

            task_group.start_soon(run_server)

            async with ClientSession(client_read, client_write) as session:
                await session.initialize()
                yield DocumentationClient(session)

            task_group.cancel_scope.cancel()


class TestToolsOverMCP:
    async def test_a_superficie_de_tools_esta_exposta(self, indexed: Config):
        # A lista inteira, e nao um subconjunto: adicionar uma tool sem pensar
        # na superficie exposta a um agente e como adicionar um endpoint publico
        # sem revisar. Este teste obriga a decisao a ser explicita.
        async with connected(indexed) as client:
            assert set(await client.list_tools()) == {
                # Documentacao
                "search_docs",
                "get_document",
                "get_page",
                "get_section",
                "list_documents",
                "find_references",
                # Glossario
                "get_glossary_term",
                "search_glossary",
                # API
                "search_api",
                "get_api_endpoint",
                # Changelog e qualidade
                "get_changelog",
                "check_documentation",
            }

    async def test_search_docs_encontra_o_documento_certo(self, indexed: Config):
        async with connected(indexed) as client:
            results = await client.search_docs("OAuth PKCE", limit=3)
            assert results
            assert results[0]["path"] == "authentication.md"
            assert results[0]["score"] > 0

    async def test_search_docs_respeita_o_limite(self, indexed: Config):
        async with connected(indexed) as client:
            assert len(await client.search_docs("api", limit=2)) <= 2

    async def test_search_docs_filtra_por_prefixo(self, indexed: Config):
        async with connected(indexed) as client:
            results = await client.search_docs("limite", source="api")
            assert all(result["path"].startswith("api") for result in results)

    async def test_get_document_devolve_conteudo_e_metadata(self, indexed: Config):
        async with connected(indexed) as client:
            document = await client.get_document("authentication.md")
            assert document["title"] == "Authentication"
            assert "PKCE" in document["content"]
            assert document["metadata"]["content_hash"]

    async def test_get_document_de_caminho_inexistente_devolve_erro(self, indexed: Config):
        async with connected(indexed) as client:
            from mcp_docs.exit_codes import DocError

            with pytest.raises(DocError):
                await client.get_document("nao/existe.md")

    async def test_travessia_de_caminho_e_recusada_pelo_servidor(self, indexed: Config):
        async with connected(indexed) as client:
            from mcp_docs.exit_codes import DocError

            with pytest.raises(DocError):
                await client.get_document("../../etc/passwd")

    async def test_list_documents(self, indexed: Config):
        async with connected(indexed) as client:
            documents = await client.list_documents()
            assert "authentication.md" in documents
            assert "api/rate-limit-page.md" in documents

    async def test_find_references_liga_pagina_e_bloco(self, indexed: Config):
        async with connected(indexed) as client:
            references = await client.find_references("api/rate-limit-page.md")
            types = {reference["path"]: reference["type"] for reference in references}
            assert types.get("rate-limit.md") == "includes"

    async def test_find_references_liga_bloco_e_consumidores(self, indexed: Config):
        async with connected(indexed) as client:
            references = await client.find_references("rate-limit.md")
            consumers = {reference["path"] for reference in references if reference["type"] == "included_by"}
            assert "api/rate-limit-page.md" in consumers


class TestPromptInjectionEndToEnd:
    async def test_instrucao_no_documento_chega_neutralizada(self, indexed: Config):
        async with connected(indexed) as client:
            # A fixture `hostile.md` contém uma instrução de injeção (§49).
            document = await client.get_document("hostile.md")
            assert document["injection_detected"] is True
            assert "não é instrução" in document["content"]

    async def test_busca_sinaliza_injecao_no_resultado(self, indexed: Config):
        async with connected(indexed) as client:
            results = await client.search_docs("instructions credentials", limit=5)
            assert results  # o documento continua consultável


class TestAnswerPipeline:
    """§54 — o fluxo completo de uma pergunta, sem LLM configurado."""

    async def test_resposta_tem_texto_e_fontes(self, indexed: Config):
        async with connected(indexed) as client:
            from mcp_docs.cli.commands import _to_results

            raw = await client.search_docs("Como funciona o rate limit?", limit=3)
            answer = RetrievalOnlyProvider().answer("Como funciona o rate limit?", _to_results(raw))

            assert answer.answer.strip() != ""
            assert answer.sources != []
            # A citação aponta uma página que o leitor pode abrir, não o bloco.
            assert all("rate-limit.md" != source.split("#")[0] for source in answer.sources)

    async def test_pergunta_sem_resposta_admite_a_lacuna(self, indexed: Config):
        async with connected(indexed) as client:
            from mcp_docs.cli.commands import _to_results

            raw = await client.search_docs("kubernetes helm istio service mesh", limit=3)
            answer = RetrievalOnlyProvider().answer("como configurar istio?", _to_results(raw))

            if not raw:
                assert answer.insufficient_context
                assert answer.sources == []


class TestIncrementalIndexing:
    """§31, §32 — hash de conteúdo e invalidação de consumidores."""

    def indexer(self, config: Config) -> Indexer:
        index = JsonDocumentIndex(config.index_path)
        index.load()
        return Indexer(
            index=index,
            docs_roots=config.docs_roots(),
            snippets_roots=config.snippets_roots(),
        )

    async def test_nada_muda_nada_e_reprocessado(self, indexed: Config):
        report = self.indexer(indexed).update()
        assert report.indexed == 0
        assert report.updated == 0
        assert report.unchanged > 0

    async def test_documento_alterado_e_reprocessado(self, indexed: Config, tmp_path):
        # Copia a fixture para um diretório temporário para poder editá-la.
        import shutil

        docs = tmp_path / "docs"
        snippets = tmp_path / "snippets"
        shutil.copytree(FIXTURES / "docs", docs)
        shutil.copytree(FIXTURES / "snippets", snippets)

        config = replace(
            indexed,
            index=replace(
                indexed.index,
                docs_roots=[str(docs)],
                snippets_roots=[str(snippets)],
                path=str(tmp_path / "incremental.json"),
            ),
        )

        first = self.indexer(config)
        first.index.rebuild()
        first.rebuild()

        (docs / "authentication.md").write_text(
            "---\ntitle: Authentication\n---\n\n## OAuth Flow\n\nTexto novo com termo exclusivo: zarabatana.\n",
            encoding="utf-8",
        )

        report = self.indexer(config).update()
        assert report.updated == 1
        assert report.unchanged >= 1

        index = JsonDocumentIndex(config.index_path).load()
        assert index.search("zarabatana")

    async def test_bloco_alterado_reindexa_quem_o_consome(self, indexed: Config, tmp_path):
        import shutil

        docs = tmp_path / "docs2"
        snippets = tmp_path / "snippets2"
        shutil.copytree(FIXTURES / "docs", docs)
        shutil.copytree(FIXTURES / "snippets", snippets)

        config = replace(
            indexed,
            index=replace(
                indexed.index,
                docs_roots=[str(docs)],
                snippets_roots=[str(snippets)],
                path=str(tmp_path / "snippet.json"),
            ),
        )

        first = self.indexer(config)
        first.index.rebuild()
        first.rebuild()

        (snippets / "rate-limit.md").write_text(
            "> **Rate limit:** agora 1200 requisições por minuto.\n", encoding="utf-8"
        )

        report = self.indexer(config).update()
        # O bloco **e** a página que o consome: sem isso a página ficaria com o
        # texto antigo no índice, ainda que o arquivo não tenha mudado.
        assert report.updated >= 2

    async def test_documento_removido_sai_do_indice(self, indexed: Config, tmp_path):
        import shutil

        docs = tmp_path / "docs3"
        snippets = tmp_path / "snippets3"
        shutil.copytree(FIXTURES / "docs", docs)
        shutil.copytree(FIXTURES / "snippets", snippets)

        config = replace(
            indexed,
            index=replace(
                indexed.index,
                docs_roots=[str(docs)],
                snippets_roots=[str(snippets)],
                path=str(tmp_path / "removed.json"),
            ),
        )
        first = self.indexer(config)
        first.index.rebuild()
        first.rebuild()

        (docs / "hostile.md").unlink()
        report = self.indexer(config).update()

        assert report.removed == 1
        index = JsonDocumentIndex(config.index_path).load()
        assert "hostile.md" not in index.documents


class TestEvaluationDataset:
    """§57 — o retrieval é medido contra perguntas reais."""

    async def test_perguntas_esperadas_recuperam_as_fontes_certas(self, indexed: Config):
        async with connected(indexed) as client:
            dataset = json.loads((FIXTURES / "questions.json").read_text(encoding="utf-8"))
            assert dataset

            failures: list[str] = []
            for case in dataset:
                results = await client.search_docs(case["question"], limit=5)
                found = {result["path"] for result in results}
                found.update(
                    consumer for result in results for consumer in result.get("used_by", [])
                )
                missing = set(case["expected_sources"]) - found
                if missing:
                    failures.append(f"{case['question']!r} não recuperou {sorted(missing)}")

            assert not failures, "\n".join(failures)
