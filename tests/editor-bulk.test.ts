import { describe, expect, it } from 'vitest';
import {
	applyReplace,
	codeBlockLines,
	fingerprintOf,
	planDelete,
	planReplace,
	type ReplacePlan,
} from '../src/lib/editor/bulk';
import {
	convertToMdx,
	escapeForMdx,
	formatOf,
	htmlToMarkdown,
	ImportError,
	slugify,
	stripFrontmatter,
	titleFrom,
} from '../src/lib/editor/import';
import type { ContentRootKey } from '../src/lib/editor/graph-model';

// ---------------------------------------------------------------------------
// Fontes de teste
// ---------------------------------------------------------------------------

const FILES: Record<string, string> = {
	'a.md': ['---', 'title: Chave', '---', '', 'Use a chave de API para autenticar.', '', '```bash', 'export CHAVE="chave de API"', '```', '', 'A chave de API expira.'].join('\n'),
	'b.md': ['---', 'title: Outro', '---', '', 'Nada aqui.'].join('\n'),
	'sub/c.md': ['---', 'title: Sub', '---', '', 'Outra chave de API.'].join('\n'),
};

function sources() {
	const tree = Object.keys(FILES).map((path) => ({ type: 'file' as const, name: path, path }));
	const collection = {
		getTree: async () => tree,
		readDocument: async (path: string) => ({ content: FILES[path] ?? '' }),
	};
	return { docs: collection, snippets: { getTree: async () => [], readDocument: async () => ({ content: '' }) } } as never;
}

const read = async (_root: ContentRootKey, path: string) => FILES[path] ?? '';

// ---------------------------------------------------------------------------

describe('cercas de código', () => {
	it('marca as linhas da cerca e o que está dentro', () => {
		const inside = codeBlockLines(['linha 1', '```js', 'const x = 1;', '```', 'linha 5'].join('\n'));
		expect([...inside].sort((a, b) => a - b)).toEqual([2, 3, 4]);
	});

	it('lida com cercas de til', () => {
		expect(codeBlockLines(['a', '~~~', 'b', '~~~'].join('\n')).has(3)).toBe(true);
	});
});

describe('planejar substituição', () => {
	it('não escreve nada e devolve o antes e o depois de cada linha', async () => {
		const plan = await planReplace({
			query: 'chave de API',
			replacement: 'credencial',
			options: { sources: sources() },
			read,
		});

		const a = plan.files.find((file) => file.path === 'a.md');
		expect(a?.occurrences[0].before).toContain('chave de API');
		expect(a?.occurrences[0].after).toContain('credencial');
		// O arquivo em disco continua como estava.
		expect(FILES['a.md']).toContain('chave de API');
	});

	// A decisão que mais protege: prosa substituída dentro de um exemplo quebra
	// o exemplo, que é a parte da página que alguém copia.
	it('deixa blocos de código de fora por padrão, e relata', async () => {
		const plan = await planReplace({
			query: 'chave de API',
			replacement: 'credencial',
			options: { sources: sources() },
			read,
		});

		const linhas = plan.files.find((file) => file.path === 'a.md')?.occurrences.map((o) => o.line) ?? [];
		expect(linhas).not.toContain(8);
		expect(plan.skipped.some((s) => s.reason === 'dentro de bloco de código')).toBe(true);
	});

	it('inclui blocos de código quando pedido', async () => {
		const plan = await planReplace({
			query: 'chave de API',
			replacement: 'credencial',
			options: { sources: sources(), includeCodeBlocks: true },
			read,
		});
		expect(plan.files.find((file) => file.path === 'a.md')?.occurrences.some((o) => o.inCodeBlock)).toBe(true);
	});

	it('restringe a uma pasta', async () => {
		const plan = await planReplace({
			query: 'chave de API',
			replacement: 'credencial',
			options: { sources: sources(), folder: 'sub/' },
			read,
		});
		expect(plan.files.map((file) => file.path)).toEqual(['sub/c.md']);
	});

	it('recusa termo vazio', async () => {
		await expect(planReplace({ query: '', replacement: 'x', options: { sources: sources() }, read }))
			.rejects.toThrow();
	});
});

describe('aplicar substituição', () => {
	async function planAndApply(overrides: Partial<{ current: string; only: string[] }> = {}) {
		const plan = await planReplace({
			query: 'chave de API',
			replacement: 'credencial',
			options: { sources: sources() },
			read,
		});

		const written: Record<string, string> = {};
		const result = await applyReplace({
			plan,
			read: async (_root, path) => overrides.current ?? FILES[path] ?? '',
			write: async (_root, path, content) => { written[path] = content; },
			only: overrides.only,
		});

		return { plan, result, written };
	}

	it('escreve só o que o plano previu', async () => {
		const { result, written } = await planAndApply();
		expect(result.applied.map((entry) => entry.path).sort()).toEqual(['a.md', 'sub/c.md']);
		expect(written['a.md']).toContain('credencial');
		// A linha dentro da cerca continua intacta.
		expect(written['a.md']).toContain('export CHAVE="chave de API"');
	});

	// Sem isto a prévia mente, e uma prévia que mente é pior que nenhuma.
	it('pula arquivo que mudou entre a prévia e a aplicação', async () => {
		const { result, written } = await planAndApply({ current: 'conteúdo totalmente diferente' });
		expect(result.stale.length).toBeGreaterThan(0);
		expect(Object.keys(written)).toHaveLength(0);
	});

	it('aplica só os caminhos selecionados', async () => {
		const { result } = await planAndApply({ only: ['sub/c.md'] });
		expect(result.applied.map((entry) => entry.path)).toEqual(['sub/c.md']);
	});

	it('preserva o fim de linha do arquivo', async () => {
		const crlf = 'Use a chave de API.\r\nOutra linha.';
		const plan: ReplacePlan = {
			query: 'chave de API', replacement: 'credencial', options: {}, totalOccurrences: 1, skipped: [],
			files: [{ path: 'x.md', root: 'docs', fingerprint: fingerprintOf(crlf),
				occurrences: [{ line: 1, before: 'Use a chave de API.', after: 'Use a credencial.', inFrontmatter: false, inCodeBlock: false }] }],
		};

		let saida = '';
		await applyReplace({ plan, read: async () => crlf, write: async (_r, _p, content) => { saida = content; } });
		// Reescrever CRLF como LF marcaria todas as linhas como alteradas no diff.
		expect(saida).toContain('\r\n');
	});
});

describe('planejar exclusão', () => {
	const alvos = [
		{ path: 'guia.md', root: 'docs' as ContentRootKey },
		{ path: 'aviso.md', root: 'snippets' as ContentRootKey },
	];

	it('avisa quando alguém de fora do lote depende do arquivo', () => {
		const plan = planDelete(alvos, (target) =>
			target.path === 'aviso.md' ? ['docs:outra-pagina.md'] : []
		);
		expect(plan.breaking.map((entry) => entry.path)).toEqual(['aviso.md']);
	});

	// A distinção que evita alarme inútil: quem some junto não é problema.
	it('não avisa quando o dependente sai no mesmo lote', () => {
		const plan = planDelete(alvos, (target) =>
			target.path === 'aviso.md' ? ['docs:guia.md'] : []
		);
		expect(plan.breaking).toHaveLength(0);
		expect(plan.targets.find((t) => t.path === 'aviso.md')?.dependentsInsideBatch).toBe(true);
	});

	it('conta o lote inteiro', () => {
		expect(planDelete(alvos, () => []).total).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// Importação
// ---------------------------------------------------------------------------

describe('importar e converter', () => {
	it('aceita as extensões declaradas e recusa o resto', () => {
		expect(formatOf('a.md')).toBe('markdown');
		expect(formatOf('a.txt')).toBe('text');
		expect(formatOf('a.HTML')).toBe('html');
		expect(() => formatOf('a.docx')).toThrow(ImportError);
		expect(() => formatOf('semextensao')).toThrow(ImportError);
	});

	it('gera caminho seguro a partir do nome', () => {
		expect(slugify('Guia de Início.md')).toBe('guia-de-inicio');
		// Nome de upload é entrada de fora: não pode virar caminho.
		expect(slugify('../../etc/passwd.txt')).toBe('etc-passwd');
		expect(() => slugify('...md')).toThrow(ImportError);
	});

	it('deriva um título legível', () => {
		expect(titleFrom('guia-de-inicio.md')).toBe('Guia de inicio');
	});

	it('aproveita o frontmatter que já existia', () => {
		const { existing, body } = stripFrontmatter('---\ntitle: Meu guia\ndescription: Algo\n---\n\nCorpo.');
		expect(existing).toMatchObject({ title: 'Meu guia', description: 'Algo' });
		expect(body.trim()).toBe('Corpo.');
	});

	it('converte as marcações comuns de HTML', () => {
		const md = htmlToMarkdown('<h2>Título</h2><p>Texto <strong>forte</strong> e <a href="/x">link</a>.</p>');
		expect(md).toContain('## Título');
		expect(md).toContain('**forte**');
		expect(md).toContain('[link](/x)');
	});

	it('descarta script e style, e não perde o resto', () => {
		const md = htmlToMarkdown('<script>alert(1)</script><p>Fica</p><style>a{}</style>');
		expect(md).not.toContain('alert');
		expect(md).toContain('Fica');
	});

	// Chave solta derruba o build da página inteira no MDX.
	it('escapa chaves fora de bloco de código', () => {
		expect(escapeForMdx('Use {valor} aqui')).toBe('Use \\{valor\\} aqui');
	});

	it('não escapa dentro de bloco de código', () => {
		const saida = escapeForMdx('```js\nconst a = {b: 1};\n```');
		expect(saida).toContain('{b: 1}');
		expect(saida).not.toContain('\\{');
	});

	it('produz frontmatter válido e registra o que precisa de revisão', () => {
		const resultado = convertToMdx({ filename: 'Notas da Reunião.txt', content: 'Primeiro parágrafo.', folder: 'guides' });
		expect(resultado.path).toBe('guides/notas-da-reuniao.mdx');
		expect(resultado.content).toContain('title: "Notas da reuniao"');
		expect(resultado.notes.some((note) => note.includes('Sem descrição'))).toBe(true);
		expect(resultado.notes.some((note) => note.includes('Texto puro'))).toBe(true);
	});
});
