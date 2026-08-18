/**
 * Testes da Documentation Test Suite (§16).
 *
 * Uma suíte de testes que ninguém testou é a mais perigosa de todas: quando ela
 * diz "aprovado", vira licença para não olhar. Então cada verificação aqui é
 * exercitada nas duas direções — o caso que deve passar e o caso que deve
 * reprovar — e o que é pulado tem de declarar por quê.
 */

import { describe, it, expect } from 'vitest';
import {
	checkApiExamples,
	checkExternalLinks,
	checkGraph,
	checkLinks,
	checkSnippets,
	extractLinks,
	extractSnippets,
	externalLinks,
	headingAnchors,
	slugifyHeading,
	validateAgainstSchema,
	type PageIndex,
} from '../src/lib/doctest/checks';
import { PROFILE_CATEGORIES, summarize } from '../src/lib/doctest/types';

function index(pages: Record<string, string[]>): PageIndex {
	return {
		urls: new Set(Object.keys(pages)),
		anchors: new Map(Object.entries(pages).map(([url, anchors]) => [url, new Set(anchors)])),
	};
}

// ---------------------------------------------------------------------------
// Extração de links (§4)
// ---------------------------------------------------------------------------

describe('extração de links', () => {
	it('encontra link com título e ignora imagem inline', () => {
		const links = extractLinks('Veja [a página](/guides/x/ "título") agora.');
		expect(links).toHaveLength(1);
		expect(links[0]).toMatchObject({ href: '/guides/x/', text: 'a página', line: 1 });
	});

	it('não confunde exemplo de sintaxe dentro de bloco de código com link', () => {
		const body = ['Antes.', '```markdown', '[exemplo](/nao-existe/)', '```', 'Depois.'].join('\n');
		expect(extractLinks(body)).toHaveLength(0);
	});

	it('nem código inline', () => {
		expect(extractLinks('Escreva `[texto](/destino/)` para criar um link.')).toHaveLength(0);
	});

	it('registra a linha certa em documento com várias', () => {
		const body = ['# Título', '', 'Parágrafo.', '', 'Veja [aqui](/a/).'].join('\n');
		expect(extractLinks(body)[0].line).toBe(5);
	});
});

// ---------------------------------------------------------------------------
// Âncoras
// ---------------------------------------------------------------------------

describe('âncoras', () => {
	it('gera o mesmo formato da Starlight, dobrando acento', () => {
		expect(slugifyHeading('Criando uma página')).toBe('criando-uma-pagina');
		expect(slugifyHeading('Configuração & Deploy')).toBe('configuracao-deploy');
	});

	it('coleta títulos e ignora os que estão dentro de bloco de código', () => {
		const body = ['# Um', '```bash', '# comentário de shell', '```', '## Dois'].join('\n');
		expect([...headingAnchors(body)]).toEqual(['um', 'dois']);
	});
});

describe('DOC-LINK-001 e DOC-LINK-002', () => {
	const pages = index({ '/guides/x/': ['primeiro-passo'], '/api-reference/': [] });

	it('aprova link para página existente', () => {
		const results = checkLinks('guides/y.mdx', 'Veja [x](/guides/x/).', pages);
		expect(results.every((result) => result.status === 'pass')).toBe(true);
	});

	it('reprova link para página inexistente e diz onde', () => {
		const results = checkLinks('guides/y.mdx', '\n\nVeja [z](/guides/z/).', pages);
		expect(results[0]).toMatchObject({ id: 'DOC-LINK-001', status: 'fail' });
		expect(results[0].location).toMatchObject({ path: 'guides/y.mdx', line: 3 });
	});

	it('aceita barra final ausente e query', () => {
		expect(checkLinks('a.md', '[x](/guides/x?tab=1)', pages)[0].status).toBe('pass');
	});

	it('reprova âncora que não existe na página de destino', () => {
		const results = checkLinks('a.md', '[x](/guides/x/#passo-inexistente)', pages);
		expect(results.find((result) => result.id === 'DOC-LINK-002')).toMatchObject({ status: 'fail' });
	});

	it('aprova âncora acentuada escrita no link contra o título correspondente', () => {
		// O caso que a suíte pegou errado na primeira execução: o navegador dobra o
		// acento, e a comparação tem de dobrar também.
		const body = ['## Criando uma página', '', 'Veja [acima](#criando-uma-página).'].join('\n');
		const results = checkLinks('guides/manual.mdx', body, index({}));
		expect(results.find((result) => result.id === 'DOC-LINK-002')).toMatchObject({ status: 'pass' });
	});

	it('âncora da própria página funciona em arquivo index', () => {
		// `index.md` publica em `/guides/`, não em `/guides/index/`. Derivar a URL do
		// caminho quebraria aqui; por isso as âncoras próprias vêm do corpo.
		const body = ['## Visão geral', '', '[ir](#visão-geral)'].join('\n');
		expect(checkLinks('guides/index.md', body, index({}))[0].status).toBe('pass');
	});

	it('não avalia link externo, e-mail nem âncora de outro protocolo', () => {
		const body = '[a](https://exemplo.com) [b](mailto:x@exemplo.com) [c](//cdn.exemplo.com/x)';
		expect(checkLinks('a.md', body, pages)).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Content Graph (§10)
// ---------------------------------------------------------------------------

describe('DOC-GRAPH-001', () => {
	it('sem problemas, um resultado aprovado', () => {
		expect(checkGraph([])).toEqual([
			{ id: 'DOC-GRAPH-001', category: 'graph', status: 'pass', name: 'referências de conteúdo' },
		]);
	});

	it('erro do grafo reprova', () => {
		const results = checkGraph([{ kind: 'missing-snippet', severity: 'error', message: 'bloco ausente', path: 'a.md' }]);
		expect(results[0]).toMatchObject({ status: 'fail', message: 'bloco ausente' });
	});

	it('aviso do grafo não reprova, mas declara o motivo', () => {
		// Página órfã é informação para quem escreve, não defeito de comportamento.
		const results = checkGraph([{ kind: 'orphan', severity: 'warning', message: 'sem entrada' }]);
		expect(results[0].status).toBe('skip');
		expect(results[0].skipReason).toContain('warning');
	});
});

// ---------------------------------------------------------------------------
// API (§5, §6)
// ---------------------------------------------------------------------------

describe('validação contra schema', () => {
	const schema = {
		type: 'object',
		required: ['email'],
		properties: { email: { type: 'string' }, papel: { type: 'string', enum: ['admin', 'viewer'] } },
	};

	it('aceita exemplo compatível', () => {
		expect(validateAgainstSchema({ email: 'a@exemplo.com', papel: 'admin' }, schema)).toEqual([]);
	});

	it('acusa campo obrigatório ausente', () => {
		const violations = validateAgainstSchema({ papel: 'admin' }, schema);
		expect(violations).toHaveLength(1);
		expect(violations[0].message).toContain('email');
	});

	it('acusa tipo errado apontando o campo', () => {
		const violations = validateAgainstSchema({ email: 42 }, schema);
		expect(violations[0].pointer).toContain('email');
	});

	it('acusa valor fora do enum', () => {
		const violations = validateAgainstSchema({ email: 'a@b.co', papel: 'root' }, schema);
		expect(violations.some((violation) => violation.message.includes('enum'))).toBe(true);
	});

	it('sem schema, nada a verificar — e não inventa aprovação', () => {
		expect(validateAgainstSchema({ qualquer: 1 }, undefined)).toEqual([]);
	});
});

describe('DOC-API-003', () => {
	const base = { source: 'src/schemas/x.yaml', operation: 'POST /users', status: 'requisição' };

	it('exemplo que bate com o contrato passa', () => {
		const results = checkApiExamples([
			{ ...base, example: { email: 'a@b.co' }, schema: { type: 'object', required: ['email'] } },
		]);
		expect(results[0].status).toBe('pass');
	});

	it('exemplo que envelheceu em relação ao contrato reprova', () => {
		const results = checkApiExamples([
			{ ...base, example: { mail: 'a@b.co' }, schema: { type: 'object', required: ['email'] } },
		]);
		expect(results[0]).toMatchObject({ id: 'DOC-API-003', status: 'fail' });
	});
});

// ---------------------------------------------------------------------------
// Snippets (§7, §8)
// ---------------------------------------------------------------------------

describe('extração de snippets', () => {
	it('reconhece o marcador na cerca', () => {
		const snippets = extractSnippets(['```python test', 'print(1)', '```'].join('\n'));
		expect(snippets[0]).toMatchObject({ language: 'python', executable: true, enabled: true });
	});

	it('bloco sem marcador não é executável', () => {
		expect(extractSnippets(['```python', 'print(1)', '```'].join('\n'))[0].executable).toBe(false);
	});

	it('@test: false desliga o bloco', () => {
		const snippets = extractSnippets(['```python test', '# @test: false', 'print(1)', '```'].join('\n'));
		expect(snippets[0].enabled).toBe(false);
	});

	it('lê saída e código de saída esperados', () => {
		const snippets = extractSnippets(
			['```bash test', '# @expect-output: ok', '# @expect-exit: 0', 'echo ok', '```'].join('\n')
		);
		expect(snippets[0]).toMatchObject({ expectedOutput: 'ok', expectedExit: 0 });
	});

	it('cerca de quatro crases fecha só com quatro', () => {
		const snippets = extractSnippets(['````markdown test', '```bash', 'echo 1', '```', '````'].join('\n'));
		expect(snippets).toHaveLength(1);
		expect(snippets[0].code).toContain('echo 1');
	});
});

describe('DOC-SNIPPET-001', () => {
	it('página sem bloco executável não gera resultado nenhum', () => {
		expect(checkSnippets('a.md', extractSnippets('```bash\necho 1\n```'))).toEqual([]);
	});

	it('execução não acontece por padrão — o bloco é pulado com o motivo', () => {
		// Rodar código vindo de arquivo de conteúdo é execução arbitrária. Se este
		// teste algum dia passar a esperar `pass`, alguém ligou isso por padrão.
		const results = checkSnippets('a.md', extractSnippets('```bash test\necho 1\n```'));
		expect(results[0].status).toBe('skip');
		expect(results[0].skipReason).toMatch(/execução desligada/);
	});

	it('bloco marcado como executável e vazio reprova', () => {
		const results = checkSnippets('a.md', extractSnippets('```bash test\n\n```'));
		expect(results[0].status).toBe('fail');
	});

	it('bloco executável sem linguagem reprova', () => {
		const results = checkSnippets('a.md', extractSnippets('``` test\necho 1\n```'));
		expect(results[0]).toMatchObject({ status: 'fail', name: 'bloco sem linguagem' });
	});

	it('bloco desligado é pulado, não reprovado', () => {
		const results = checkSnippets('a.md', extractSnippets('```bash test\n# @test: false\necho 1\n```'));
		expect(results[0].status).toBe('skip');
	});
});

// ---------------------------------------------------------------------------
// Links externos (§9)
// ---------------------------------------------------------------------------

describe('DOC-LINK-003', () => {
	it('coleta só http e https', () => {
		const links = externalLinks('a.md', '[a](https://exemplo.com) [b](/interno/) [c](mailto:x@y.co)');
		expect(links.map((link) => link.url)).toEqual(['https://exemplo.com']);
	});

	it('sem link externo, um pulado explicando', async () => {
		const results = await checkExternalLinks([], async () => ({ status: 200 }));
		expect(results[0]).toMatchObject({ status: 'skip' });
		expect(results[0].skipReason).toBeTruthy();
	});

	it('sonda cada URL uma única vez, mesmo citada em várias páginas', async () => {
		const seen: string[] = [];
		const links = [
			{ url: 'https://exemplo.com', location: { path: 'a.md' } },
			{ url: 'https://exemplo.com', location: { path: 'b.md' } },
		];
		await checkExternalLinks(links, async (url) => {
			seen.push(url);
			return { status: 200 };
		});
		expect(seen).toEqual(['https://exemplo.com']);
	});

	it('404, 410 e 5xx reprovam', async () => {
		for (const status of [404, 410, 500, 503]) {
			const results = await checkExternalLinks([{ url: 'https://x.co', location: { path: 'a.md' } }], async () => ({
				status,
			}));
			expect(results[0].status, `status ${status}`).toBe('fail');
		}
	});

	it('403 e 429 não reprovam: é bloqueio a robô, não link morto', async () => {
		for (const status of [401, 403, 429]) {
			const results = await checkExternalLinks([{ url: 'https://x.co', location: { path: 'a.md' } }], async () => ({
				status,
			}));
			expect(results[0].status, `status ${status}`).toBe('skip');
		}
	});

	it('falha de transporte reprova e diz o que aconteceu', async () => {
		const results = await checkExternalLinks([{ url: 'https://x.co', location: { path: 'a.md' } }], async () => ({
			error: 'tempo esgotado',
		}));
		expect(results[0]).toMatchObject({ status: 'fail' });
		expect(results[0].message).toContain('tempo esgotado');
	});

	it('redirecionamento é aprovado: é o que o leitor vive', async () => {
		const results = await checkExternalLinks([{ url: 'https://x.co', location: { path: 'a.md' } }], async () => ({
			status: 301,
		}));
		expect(results[0].status).toBe('pass');
	});
});

// ---------------------------------------------------------------------------
// Perfis e resumo (§11)
// ---------------------------------------------------------------------------

describe('perfis', () => {
	it('cada perfil contém o anterior', () => {
		for (const category of PROFILE_CATEGORIES.quick) {
			expect(PROFILE_CATEGORIES.standard).toContain(category);
		}
		for (const category of PROFILE_CATEGORIES.standard) {
			expect(PROFILE_CATEGORIES.strict).toContain(category);
		}
	});

	it('o perfil rápido não toca a rede', () => {
		expect(PROFILE_CATEGORIES.quick).not.toContain('external');
		expect(PROFILE_CATEGORIES.quick).not.toContain('runtime');
	});
});

describe('resumo', () => {
	it('conta cada estado e aprova quando ninguém falhou', () => {
		const summary = summarize(
			[
				{ id: 'a', category: 'link', status: 'pass', name: 'a' },
				{ id: 'b', category: 'link', status: 'skip', name: 'b', skipReason: 'x' },
			],
			10
		);
		expect(summary).toMatchObject({ total: 2, passed: 1, skipped: 1, failed: 0, passing: true });
	});

	it('uma falha reprova o conjunto', () => {
		const summary = summarize([{ id: 'a', category: 'link', status: 'fail', name: 'a' }], 1);
		expect(summary.passing).toBe(false);
	});

	it('pulado sozinho não reprova — e também não vira aprovação silenciosa', () => {
		const summary = summarize([{ id: 'a', category: 'runtime', status: 'skip', name: 'a', skipReason: 'x' }], 1);
		expect(summary.passing).toBe(true);
		expect(summary.passed).toBe(0);
	});
});
