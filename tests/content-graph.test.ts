import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createContentFs } from '../src/lib/editor/content-fs';
import { buildGraphFrom, type ContentSources } from '../src/lib/editor/content-graph';
import { analyzeImpact, getBacklinks, getUses } from '../src/lib/editor/graph-model';

/**
 * Teste de integração da Fase 4: monta um repositório de conteúdo de verdade
 * em um diretório temporário e verifica que o grafo sai correto do disco —
 * não só dos algoritmos puros.
 */

let root: string;
let sources: ContentSources;

async function write(rel: string, content: string) {
	const abs = path.join(root, rel);
	await mkdir(path.dirname(abs), { recursive: true });
	await writeFile(abs, content, 'utf-8');
}

beforeEach(async () => {
	root = await mkdtemp(path.join(tmpdir(), 'lunar-limb-graph-'));
	sources = {
		docs: createContentFs(path.join(root, 'docs')),
		snippets: createContentFs(path.join(root, 'snippets')),
	};
	await mkdir(path.join(root, 'docs'), { recursive: true });
	await mkdir(path.join(root, 'snippets'), { recursive: true });
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe('buildGraphFrom', () => {
	it('monta nós e arestas a partir dos arquivos', async () => {
		await write(
			'snippets/authentication-warning.md',
			['---', 'title: Aviso de autenticação', '---', '', '> Autenticação é obrigatória.', ''].join('\n')
		);
		await write(
			'docs/guides/payments.mdx',
			[
				'---',
				'title: Pagamentos',
				'---',
				'',
				"import ContentBlock from '../../../components/content/ContentBlock.astro';",
				'',
				'<ContentBlock id="authentication-warning" />',
				'',
				'Texto local.',
			].join('\n')
		);

		const { graph, problems } = await buildGraphFrom(sources);

		expect(graph.nodes.map((n) => n.key).sort()).toEqual([
			'docs:guides/payments.mdx',
			'snippets:authentication-warning.md',
		]);

		const snippet = graph.nodes.find((n) => n.type === 'block')!;
		expect(snippet.id).toBe('authentication-warning');
		expect(snippet.title).toBe('Aviso de autenticação');

		expect(graph.edges).toHaveLength(1);
		expect(graph.edges[0]).toMatchObject({
			source: 'docs:guides/payments.mdx',
			target: 'authentication-warning',
			refType: 'block',
			resolved: true,
		});
		// Linha 7 do arquivo, contando o frontmatter.
		expect(graph.edges[0].location.line).toBe(7);

		expect(problems.filter((p) => p.severity === 'error')).toEqual([]);
	});

	it('resolve os dois lados: uses de uma ponta, backlinks da outra', async () => {
		await write('snippets/aviso.md', '---\ntitle: Aviso\n---\n\n> Cuidado.\n');
		await write('docs/a.mdx', '---\ntitle: A\n---\n\n<ContentBlock id="aviso" />\n');
		await write('docs/b.mdx', '---\ntitle: B\n---\n\n<ContentBlock id="aviso" />\n');

		const { graph } = await buildGraphFrom(sources);

		expect(getUses(graph, 'docs:a.mdx').map((e) => e.target)).toEqual(['aviso']);
		expect(getBacklinks(graph, 'block:aviso').map((e) => e.sourceId).sort()).toEqual(['a', 'b']);
	});

	it('conteúdo reutilizado nunca é copiado — só a referência aparece no arquivo', async () => {
		const canonico = '> Autenticação é obrigatória em todas as requisições.';
		await write('snippets/aviso.md', `---\ntitle: Aviso\n---\n\n${canonico}\n`);
		await write('docs/a.mdx', '---\ntitle: A\n---\n\n<ContentBlock id="aviso" />\n');

		const doc = await sources.docs.readDocument('a.mdx');
		expect(doc.content).not.toContain(canonico);
		expect(doc.content).toContain('<ContentBlock id="aviso" />');
	});

	it('marca referência para um id que não existe', async () => {
		await write('docs/a.mdx', '---\ntitle: A\n---\n\n<ContentBlock id="fantasma" />\n');

		const { graph, problems } = await buildGraphFrom(sources);

		expect(graph.edges[0].resolved).toBe(false);
		const broken = problems.find((p) => p.kind === 'broken-reference');
		expect(broken).toMatchObject({ severity: 'error', targetId: 'fantasma', path: 'a.mdx', root: 'docs' });
	});

	it('detecta ciclo entre snippets que se incluem', async () => {
		await write('snippets/a.mdx', '---\ntitle: A\n---\n\n<ContentBlock id="b" />\n');
		await write('snippets/b.mdx', '---\ntitle: B\n---\n\n<ContentBlock id="a" />\n');

		const { problems } = await buildGraphFrom(sources);
		const circular = problems.find((p) => p.kind === 'circular-reference');

		expect(circular).toBeDefined();
		expect(circular!.chain).toEqual(['block:a', 'block:b', 'block:a']);
	});

	it('calcula impacto transitivo através de um snippet intermediário', async () => {
		await write('snippets/base.md', '---\ntitle: Base\n---\n\n> Base.\n');
		await write('snippets/meio.mdx', '---\ntitle: Meio\n---\n\n<ContentBlock id="base" />\n');
		await write('docs/topo.mdx', '---\ntitle: Topo\n---\n\n<ContentBlock id="meio" />\n');

		const { graph } = await buildGraphFrom(sources);
		const impact = analyzeImpact(graph, 'block:base');

		expect(impact.direct.map((n) => n.id)).toEqual(['meio']);
		expect(impact.indirect.map((n) => n.id)).toEqual(['topo']);
		expect(impact.total).toBe(2);
	});

	it('sobrevive a uma collection vazia', async () => {
		const { graph, problems } = await buildGraphFrom(sources);
		expect(graph.nodes).toEqual([]);
		expect(graph.edges).toEqual([]);
		expect(problems).toEqual([]);
	});
});

describe('createContentFs (garantias de segurança usadas pelo grafo)', () => {
	it('recusa caminhos que escapam da raiz da collection', async () => {
		await expect(sources.docs.readDocument('../snippets/x.md')).rejects.toThrow(/fora da área/i);
	});

	it('ignora arquivos que não são .md/.mdx ao montar a árvore', async () => {
		await write('docs/leia.md', '---\ntitle: Leia\n---\n\ntexto\n');
		await write('docs/imagem.png', 'nao-e-markdown');

		const { graph } = await buildGraphFrom(sources);
		expect(graph.nodes.map((n) => n.path)).toEqual(['leia.md']);
	});
});
