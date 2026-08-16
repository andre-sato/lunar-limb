import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { conditionalBlock, detachReferenceAt, ensureMdxImport, referenceTag } from '../src/components/editor/insert-helpers';
import { extractReferences } from '../src/lib/editor/graph-model';
import { createContentFs } from '../src/lib/editor/content-fs';
import { searchContent } from '../src/lib/editor/search';

describe('conditionalBlock', () => {
	it('separa o corpo da tag por linha em branco — o MDX exige isso para tratar o conteúdo como Markdown', () => {
		const block = conditionalBlock('beta', '**texto**');
		expect(block).toBe('<If flag="beta">\n\n**texto**\n\n</If>');
	});

	it('sem seleção, deixa um corpo de exemplo em vez de bloco vazio', () => {
		expect(conditionalBlock('beta', '   ')).toContain('Conteúdo condicional.');
	});

	it('monta os atributos equals e not', () => {
		expect(conditionalBlock('plano', 'x', { equals: 'enterprise' })).toContain('<If flag="plano" equals="enterprise">');
		expect(conditionalBlock('beta', 'x', { not: true })).toContain('<If flag="beta" not>');
	});
});

describe('detachReferenceAt', () => {
	/** Faz o que o editor faz: acha a referência e destaca pela posição dela. */
	function detachFirst(content: string, body: string): string {
		const ref = extractReferences(content)[0];
		return detachReferenceAt(content, ref.location.offset, ref.raw.length, body);
	}

	it('troca a tag pelo conteúdo canônico', () => {
		const content = 'Antes\n\n<ContentBlock id="aviso" />\n\nDepois';
		const result = detachFirst(content, '> Cuidado.\n');
		expect(result).toBe('Antes\n\n> Cuidado.\n\nDepois');
		expect(result).not.toContain('ContentBlock');
	});

	/**
	 * Regressão: a primeira versão procurava a tag com `indexOf`. Numa página que
	 * documenta a própria sintaxe, a mesma tag aparece antes dentro de um bloco de
	 * código — e o Detach reescrevia o exemplo em vez da referência de verdade.
	 */
	it('não toca na tag de exemplo dentro de um bloco de código', () => {
		const content = [
			'```mdx',
			'<ContentBlock id="rate-limit" />',
			'```',
			'',
			'<ContentBlock id="rate-limit" />',
		].join('\n');

		const result = detachFirst(content, 'TEXTO CANÔNICO');

		// O exemplo continua intacto…
		expect(result).toContain('```mdx\n<ContentBlock id="rate-limit" />\n```');
		// …e a referência real virou texto local.
		expect(result.endsWith('TEXTO CANÔNICO')).toBe(true);
	});

	it('respeita a grafia exata da tag, com ou sem barra final', () => {
		const content = '<ContentBlock id="a">';
		const ref = extractReferences(content)[0];
		expect(detachReferenceAt(content, ref.location.offset, ref.raw.length, 'CORPO')).toBe('CORPO');
	});

	it('offset fora do conteúdo devolve o texto intacto', () => {
		expect(detachReferenceAt('curto', 999, 10, 'x')).toBe('curto');
	});

	it('destaca só a referência escolhida, deixando as outras', () => {
		const tag = referenceTag('ContentBlock', 'a');
		const content = `${tag}\n\n${tag}`;
		expect(detachFirst(content, 'CORPO')).toBe(`CORPO\n\n${tag}`);
	});
});

describe('ensureMdxImport com If', () => {
	it('adiciona o import de If logo depois do frontmatter', () => {
		const content = '---\ntitle: A\n---\n\nTexto.\n';
		const result = ensureMdxImport(content, 'guides/a.mdx', 'If');
		// guides/ -> docs/ -> content/ -> src/, e então components/content.
		expect(result).toContain("import If from '../../../components/content/If.astro';");
		expect(result.indexOf('import If')).toBeLessThan(result.indexOf('Texto.'));
	});

	it('não duplica um import já presente', () => {
		const content = '---\ntitle: A\n---\n\nimport If from \'../../components/content/If.astro\';\n\nTexto.\n';
		const result = ensureMdxImport(content, 'guides/a.mdx', 'If');
		expect(result.match(/import If from/g)).toHaveLength(1);
	});
});

describe('searchContent', () => {
	async function fixture() {
		const root = await mkdtemp(path.join(tmpdir(), 'lunar-limb-search-'));
		await mkdir(path.join(root, 'docs', 'guides'), { recursive: true });
		await mkdir(path.join(root, 'snippets'), { recursive: true });
		await writeFile(
			path.join(root, 'docs', 'guides', 'a.mdx'),
			['---', 'title: Autenticação', '---', '', 'Texto sobre autenticação aqui.', ''].join('\n'),
			'utf-8'
		);
		await writeFile(
			path.join(root, 'snippets', 'aviso.md'),
			['---', 'title: Aviso', '---', '', 'Exige autenticação.', ''].join('\n'),
			'utf-8'
		);
		return {
			root,
			sources: {
				docs: createContentFs(path.join(root, 'docs')),
				snippets: createContentFs(path.join(root, 'snippets')),
			},
		};
	}

	it('encontra ocorrências com linha e posição, e marca as do frontmatter', async () => {
		const { root, sources } = await fixture();
		try {
			const hits = await searchContent('autenticação', { sources });

			// title no frontmatter + corpo do doc + corpo do snippet.
			expect(hits).toHaveLength(3);

			const frontmatterHit = hits.find((h) => h.inFrontmatter)!;
			expect(frontmatterHit.line).toBe(2);
			expect(frontmatterHit.path).toBe('guides/a.mdx');

			const bodyHit = hits.find((h) => !h.inFrontmatter && h.path === 'guides/a.mdx')!;
			expect(bodyHit.line).toBe(5);
			expect(bodyHit.root).toBe('docs');
			expect(bodyHit.text.slice(bodyHit.matchStart, bodyHit.matchStart + bodyHit.matchLength).toLowerCase()).toBe(
				'autenticação'
			);

			expect(hits.some((h) => h.root === 'snippets')).toBe(true);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it('é insensível a maiúsculas por padrão, e sensível quando pedido', async () => {
		const { root, sources } = await fixture();
		try {
			expect(await searchContent('AUTENTICAÇÃO', { sources })).toHaveLength(3);
			expect(await searchContent('AUTENTICAÇÃO', { sources, caseSensitive: true })).toHaveLength(0);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it('termo vazio não devolve nada', async () => {
		expect(await searchContent('   ')).toEqual([]);
	});
});
