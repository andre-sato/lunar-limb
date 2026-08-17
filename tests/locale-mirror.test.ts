import { describe, it, expect, vi } from 'vitest';
import {
	buildMirrorContent,
	createMirrors,
	isRootLocalePath,
	MIRROR_LOCALES,
	mirrorPathFor,
	planMirrors,
} from '../src/lib/editor/locale-mirror';

const PAGE = `---
title: Autenticação da API
description: Como autenticar requisições
---

Envie a chave no header Authorization.
`;

describe('detecção do idioma raiz', () => {
	it('página na raiz gera espelhos', () => {
		expect(isRootLocalePath('guides/auth.md')).toBe(true);
		expect(isRootLocalePath('index.mdx')).toBe(true);
	});

	it('página já traduzida não gera espelhos', () => {
		// Sem isto, criar a tradução em inglês tentaria criar `es/en/…`.
		expect(isRootLocalePath('en/guides/auth.md')).toBe(false);
		expect(isRootLocalePath('es/guides/auth.md')).toBe(false);
	});

	it('pasta que apenas começa com o código do idioma continua sendo raiz', () => {
		expect(isRootLocalePath('enterprise/guia.md')).toBe(true);
		expect(isRootLocalePath('especificacoes/api.md')).toBe(true);
	});

	it('caminho vazio não gera nada', () => {
		expect(isRootLocalePath('')).toBe(false);
	});

	it('normaliza barra invertida e barra inicial', () => {
		expect(isRootLocalePath('/guides/auth.md')).toBe(true);
		expect(isRootLocalePath('en\\guides\\auth.md')).toBe(false);
	});
});

describe('caminho do espelho', () => {
	it('prefixa o idioma', () => {
		expect(mirrorPathFor('guides/auth.md', 'en')).toBe('en/guides/auth.md');
		expect(mirrorPathFor('guides/auth.md', 'es')).toBe('es/guides/auth.md');
	});

	it('preserva a extensão, inclusive .mdx', () => {
		expect(mirrorPathFor('guides/auth.mdx', 'en')).toBe('en/guides/auth.mdx');
	});
});

describe('conteúdo do espelho', () => {
	it('mantém o título do original', () => {
		const mirror = buildMirrorContent(PAGE, 'en');
		expect(mirror).toContain('title: "Autenticação da API"');
	});

	it('inclui o aviso de tradução pendente no idioma do espelho', () => {
		expect(buildMirrorContent(PAGE, 'en')).toContain('Translation pending');
		expect(buildMirrorContent(PAGE, 'es')).toContain('Traducción pendiente');
	});

	it('marca o arquivo como pendente de tradução', () => {
		// É o que distingue "ainda não traduzido" de "traduzido", sem depender
		// de alguém lembrar.
		expect(buildMirrorContent(PAGE, 'en')).toContain('translationPending: true');
	});

	it('preserva o corpo original em vez de deixar a página vazia', () => {
		expect(buildMirrorContent(PAGE, 'en')).toContain('Envie a chave no header Authorization.');
	});

	it('herda os campos que controlam visibilidade', () => {
		const hidden = `---
title: Recurso beta
visible: false
showIf: beta
order: 3
---

Texto.
`;
		const mirror = buildMirrorContent(hidden, 'en');
		// Uma página oculta no original não pode aparecer na tradução.
		expect(mirror).toContain('visible: false');
		expect(mirror).toContain('showIf: "beta"');
		expect(mirror).toContain('order: 3');
	});

	it('não copia o slug', () => {
		const withSlug = `---
title: T
slug: caminho-customizado
---

Texto.
`;
		expect(buildMirrorContent(withSlug, 'en')).not.toContain('slug:');
	});

	it('escapa aspas e dois-pontos no título', () => {
		const tricky = `---
title: 'API: o que fazer com "tokens"'
---

Texto.
`;
		const mirror = buildMirrorContent(tricky, 'en');
		expect(mirror).toContain('\\"tokens\\"');
		// E o YAML resultante continua parseável.
		expect(mirror.split('\n').filter((line) => line === '---')).toHaveLength(2);
	});

	it('gera descrição própria quando o original não tem', () => {
		const noDescription = '---\ntitle: T\n---\n\nTexto.\n';
		expect(buildMirrorContent(noDescription, 'es')).toContain('Traducción pendiente');
	});

	it('página sem frontmatter ainda gera espelho válido', () => {
		const mirror = buildMirrorContent('Só texto, sem frontmatter.', 'en');
		expect(mirror).toContain('title: "Sem título"');
		expect(mirror).toContain('Só texto, sem frontmatter.');
	});

	it('frontmatter com YAML inválido não impede o espelho', () => {
		const broken = '---\ntitle: [não fechado\n---\n\nTexto.\n';
		expect(() => buildMirrorContent(broken, 'en')).not.toThrow();
	});
});

describe('plano de espelhos', () => {
	it('cria um por idioma configurado', () => {
		const plan = planMirrors('guides/auth.md', PAGE);
		expect(plan.map((entry) => entry.locale)).toEqual([...MIRROR_LOCALES]);
		expect(plan.map((entry) => entry.path)).toEqual(['en/guides/auth.md', 'es/guides/auth.md']);
	});

	it('página traduzida não gera plano', () => {
		expect(planMirrors('en/guides/auth.md', PAGE)).toEqual([]);
	});
});

describe('criação dos espelhos', () => {
	it('cria os arquivos e relata', async () => {
		const create = vi.fn().mockResolvedValue(undefined);
		const result = await createMirrors('guides/auth.md', PAGE, create);

		expect(create).toHaveBeenCalledTimes(2);
		expect(result.created).toEqual(['en/guides/auth.md', 'es/guides/auth.md']);
		expect(result.failed).toEqual([]);
	});

	it('não sobrescreve tradução existente', async () => {
		// O 409 vem de `createDocument` quando o arquivo já existe: o trabalho
		// de quem traduziu vale mais que a consistência automática.
		const create = vi.fn().mockImplementation(async (path: string) => {
			if (path.startsWith('en/')) {
				throw Object.assign(new Error('Já existe um arquivo nesse caminho.'), { status: 409 });
			}
		});

		const result = await createMirrors('guides/auth.md', PAGE, create);

		expect(result.skipped).toEqual(['en/guides/auth.md']);
		expect(result.created).toEqual(['es/guides/auth.md']);
		expect(result.failed).toEqual([]);
	});

	it('falha em um idioma não impede o outro', async () => {
		const create = vi.fn().mockImplementation(async (path: string) => {
			if (path.startsWith('es/')) throw new Error('disco cheio');
		});

		const result = await createMirrors('guides/auth.md', PAGE, create);

		expect(result.created).toEqual(['en/guides/auth.md']);
		expect(result.failed).toEqual([{ path: 'es/guides/auth.md', reason: 'disco cheio' }]);
	});

	it('criar dentro de um idioma não dispara espelhos', async () => {
		const create = vi.fn();
		const result = await createMirrors('en/guides/auth.md', PAGE, create);

		expect(create).not.toHaveBeenCalled();
		expect(result.created).toEqual([]);
	});
});
