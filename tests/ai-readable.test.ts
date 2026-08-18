import { describe, it, expect } from 'vitest';
import { buildLlmsFullTxt, buildLlmsTxt, toCleanMarkdown, type LlmsInput, type PageEntry } from '../src/lib/ai-readable/llms';

function page(partial: Partial<PageEntry> & { path: string; title: string }): PageEntry {
	return {
		url: `/${partial.path.replace(/\.mdx?$/, '')}/`,
		section: partial.path.includes('/') ? partial.path.split('/')[0]! : null,
		tags: [],
		body: 'Texto da página.',
		visible: true,
		locale: 'pt-BR',
		...partial,
	};
}

const input: LlmsInput = {
	siteName: 'Portal de Teste',
	description: 'Documentação de exemplo.',
	siteUrl: 'https://docs.exemplo.com',
	pages: [
		page({ path: 'guides/getting-started.md', title: 'Comece por aqui', description: 'Primeiros passos.' }),
		page({ path: 'guides/avancado.md', title: 'Avançado' }),
		page({ path: 'api-reference/auth.md', title: 'Autenticação' }),
		page({ path: 'index.mdx', title: 'Capa', url: '/' }),
	],
	glossary: [
		{ id: 'api', term: 'API', aliases: ['Application Programming Interface'], definition: 'Contratos que um sistema expõe. Segunda frase que não deve entrar no índice.' },
	],
	api: [
		{ title: 'API do portal', operations: [{ method: 'get', path: '/users/{id}', summary: 'Busca usuário' }] },
	],
	sectionLabels: { guides: 'Guias', 'api-reference': 'Referência da API' },
};

// ---------------------------------------------------------------------------
// §3 — llms.txt
// ---------------------------------------------------------------------------

describe('llms.txt', () => {
	const output = buildLlmsTxt(input);

	it('começa com o nome e o resumo do portal', () => {
		expect(output.startsWith('# Portal de Teste')).toBe(true);
		expect(output).toContain('> Documentação de exemplo.');
	});

	it('agrupa por seção, com o rótulo e não o nome da pasta', () => {
		expect(output).toContain('## Guias');
		expect(output).toContain('## Referência da API');
		expect(output).not.toContain('## guides');
	});

	it('põe as seções na ordem do portal, não em ordem alfabética', () => {
		// Guias antes de Referência: é a ordem em que se lê a documentação.
		expect(output.indexOf('## Guias')).toBeLessThan(output.indexOf('## Referência da API'));
	});

	it('usa URL absoluta — o arquivo é lido fora do site', () => {
		expect(output).toContain('https://docs.exemplo.com/guides/getting-started/');
	});

	it('traz a descrição da página quando existe', () => {
		expect(output).toContain('[Comece por aqui](https://docs.exemplo.com/guides/getting-started/): Primeiros passos.');
	});

	it('lista o glossário com uma frase por termo', () => {
		expect(output).toContain('**API**');
		expect(output).toContain('Application Programming Interface');
		expect(output).toContain('Contratos que um sistema expõe.');
		// A segunda frase da definição não entra: o índice resume.
		expect(output).not.toContain('Segunda frase');
	});

	it('lista as operações da API', () => {
		expect(output).toContain('`GET /users/{id}` — Busca usuário');
	});

	it('explica como pegar o Markdown limpo, com um exemplo real', () => {
		expect(output).toContain('/md/');
		expect(output).toContain('https://docs.exemplo.com/md/guides/getting-started.md');
	});

	it('deixa de fora tradução e página invisível', () => {
		const withExtras = buildLlmsTxt({
			...input,
			pages: [
				...input.pages,
				page({ path: 'en/guides/getting-started.md', title: 'Get started', locale: 'en' }),
				page({ path: 'guides/rascunho.md', title: 'Rascunho', visible: false }),
			],
		});

		// A tradução repetiria o mesmo conteúdo; a invisível está fora da
		// navegação e o índice para máquina segue a mesma decisão.
		expect(withExtras).not.toContain('Get started');
		expect(withExtras).not.toContain('Rascunho');
	});

	it('página fora de seção entra em "Outras páginas"', () => {
		expect(output).toContain('## Outras páginas');
		expect(output).toContain('[Capa](https://docs.exemplo.com/)');
	});

	it('seções vazias não aparecem', () => {
		const semGlossario = buildLlmsTxt({ ...input, glossary: [], api: [] });
		expect(semGlossario).not.toContain('## Glossário');
		expect(semGlossario).not.toContain('## API');
	});

	it('o grafo informa quantas páginas usam cada bloco', () => {
		const withGraph = buildLlmsTxt({
			...input,
			graph: {
				nodes: [{ key: 'snippets:aviso.md', id: 'aviso', type: 'block', root: 'snippets', path: 'aviso.md' }],
				edges: [
					{ source: 'docs:a.md', sourceId: 'a', target: 'aviso', type: 'uses', refType: 'block', resolved: true, location: { line: 1, column: 1 } },
					{ source: 'docs:b.md', sourceId: 'b', target: 'aviso', type: 'uses', refType: 'block', resolved: true, location: { line: 1, column: 1 } },
				],
				generatedAt: 0,
			} as never,
		});

		expect(withGraph).toContain('## Conteúdo reutilizável');
		expect(withGraph).toContain('`aviso` — usado por 2 página(s)');
	});
});

// ---------------------------------------------------------------------------
// §3 — llms-full.txt
// ---------------------------------------------------------------------------

describe('llms-full.txt', () => {
	const output = buildLlmsFullTxt({
		...input,
		pages: [page({ path: 'guides/a.md', title: 'Página A', body: '# Título\n\nCorpo da página A.', tags: ['guia'] })],
	});

	it('traz o corpo completo com a origem de cada página', () => {
		expect(output).toContain('Corpo da página A.');
		expect(output).toContain('URL: https://docs.exemplo.com/guides/a/');
		expect(output).toContain('Arquivo: guides/a.md');
		expect(output).toContain('Tags: guia');
	});

	it('separa as páginas', () => {
		expect(output).toContain('---');
	});

	it('inclui o glossário inteiro, não só a primeira frase', () => {
		expect(output).toContain('Segunda frase que não deve entrar no índice.');
	});
});

// ---------------------------------------------------------------------------
// §4 — Markdown limpo
// ---------------------------------------------------------------------------

describe('markdown limpo', () => {
	const mdx = page({
		path: 'guides/exemplo.mdx',
		title: 'Exemplo',
		description: 'Uma página com MDX.',
		tags: ['guia'],
		body: [
			"import Diagrama from '../../../components/docs/Diagrama.astro';",
			'',
			'Primeiro parágrafo.',
			'',
			'<Diagrama />',
			'',
			':::note[Atenção]',
			'Texto dentro do aviso.',
			':::',
			'',
			'<Card title="X">',
			'Conteúdo dentro do componente.',
			'</Card>',
			'',
			'Último parágrafo.',
		].join('\n'),
	});

	const output = toCleanMarkdown(mdx, 'https://docs.exemplo.com');

	it('começa com título, descrição e origem', () => {
		expect(output.startsWith('# Exemplo')).toBe(true);
		expect(output).toContain('> Uma página com MDX.');
		expect(output).toContain('Origem: https://docs.exemplo.com/guides/exemplo/');
		expect(output).toContain('Tags: guia');
	});

	it('tira o maquinário do MDX', () => {
		expect(output).not.toContain('import Diagrama');
		expect(output).not.toContain('<Diagrama />');
		expect(output).not.toContain('<Card');
		expect(output).not.toContain('</Card>');
		expect(output).not.toContain(':::');
	});

	it('preserva o texto que estava dentro dos componentes', () => {
		// Descartá-lo entregaria uma versão incompleta da página.
		expect(output).toContain('Texto dentro do aviso.');
		expect(output).toContain('Conteúdo dentro do componente.');
	});

	it('transforma o título do aviso em texto legível', () => {
		expect(output).toContain('**Atenção**');
	});

	it('preserva a prosa e a ordem', () => {
		expect(output.indexOf('Primeiro parágrafo.')).toBeLessThan(output.indexOf('Último parágrafo.'));
	});

	it('não deixa três quebras de linha seguidas', () => {
		expect(output).not.toMatch(/\n{3}/);
	});
});
