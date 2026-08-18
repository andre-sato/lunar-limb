import { describe, it, expect } from 'vitest';
import { suggestBranchName, validateBranchName } from '../src/lib/git/workflow';
import { parseUnifiedDiff } from '../src/lib/git/diff';
import { composePullRequestBody, compareUrl, parseRemote } from '../src/lib/git/pull-request';
import type { ImpactReport } from '../src/lib/impact/types';

// ---------------------------------------------------------------------------
// §3.1 — nomes de branch
// ---------------------------------------------------------------------------

/** Relatório de impacto mínimo, com as páginas que mudam sem aparecer no diff. */
function impactWith(hiddenPages: string[]): ImpactReport {
	const items = hiddenPages.map((path) => ({
		node: { id: `page:${path}`, type: 'page' as const, path },
		severity: 'high' as const,
		reason: 'inclui o bloco `aviso`, que foi alterado.',
		origin: 'src/content/snippets/aviso.md',
		via: [`page:${path}`, 'snippet:aviso'],
		hidden: true,
	}));

	return {
		changes: [],
		items,
		checklist: [],
		score: { value: items.length * 5, factors: [] },
		scope: 'small',
		api: { breaking: [], compatible: [] },
		glossaryTerms: [],
		counts: { critical: 0, high: items.length, medium: 0, low: 0 },
		highest: items.length > 0 ? 'high' : 'low',
		generatedAt: 0,
	};
}

describe('nome de branch', () => {
	it('aceita nomes normais', () => {
		for (const name of ['docs/autenticacao', 'feature/new-api-guide', 'fix-123', 'main']) {
			expect(validateBranchName(name), name).toEqual({ ok: true });
		}
	});

	it('recusa o que o Git recusaria', () => {
		const invalid: Array<[string, RegExp]> = [
			['', /vazio/],
			['com espaço', /espaços/],
			['tem~til', /não são aceitos/],
			['dois..pontos', /"\.\."/],
			['-começa-com-traço', /começar/],
			['termina/', /terminar/],
			['barra//dupla', /"\/\/"/],
			['algo.lock', /\.lock/],
			['ref@{0}', /@\{/],
			['@', /apenas "@"/],
		];

		for (const [name, reason] of invalid) {
			const result = validateBranchName(name);
			expect(result.ok, name).toBe(false);
			if (!result.ok) expect(result.reason, name).toMatch(reason);
		}
	});

	it('o que parece injeção cai nas regras normais do Git', () => {
		// `x; rm -rf /` é recusado por conter espaços, não por parecer perigoso.
		expect(validateBranchName('x; rm -rf /').ok).toBe(false);

		// `$(whoami)` é um nome **válido** de branch no Git, e a validação não
		// inventa restrições que o Git não tem. A segurança não vem daqui: vem de
		// `execFile` com lista de argumentos, sem shell — o nome chega ao comando
		// como texto, nunca como instrução.
		expect(validateBranchName('$(whoami)').ok).toBe(true);
	});

	it('sugere nome a partir do título', () => {
		expect(suggestBranchName('Atualizar a autenticação da API')).toBe('docs/atualizar-a-autenticacao-da-api');
		expect(suggestBranchName('  Espaços  demais  ')).toBe('docs/espacos-demais');
	});

	it('a sugestão é sempre um nome válido', () => {
		for (const title of ['Título com ~ e ^', '...', '   ', 'a'.repeat(200), 'Ação & efeito']) {
			expect(validateBranchName(suggestBranchName(title)).ok, title).toBe(true);
		}
	});
});

// ---------------------------------------------------------------------------
// §3.3 — diff
// ---------------------------------------------------------------------------

describe('leitura do diff', () => {
	const MODIFIED = `diff --git a/docs/auth.md b/docs/auth.md
index 1234567..89abcde 100644
--- a/docs/auth.md
+++ b/docs/auth.md
@@ -10,7 +10,7 @@ Introdução
 contexto antes
-Authentication requires OAuth.
+Authentication requires an API key.
 contexto depois
`;

	it('lê linhas adicionadas e removidas com a numeração certa', () => {
		const [file] = parseUnifiedDiff(MODIFIED);

		expect(file.path).toBe('docs/auth.md');
		expect(file.change).toBe('modified');
		expect(file.additions).toBe(1);
		expect(file.deletions).toBe(1);

		const added = file.lines.find((line) => line.kind === 'added');
		const removed = file.lines.find((line) => line.kind === 'removed');
		expect(added?.text).toBe('Authentication requires an API key.');
		expect(removed?.text).toBe('Authentication requires OAuth.');
		// O trecho começa na linha 10; a primeira linha é contexto.
		expect(removed?.oldLine).toBe(11);
		expect(added?.newLine).toBe(11);
	});

	it('reconhece arquivo adicionado', () => {
		const [file] = parseUnifiedDiff(`diff --git a/novo.md b/novo.md
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/novo.md
@@ -0,0 +1,2 @@
+primeira linha
+segunda linha
`);
		expect(file.change).toBe('added');
		expect(file.additions).toBe(2);
	});

	it('reconhece arquivo removido', () => {
		const [file] = parseUnifiedDiff(`diff --git a/velho.md b/velho.md
deleted file mode 100644
index 1234567..0000000
--- a/velho.md
+++ /dev/null
@@ -1,1 +0,0 @@
-linha que sai
`);
		expect(file.change).toBe('removed');
		expect(file.deletions).toBe(1);
	});

	it('reconhece renomeação e guarda o caminho anterior', () => {
		const [file] = parseUnifiedDiff(`diff --git a/antigo.md b/novo.md
similarity index 95%
rename from antigo.md
rename to novo.md
`);
		expect(file).toMatchObject({ change: 'renamed', path: 'novo.md', previousPath: 'antigo.md' });
	});

	it('marca arquivo binário em vez de tentar mostrar o conteúdo', () => {
		const [file] = parseUnifiedDiff(`diff --git a/img.png b/img.png
index 1234567..89abcde 100644
Binary files a/img.png and b/img.png differ
`);
		expect(file.binary).toBe(true);
		expect(file.lines).toHaveLength(0);
	});

	it('lê vários arquivos no mesmo diff', () => {
		const files = parseUnifiedDiff(`${MODIFIED}diff --git a/outro.md b/outro.md
index 1..2 100644
--- a/outro.md
+++ b/outro.md
@@ -1,1 +1,1 @@
-antes
+depois
`);
		expect(files.map((file) => file.path)).toEqual(['docs/auth.md', 'outro.md']);
	});

	it('diff vazio não produz arquivos', () => {
		expect(parseUnifiedDiff('')).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// §3.6, §4 — pull request
// ---------------------------------------------------------------------------

describe('remoto', () => {
	it('lê as duas formas de URL', () => {
		expect(parseRemote('https://github.com/andre-sato/lunar-limb')).toMatchObject({
			owner: 'andre-sato',
			repo: 'lunar-limb',
			host: 'github.com',
		});
		expect(parseRemote('git@github.com:andre-sato/lunar-limb.git')).toMatchObject({
			owner: 'andre-sato',
			repo: 'lunar-limb',
			url: 'https://github.com/andre-sato/lunar-limb',
		});
	});

	it('descarta credencial embutida na URL', () => {
		// Uma URL com token não pode chegar à interface nem a um log.
		const remote = parseRemote('https://usuario:token123@github.com/dono/repo.git');
		expect(remote?.url).toBe('https://github.com/dono/repo');
		expect(JSON.stringify(remote)).not.toContain('token123');
	});

	it('devolve null para o que não é remoto reconhecível', () => {
		expect(parseRemote('')).toBeNull();
		expect(parseRemote('/caminho/local')).toBeNull();
	});
});

describe('corpo do pull request', () => {
	const base = {
		title: 'Atualizar autenticação',
		description: 'Troca OAuth por chave de API.',
		base: 'main',
		head: 'docs/auth',
		changedFiles: [
			'src/content/docs/api-reference/authentication.md',
			'src/content/snippets/aviso.md',
			'astro.config.mjs',
		],
	};

	it('separa páginas, blocos e o resto', () => {
		const body = composePullRequestBody(base);
		expect(body).toContain('Páginas');
		expect(body).toContain('Blocos reutilizáveis');
		expect(body).toContain('Outros');
		expect(body).toContain('**Arquivos alterados:** 3');
	});

	it('traz a nota e marca quando ela reprova', () => {
		expect(composePullRequestBody({ ...base, score: 9.2, gatePassed: true })).toContain('9.2/10 ✅');
		expect(composePullRequestBody({ ...base, score: 6.1, gatePassed: false })).toContain('abaixo do mínimo');
	});

	it('avisa sobre páginas que mudam sem aparecer no diff', () => {
		const body = composePullRequestBody({ ...base, impact: impactWith(['guides/a.mdx', 'guides/b.mdx']) });
		expect(body).toContain('2 página(s)');
		expect(body).toContain('não aparecem no diff');
		expect(body).toContain('guides/a.mdx');
	});

	it('sem impacto, não inventa uma seção vazia', () => {
		const body = composePullRequestBody({ ...base, impact: impactWith([]) });
		expect(body).not.toContain('Documentation Impact');
		expect(body).not.toContain('Impact Score');
	});

	it('a descrição do autor vem primeiro', () => {
		const body = composePullRequestBody({ ...base, score: 9 });
		expect(body.indexOf('Troca OAuth')).toBeLessThan(body.indexOf('Quality Score'));
	});
});

describe('URL de comparação', () => {
	const remote = { url: 'https://github.com/dono/repo', owner: 'dono', repo: 'repo', host: 'github.com' };

	it('aponta para a comparação certa, com título e corpo', () => {
		const url = compareUrl(remote, {
			title: 'Atualizar docs',
			description: 'Descrição.',
			base: 'main',
			head: 'docs/x',
			changedFiles: ['src/content/docs/a.md'],
		});

		expect(url.startsWith('https://github.com/dono/repo/compare/main...docs%2Fx?')).toBe(true);
		const parameters = new URL(url).searchParams;
		expect(parameters.get('title')).toBe('Atualizar docs');
		expect(parameters.get('body')).toContain('Descrição.');
	});
});
