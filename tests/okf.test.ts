import { describe, expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildBundle, groupTranslations, renderBundle } from '../src/lib/okf/bundle';
import { buildRouteMap, rewriteLinks } from '../src/lib/okf/links';
import { frontmatterObject, serializeConcept, serializeIndex, serializeLog } from '../src/lib/okf/serialize';
import {
	bundlePathOf,
	routeOf,
	statusOf,
	typeOf,
	verificationsOf,
} from '../src/lib/okf/derive';
import { isHumanActor, trustTierOf, OKF_VERSION } from '../src/lib/okf/types';
import { validateBundle, type OkfFile } from '../src/lib/okf/validate';
import { DEFAULT_CONFIG } from '../src/lib/governance/types';
import type { SourceDocument } from '../src/lib/okf/collect';

const NOW = Date.UTC(2026, 7, 22, 12, 0, 0);

const COLLECTION_ROOT = {
	docs: 'src/content/docs',
	glossary: 'src/content/glossary',
	snippets: 'src/content/snippets',
} as const;

function doc(overrides: Partial<SourceDocument> = {}): SourceDocument {
	const base: SourceDocument = {
		relativePath: 'guides/exemplo.mdx',
		repoPath: '',
		frontmatter: { title: 'Exemplo', description: 'Uma página.' },
		body: 'Corpo.',
		modifiedAt: '2026-08-01T00:00:00.000Z',
		locale: 'pt-BR',
		collection: 'docs',
		...overrides,
	};

	// Derivado, e não fixo, para que sobrescrever `relativePath` num teste não
	// deixe o `repoPath` apontando para o arquivo do caso anterior.
	return {
		...base,
		repoPath: overrides.repoPath ?? `${COLLECTION_ROOT[base.collection]}/${base.relativePath}`,
	};
}

describe('conformidade', () => {
	it('reprova conceito sem `type` — a única exigência do formato', () => {
		const files: OkfFile[] = [{ path: 'guides/x.md', contents: '---\ntitle: X\n---\n\nCorpo.\n' }];
		const result = validateBundle(files);

		expect(result.conformant).toBe(false);
		expect(result.findings.map((finding) => finding.rule)).toContain('type-required');
	});

	it('reprova conceito sem frontmatter', () => {
		const result = validateBundle([{ path: 'guides/x.md', contents: 'Só corpo.\n' }]);

		expect(result.conformant).toBe(false);
		expect(result.findings[0]?.rule).toBe('frontmatter-required');
	});

	it('aprova conceito com `type` e mais nada', () => {
		const result = validateBundle([{ path: 'guides/x.md', contents: '---\ntype: Guide\n---\n\nCorpo.\n' }]);

		expect(result.conformant).toBe(true);
		expect(result.concepts).toBe(1);
	});

	it('não exige `type` de arquivo reservado', () => {
		const files: OkfFile[] = [
			{ path: 'index.md', contents: '---\nokf_version: "0.2"\n---\n\n# Tudo\n' },
			{ path: 'log.md', contents: '# 2026-08-22\n\n**Update** Gerado.\n' },
		];

		expect(validateBundle(files).conformant).toBe(true);
	});

	it('não reprova por tipo desconhecido nem por chave desconhecida', () => {
		const contents = '---\ntype: Coisa Que Ninguém Registrou\nchave_esquisita: 1\n---\n\nCorpo.\n';

		expect(validateBundle([{ path: 'x.md', contents }]).conformant).toBe(true);
	});

	it('trata link quebrado como aviso, nunca como erro', () => {
		const contents = '---\ntype: Guide\n---\n\nVeja [outro](/nao-existe.md).\n';
		const result = validateBundle([{ path: 'x.md', contents }]);

		expect(result.conformant).toBe(true);
		expect(result.findings.map((finding) => finding.rule)).toContain('link-resolves');
	});

	it('recusa `okf_version` fora da raiz do bundle', () => {
		const files: OkfFile[] = [
			{ path: 'index.md', contents: '---\nokf_version: "0.2"\n---\n\n# Raiz\n' },
			{ path: 'guides/index.md', contents: '---\nokf_version: "0.2"\n---\n\n# Guias\n' },
		];
		const result = validateBundle(files);

		expect(result.conformant).toBe(false);
		expect(result.findings.map((finding) => finding.rule)).toContain('okf-version-root-only');
	});

	it('avisa sobre `timestamp` da v0.1 sem o `generated` da v0.2', () => {
		const contents = '---\ntype: Guide\ntimestamp: 2026-05-28T14:30:00Z\n---\n\nCorpo.\n';
		const rules = validateBundle([{ path: 'x.md', contents }]).findings.map((finding) => finding.rule);

		expect(rules).toContain('v01-timestamp');
	});

	it('avisa quando o log não está em ordem decrescente', () => {
		const contents = '# 2026-01-01\n\n**Update** Antigo.\n\n# 2026-08-22\n\n**Update** Novo.\n';
		const rules = validateBundle([{ path: 'log.md', contents }]).findings.map((finding) => finding.rule);

		expect(rules).toContain('log-newest-first');
	});
});

describe('níveis de confiança', () => {
	it('sem `verified` é não verificado', () => {
		expect(trustTierOf(undefined)).toBe('unverified');
		expect(trustTierOf([])).toBe('unverified');
	});

	it('ator de processo é confirmado por máquina', () => {
		expect(trustTierOf([{ by: 'process:noturno', at: '2026-08-01T00:00:00.000Z' }])).toBe(
			'machine-confirmed'
		);
	});

	it('uma pessoa entre os atores basta para revisado por humano', () => {
		const verified = [
			{ by: 'process:noturno', at: '2026-08-01T00:00:00.000Z' },
			{ by: 'human:ana', at: '2026-08-02T00:00:00.000Z' },
		];

		expect(trustTierOf(verified)).toBe('human-reviewed');
	});

	it('`human:` vazio não conta como pessoa', () => {
		expect(isHumanActor('human:')).toBe(false);
		expect(isHumanActor('human:ana')).toBe(true);
	});
});

describe('derivação', () => {
	it('deriva `type` da pasta', () => {
		expect(typeOf(doc({ relativePath: 'guides/x.mdx' }))).toBe('Guide');
		expect(typeOf(doc({ relativePath: 'api-reference/x.md' }))).toBe('API Reference');
		expect(typeOf(doc({ relativePath: 'changelog/x.md' }))).toBe('Changelog');
	});

	it('`type` declarado à mão vence a derivação', () => {
		const document = doc({ frontmatter: { title: 'X', type: 'Runbook' } });

		expect(typeOf(document)).toBe('Runbook');
	});

	it('índice da Starlight não vira conceito — `index.md` é nome reservado', () => {
		expect(bundlePathOf(doc({ relativePath: 'index.mdx' }))).toBeNull();
		expect(bundlePathOf(doc({ relativePath: 'exemplos/index.mdx' }))).toBeNull();
	});

	it('`.mdx` vira `.md` porque o corpo já perdeu a sintaxe de MDX', () => {
		expect(bundlePathOf(doc({ relativePath: 'guides/x.mdx' }))).toBe('guides/x.md');
	});

	it('glossário e snippets ganham prefixo próprio', () => {
		expect(bundlePathOf(doc({ relativePath: 'termo.md', collection: 'glossary' }))).toBe(
			'glossary/termo.md'
		);
		expect(bundlePathOf(doc({ relativePath: 'bloco.md', collection: 'snippets' }))).toBe(
			'snippets/bloco.md'
		);
	});

	it('a rota da página é a mesma que o portal publica', () => {
		expect(routeOf(doc({ relativePath: 'guides/x.mdx' }))).toBe('/guides/x/');
		expect(routeOf(doc({ relativePath: 'index.mdx' }))).toBe('/');
	});

	it('página vencida continua `stable` — frescor é `stale_after`, não status', () => {
		const governance = {
			path: 'guides/x.mdx',
			inherited: {},
			reviewedAt: '2020-01-01T00:00:00.000Z',
			reviewIntervalDays: 30,
		};

		expect(statusOf(governance, {})).toBe('stable');
	});

	it('`deprecated: true` no frontmatter vira status obsoleto', () => {
		expect(statusOf({ path: 'x', inherited: {} }, { deprecated: true })).toBe('deprecated');
	});

	it('revisão sem quem assina não vira `verified`', () => {
		const semAssinatura = verificationsOf({
			path: 'x',
			inherited: {},
			reviewedAt: '2026-08-19T00:00:00.000Z',
			owner: { type: 'team', id: 'documentation' },
		});

		expect(semAssinatura).toEqual([]);
	});

	it('revisão assinada vira `verified` com ator de pessoa', () => {
		const assinada = verificationsOf({
			path: 'x',
			inherited: {},
			reviewedAt: '2026-08-19T00:00:00.000Z',
			reviewedBy: 'mestre',
		});

		expect(assinada).toEqual([{ by: 'human:mestre', at: '2026-08-19T00:00:00.000Z' }]);
		expect(trustTierOf(assinada)).toBe('human-reviewed');
	});
});

describe('links entre conceitos', () => {
	const routes = buildRouteMap([
		{ route: '/guides/editor/', path: 'guides/editor.md' },
		{ route: '/exemplos/', path: 'exemplos/index.md' },
	]);

	it('troca rota do portal por caminho do bundle', () => {
		expect(rewriteLinks('Veja o [editor](/guides/editor/).', routes)).toBe(
			'Veja o [editor](/guides/editor.md).'
		);
	});

	it('preserva a âncora', () => {
		expect(rewriteLinks('[x](/guides/editor/#salvar)', routes)).toBe('[x](/guides/editor.md#salvar)');
	});

	it('deixa em paz link externo e âncora local', () => {
		expect(rewriteLinks('[x](https://exemplo.com/a/)', routes)).toBe('[x](https://exemplo.com/a/)');
		expect(rewriteLinks('[x](#secao)', routes)).toBe('[x](#secao)');
	});

	it('deixa em paz rota que não virou conceito', () => {
		// `/settings/` é página de aplicação. Reescrevê-la produziria um caminho de
		// arquivo que não existe em lugar nenhum.
		expect(rewriteLinks('[x](/settings/)', routes)).toBe('[x](/settings/)');
	});

	it('rota de seção aponta para o índice do diretório', () => {
		expect(rewriteLinks('[x](/exemplos/)', routes)).toBe('[x](/exemplos/index.md)');
	});
});

describe('idiomas', () => {
	it('o original é o conceito e as traduções viram campo', () => {
		const docs = [
			doc({ relativePath: 'guides/x.mdx' }),
			doc({ relativePath: 'en/guides/x.md', locale: 'en' }),
			doc({ relativePath: 'es/guides/x.md', locale: 'es' }),
		];

		const { originals, translationsFor } = groupTranslations(docs);

		expect(originals).toHaveLength(1);
		expect(originals[0]?.locale).toBe('pt-BR');
		expect(translationsFor.get('guides/x.md')).toEqual({
			en: '/en/guides/x/',
			es: '/es/guides/x/',
		});
	});

	it('tradução órfã vira conceito próprio em vez de sumir', () => {
		const { originals } = groupTranslations([doc({ relativePath: 'en/guides/so-em-ingles.md', locale: 'en' })]);

		expect(originals).toHaveLength(1);
		expect(originals[0]?.locale).toBe('en');
	});
});

describe('serialização', () => {
	it('omite campo vazio em vez de escrever nulo', () => {
		const object = frontmatterObject({ type: 'Guide', title: 'X', description: '', tags: [] });

		expect(object).toEqual({ type: 'Guide', title: 'X' });
	});

	it('põe `type` primeiro', () => {
		const output = serializeConcept({
			path: 'x.md',
			frontmatter: { type: 'Guide', title: 'X' },
			body: 'Corpo.',
		});

		expect(output.split('\n')[1]).toBe('type: Guide');
	});

	it('só a raiz declara a versão do formato', () => {
		const raiz = serializeIndex({ path: 'index.md', okfVersion: OKF_VERSION, sections: [] });
		const secao = serializeIndex({ path: 'guides/index.md', title: 'Guias', sections: [] });

		expect(raiz).toContain('okf_version');
		expect(secao).not.toContain('okf_version');
	});

	it('log usa cabeçalho de data ISO, mais recente primeiro', () => {
		const output = serializeLog({
			path: 'log.md',
			entries: [
				{ date: '2026-01-01', kind: 'Creation', text: 'Antigo.' },
				{ date: '2026-08-22', kind: 'Update', text: 'Novo.' },
			],
		});

		expect(output.indexOf('# 2026-08-22')).toBeLessThan(output.indexOf('# 2026-01-01'));
	});

	it('normaliza CRLF, CR solto e o CR duplo que sobrevive a uma passada só', () => {
		// Trocar apenas CR+LF por LF deixa CR+CR+LF virar CR+LF: a primeira barra
		// não casa, a segunda consome o par. Foi assim que um CRLF entrou no bundle
		// a partir de um fonte com fim de linha do Windows.
		const CR = String.fromCharCode(13);
		const LF = String.fromCharCode(10);

		const output = serializeConcept({
			path: 'x.md',
			frontmatter: { type: 'Guide' },
			body: `a${CR}${LF}b${CR}${CR}${LF}c${CR}d`,
		});

		expect(output).not.toContain(CR);
	});

	it('é determinístico — o bundle é comitado e comparado', () => {
		const concept = {
			path: 'x.md',
			frontmatter: { type: 'Guide', title: 'X', tags: ['b', 'a'] },
			body: 'Corpo.',
		};

		expect(serializeConcept(concept)).toBe(serializeConcept(concept));
	});
});

describe('bundle gerado', () => {
	const content = {
		docs: [
			doc({ relativePath: 'guides/a.mdx', frontmatter: { title: 'A', description: 'Guia A.' } }),
			doc({ relativePath: 'index.mdx', frontmatter: { title: 'Início' } }),
		],
		glossary: [],
		snippets: [],
	};

	const options = {
		siteUrl: 'https://docs.exemplo.com',
		now: NOW,
		config: DEFAULT_CONFIG,
		title: 'Bundle de teste',
	};

	it('produz um bundle conformante', () => {
		const files = renderBundle(buildBundle(content, options));

		expect(validateBundle(files).conformant).toBe(true);
	});

	it('não emite o índice da Starlight como conceito', () => {
		const bundle = buildBundle(content, options);

		expect(bundle.concepts.map((concept) => concept.path)).toEqual(['guides/a.md']);
	});

	it('escreve `resource` com a URL pública', () => {
		const bundle = buildBundle(content, options);

		expect(bundle.concepts[0]?.frontmatter.resource).toBe('https://docs.exemplo.com/guides/a/');
	});

	it('registra a origem no repositório em `sources`', () => {
		const bundle = buildBundle(content, options);

		expect(bundle.concepts[0]?.frontmatter.sources?.[0]?.resource).toBe(
			'src/content/docs/guides/a.mdx'
		);
	});
});

describe('bundle comitado', () => {
	async function readCommittedBundle(): Promise<OkfFile[]> {
		const root = path.resolve(process.cwd(), 'okf');
		const files: OkfFile[] = [];

		async function visit(dir: string, prefix: string): Promise<void> {
			let entries;
			try {
				entries = await readdir(dir, { withFileTypes: true });
			} catch {
				return;
			}
			for (const entry of entries) {
				const absolute = path.join(dir, entry.name);
				const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
				if (entry.isDirectory()) await visit(absolute, relative);
				else if (entry.name.endsWith('.md')) {
					files.push({ path: relative, contents: await readFile(absolute, 'utf-8') });
				}
			}
		}

		await visit(root, '');
		return files;
	}

	it('está conformante', async () => {
		const files = await readCommittedBundle();

		expect(files.length).toBeGreaterThan(0);

		const result = validateBundle(files);
		const errors = result.findings.filter((finding) => finding.severity === 'error');

		expect(errors).toEqual([]);
		expect(result.conformant).toBe(true);
	});

	it('declara a versão do formato na raiz', async () => {
		const files = await readCommittedBundle();
		const root = files.find((file) => file.path === 'index.md');

		expect(root?.contents).toContain(`okf_version: "${OKF_VERSION}"`);
	});

	it('todo conceito tem `type` não vazio', async () => {
		const files = await readCommittedBundle();
		const concepts = files.filter(
			(file) => !file.path.endsWith('index.md') && !file.path.endsWith('log.md')
		);

		expect(concepts.length).toBeGreaterThan(0);
		for (const concept of concepts) {
			expect(concept.contents).toMatch(/^---\r?\n(?:.*\r?\n)*?type: \S/);
		}
	});
});
