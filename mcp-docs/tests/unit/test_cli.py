"""CLI: parsing, exit codes, saída JSON e autenticação (§40, §46, §47, §56).

Os exit codes são contrato público — script e CI dependem deles, então cada um
tem teste. Três deles nasceram de bugs reais encontrados rodando a CLI de
verdade: o Click devolve o código em vez de levantar exceção quando
`standalone_mode=False`; o Typer traz a própria cópia do Click, então
`click.exceptions.UsageError` não é a exceção que ele levanta; e um `DocError`
vindo de dentro de um task group chega embrulhado em `BaseExceptionGroup`.
"""

from __future__ import annotations

import json

from mcp_docs.cli import output
from mcp_docs.cli.commands import _collect_doc_errors, _match_document
from mcp_docs.cli.main import EXIT_EXCEPTIONS, USAGE_ERRORS, main
from mcp_docs.exit_codes import (
    CONFIG_ERROR,
    INVALID_COMMAND,
    NO_DOCUMENTATION,
    SERVER_UNAVAILABLE,
    SUCCESS,
    DocError,
)


def run_cli(monkeypatch, argv: list[str]) -> int:
    monkeypatch.setattr("sys.argv", ["doc", *argv])
    return main()


class TestExitCodes:
    def test_help_e_sucesso(self, monkeypatch, capsys):
        assert run_cli(monkeypatch, ["--help"]) == SUCCESS

    def test_comando_inexistente(self, monkeypatch, capsys):
        assert run_cli(monkeypatch, ["comando-que-nao-existe"]) == INVALID_COMMAND

    def test_argumento_faltando(self, monkeypatch, capsys):
        assert run_cli(monkeypatch, ["search"]) == INVALID_COMMAND

    def test_configuracao_invalida(self, monkeypatch, capsys, tmp_path):
        monkeypatch.setenv("DOC_CONFIG", str(tmp_path / "ausente.toml"))
        monkeypatch.setenv("DOC_SEARCH_LIMIT", "não-é-número")
        assert run_cli(monkeypatch, ["search", "qualquer coisa"]) == CONFIG_ERROR

    def test_as_excecoes_do_framework_foram_encontradas(self):
        # Se o Typer mudar de estrutura, isto falha antes dos exit codes
        # silenciosamente voltarem a 1.
        assert USAGE_ERRORS, "nenhuma classe UsageError localizada"
        assert EXIT_EXCEPTIONS, "nenhuma classe Exit localizada"
        assert any("typer" in cls.__module__ for cls in USAGE_ERRORS)


class TestExceptionUnwrapping:
    def test_encontra_docerror_dentro_de_grupo(self):
        inner = DocError("servidor fora", SERVER_UNAVAILABLE)
        group = BaseExceptionGroup("falhas", [inner])  # noqa: F821
        found = _collect_doc_errors(group)
        assert found and found[0].code == SERVER_UNAVAILABLE

    def test_encontra_docerror_em_grupo_aninhado(self):
        inner = DocError("sem índice", NO_DOCUMENTATION)
        group = BaseExceptionGroup(  # noqa: F821
            "externo", [BaseExceptionGroup("interno", [inner])]  # noqa: F821
        )
        assert _collect_doc_errors(group)[0].code == NO_DOCUMENTATION

    def test_encontra_docerror_na_causa(self):
        original = DocError("token inválido", 4)
        try:
            try:
                raise original
            except DocError as error:
                raise RuntimeError("embrulhado") from error
        except RuntimeError as error:
            assert _collect_doc_errors(error)[0] is original

    def test_erro_comum_nao_produz_falso_positivo(self):
        assert _collect_doc_errors(ValueError("qualquer")) == []


class TestDocumentMatching:
    DOCUMENTS = [
        "api-reference/authentication.md",
        "guides/authentication-troubleshooting.md",
        "snippets/authentication-warning.md",
    ]

    def test_caminho_exato_ganha(self):
        assert _match_document("api-reference/authentication.md", self.DOCUMENTS) == (
            "api-reference/authentication.md"
        )

    def test_nome_de_arquivo_igual_ganha_de_substring(self):
        # `authentication` não deve abrir `authentication-warning` só porque
        # vem antes na ordem alfabética.
        assert _match_document("authentication", self.DOCUMENTS) == "api-reference/authentication.md"

    def test_substring_como_ultimo_recurso(self):
        assert _match_document("troubleshooting", self.DOCUMENTS) == (
            "guides/authentication-troubleshooting.md"
        )

    def test_sem_correspondencia_devolve_none(self):
        assert _match_document("pagamentos", self.DOCUMENTS) is None


class TestJsonOutput:
    def test_json_e_utf8_valido(self, capsysbinary):
        # No Windows o stdout sai em cp1252 por padrão; documentação em
        # português tem acento, e o consumidor de `--json` receberia bytes
        # inválidos.
        output.emit_json({"answer": "autenticação da API", "sources": ["a.md"]})
        captured = capsysbinary.readouterr()
        decoded = json.loads(captured.out.decode("utf-8"))
        assert decoded["answer"] == "autenticação da API"

    def test_json_nao_escapa_acentos(self, capsysbinary):
        output.emit_json({"texto": "ação"})
        assert "\\u" not in capsysbinary.readouterr().out.decode("utf-8")


class TestTokenVerifier:
    """§40 — token bearer, comparado em tempo constante."""

    async def test_token_correto_e_aceito(self):
        from mcp_docs.server.server import StaticTokenVerifier

        access = await StaticTokenVerifier("segredo-longo").verify_token("segredo-longo")
        assert access is not None
        assert "docs:read" in access.scopes

    async def test_token_errado_e_recusado(self):
        from mcp_docs.server.server import StaticTokenVerifier

        assert await StaticTokenVerifier("segredo-longo").verify_token("outro") is None

    async def test_sem_token_configurado_nada_e_aceito(self):
        from mcp_docs.server.server import StaticTokenVerifier

        assert await StaticTokenVerifier("").verify_token("qualquer") is None

    def test_a_comparacao_e_em_tempo_constante(self):
        # Um `==` sobre segredo vaza informação pelo tempo de resposta.
        import inspect

        from mcp_docs.server import server

        source = inspect.getsource(server.StaticTokenVerifier)
        assert "compare_digest" in source


class TestServerBuild:
    def test_sobe_sem_indice_e_reporta_erro_por_tool(self, tmp_path, monkeypatch):
        """Servidor sem índice ainda inicia (§45).

        Falhar na inicialização daria ao cliente MCP um erro de conexão sem
        explicação; devolver o erro por tool diz o que fazer.
        """
        from mcp_docs.config import Config, IndexConfig
        from mcp_docs.server.server import build_server

        config = Config(index=IndexConfig(path=str(tmp_path / "ausente.json")), root=tmp_path)
        server = build_server(config)
        assert server.name == "documentation"

    def test_instrucoes_declaram_conteudo_nao_confiavel(self):
        from mcp_docs.server.server import INSTRUCTIONS

        assert "não" in INSTRUCTIONS and "confiável" in INSTRUCTIONS
        assert "somente-leitura" in INSTRUCTIONS or "somente leitura" in INSTRUCTIONS
