import { describe, it, expect } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { buildGlossaryIndex, describeConflicts, findMatches } from '../src/lib/glossary/index-build';
import { parseGlossDef, GlossaryError } from '../src/lib/glossary/loader';
import { transformGlossary } from '../src/lib/glossary/remark-glossary';
import type { GlossDef } from '../src/lib/glossary/types';

function def(partial: Partial<GlossDef> & { id: string; term: string }): GlossDef {
	return {
		aliases: [],
		definition: 'Definição.',
		enabled: true,
		caseSensitive: false,
		matchWholeWord: true,
		deprecated: [],
		...partial,
	};
}

function indexOf(...definitions: GlossDef[]) {
	return buildGlossaryIndex(definitions);
}

function matchIds(text: string, ...definitions: GlossDef[]): string[] {
	return findMatches(text, indexOf(...definitions)).map((match) => match.definitionId);
}

// ---------------------------------------------------------------------------
// §5, §7 — o arquivo do termo
// ---------------------------------------------------------------------------

describe('leitura de um GlossDef', () => {
	it('lê frontmatter e definição', () => {
		const parsed = parseGlossDef(
			'rag.md',
			'---\nid: rag\nterm: RAG\naliases:\n  - Retrieval-Augmented Generation\n---\nTécnica que combina recuperação e geração.'
		);

		expect(parsed).toMatchObject({
			id: 'rag',
			term: 'RAG',
			aliases: ['Retrieval-Augmented Generation'],
			enabled: true,
			caseSensitive: false,
			matchWholeWord: true,
		});
		expect(parsed.definition).toContain('recuperação');
	});

	it('o id cai para o nome do arquivo', () => {
		// O caminho já é identificador único de um arquivo versionado.
		expect(parseGlossDef('oauth.md', '---\nterm: OAuth\n---\nProtocolo.').id).toBe('oauth');
	});

	it('respeita os padrões da spec', () => {
		const parsed = parseGlossDef('x.md', '---\nterm: X\n---\nDefinição.');
		expect(parsed.enabled).toBe(true);
		expect(parsed.caseSensitive).toBe(false);
		expect(parsed.matchWholeWord).toBe(true);
	});

	it('recusa arquivo sem termo, sem definição ou sem frontmatter', () => {
		expect(() => parseGlossDef('x.md', '---\nid: x\n---\nSó definição.')).toThrow(/term/);
		expect(() => parseGlossDef('x.md', '---\nterm: X\n---\n')).toThrow(/definição vazia/);
		expect(() => parseGlossDef('x.md', 'sem frontmatter')).toThrow(GlossaryError);
	});

	it('aceita alias em string única', () => {
		expect(parseGlossDef('x.md', '---\nterm: X\naliases: Xis\n---\nD.').aliases).toEqual(['Xis']);
	});
});

// ---------------------------------------------------------------------------
// §17, §18, §26 — índice, conflitos e desempate
// ---------------------------------------------------------------------------

describe('índice', () => {
	it('ordena as formas da mais longa para a mais curta', () => {
		const index = indexOf(def({ id: 'api', term: 'API' }), def({ id: 'gw', term: 'API Gateway' }));
		expect(index.matchers[0].surface).toBe('API Gateway');
	});

	it('termo desativado sai do matching mas fica no dicionário', () => {
		const index = indexOf(def({ id: 'md', term: 'Markdown', enabled: false }));
		expect(index.byId.has('md')).toBe(true);
		expect(index.matchers).toHaveLength(0);
	});

	it('detecta forma disputada por duas definições', () => {
		const index = indexOf(
			def({ id: 'a', term: 'Termo A', aliases: ['API'] }),
			def({ id: 'b', term: 'Termo B', aliases: ['API'] })
		);

		expect(index.conflicts).toHaveLength(1);
		expect(index.conflicts[0]).toMatchObject({ surface: 'api', definitionIds: ['a', 'b'] });

		const [message] = describeConflicts(index);
		expect(message).toContain('"api"');
		expect(message).toContain('Termo A');
		expect(message).toContain('Termo B');
	});

	it('a mesma definição declarando a forma duas vezes não é conflito', () => {
		const index = indexOf(def({ id: 'a', term: 'API', aliases: ['api'] }));
		expect(index.conflicts).toHaveLength(0);
	});

	it('a ordem do índice não depende da ordem de entrada', () => {
		const forward = indexOf(def({ id: 'a', term: 'AAA' }), def({ id: 'b', term: 'BBB' }));
		const backward = indexOf(def({ id: 'b', term: 'BBB' }), def({ id: 'a', term: 'AAA' }));
		expect(forward.matchers.map((m) => m.surface)).toEqual(backward.matchers.map((m) => m.surface));
	});
});

// ---------------------------------------------------------------------------
// §10, §17 — busca de ocorrências
// ---------------------------------------------------------------------------

describe('busca de termos', () => {
	const api = def({ id: 'api', term: 'API' });
	const oauth = def({ id: 'oauth', term: 'OAuth' });

	it('encontra o termo no meio da frase', () => {
		expect(matchIds('A API usa OAuth para autorizar.', api, oauth)).toEqual(['api', 'oauth']);
	});

	it('a maior correspondência vence', () => {
		const gateway = def({ id: 'gw', term: 'API Gateway' });
		const found = findMatches('O API Gateway encaminha.', indexOf(api, gateway));
		expect(found).toHaveLength(1);
		expect(found[0]).toMatchObject({ definitionId: 'gw', text: 'API Gateway' });
	});

	it('alias aponta para a mesma definição', () => {
		const rag = def({ id: 'rag', term: 'RAG', aliases: ['Retrieval-Augmented Generation'] });
		const found = findMatches('Usamos Retrieval-Augmented Generation aqui.', indexOf(rag));
		expect(found[0]).toMatchObject({ definitionId: 'rag', kind: 'alias' });
	});

	it('palavra inteira: não casa dentro de outra palavra', () => {
		expect(matchIds('O rapid não é RAG.', def({ id: 'rag', term: 'RAG' }))).toEqual(['rag']);
		expect(matchIds('APIs no plural.', api)).toEqual([]);
	});

	it('sem palavra inteira, casa como fragmento', () => {
		const parcial = def({ id: 'api', term: 'API', matchWholeWord: false });
		expect(matchIds('APIs no plural.', parcial)).toEqual(['api']);
	});

	it('sem sensibilidade a caixa, casa em qualquer grafia', () => {
		expect(matchIds('a api e a Api.', api)).toEqual(['api', 'api']);
	});

	it('com sensibilidade a caixa, só a grafia exata', () => {
		const rag = def({ id: 'rag', term: 'RAG', caseSensitive: true });
		expect(matchIds('RAG e rag na mesma frase.', rag)).toEqual(['rag']);
	});

	it('preserva a grafia original do texto', () => {
		const found = findMatches('a api aqui', indexOf(api));
		expect(found[0].text).toBe('api');
	});

	it('não devolve ocorrências sobrepostas', () => {
		const found = findMatches('API Gateway', indexOf(api, def({ id: 'gw', term: 'API Gateway' })));
		expect(found).toHaveLength(1);
	});

	it('texto vazio ou índice vazio não quebram', () => {
		expect(findMatches('', indexOf(api))).toEqual([]);
		expect(findMatches('qualquer texto', buildGlossaryIndex([]))).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// §14, §15, §16 — o que não pode ser processado
// ---------------------------------------------------------------------------

describe('transformação do AST', () => {
	const index = indexOf(
		def({ id: 'oauth', term: 'OAuth' }),
		def({ id: 'api', term: 'API' })
	);

	function transform(markdown: string, enabled = true) {
		const tree = unified().use(remarkParse).parse(markdown);
		const found = transformGlossary(tree as never, { index, enabled });
		return { tree, found };
	}

	function countTerms(tree: unknown): number {
		let total = 0;
		JSON.stringify(tree, (key, value) => {
			if (value && typeof value === 'object' && (value as { type?: string }).type === 'glossaryTerm') total++;
			return value;
		});
		return total;
	}

	it('marca o termo em parágrafo comum', () => {
		const { tree, found } = transform('A API usa OAuth para autorizar o acesso.');
		expect(countTerms(tree)).toBe(2);
		expect([...found].sort()).toEqual(['api', 'oauth']);
	});

	it('ignora bloco de código', () => {
		const { tree } = transform('```text\nOAuth\n```');
		expect(countTerms(tree)).toBe(0);
	});

	it('ignora código inline', () => {
		const { tree } = transform('Use `OAuth` para autenticar o cliente.');
		expect(countTerms(tree)).toBe(0);
	});

	it('ignora link', () => {
		const { tree } = transform('[OAuth documentation](/oauth) explica o fluxo.');
		expect(countTerms(tree)).toBe(0);
	});

	it('ignora heading', () => {
		const { tree } = transform('## OAuth Authentication');
		expect(countTerms(tree)).toBe(0);
	});

	it('ignora HTML cru', () => {
		const { tree } = transform('<div>OAuth</div>');
		expect(countTerms(tree)).toBe(0);
	});

	it('processa o texto ao redor de um trecho ignorado', () => {
		// O `inlineCode` não deve impedir o destaque no resto da frase.
		const { tree } = transform('A API responde e `OAuth` autoriza o pedido.');
		expect(countTerms(tree)).toBe(1);
	});

	it('a página pode desligar o glossário', () => {
		const { tree, found } = transform('A API usa OAuth.', false);
		expect(countTerms(tree)).toBe(0);
		expect(found.size).toBe(0);
	});

	it('marca todas as ocorrências, não só a primeira', () => {
		const { tree } = transform('A API responde, e a API registra o pedido.');
		expect(countTerms(tree)).toBe(2);
	});

	it('o elemento gerado é acessível e identificável', () => {
		const { tree } = transform('A API responde rápido.');
		const json = JSON.stringify(tree);
		expect(json).toContain('"data-glossary-id":"api"');
		expect(json).toContain('"tabindex":"0"');
		expect(json).toContain('glossary-tooltip-api');
	});

	it('não entra em laço com o texto que acabou de inserir', () => {
		// O termo inserido casa com ele mesmo; reprocessá-lo travaria o build.
		const { tree } = transform('API API API API.');
		expect(countTerms(tree)).toBe(4);
	});
});
