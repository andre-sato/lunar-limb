import { describe, expect, it } from 'vitest';
import {
	analyzeImpact,
	collectProblems,
	extractReferences,
	findBrokenReferences,
	findCycles,
	findDuplicateIds,
	findUnusedReusable,
	getBacklinks,
	getTransitiveConsumers,
	getUses,
	refOf,
	wouldCreateCycle,
	type ContentEdge,
	type ContentGraph,
	type ContentNode,
	type ReusableType,
} from '../src/lib/editor/graph-model';

// ---------------------------------------------------------------------------
// Helpers para montar grafos sem tocar o filesystem
// ---------------------------------------------------------------------------

function block(id: string, title?: string): ContentNode {
	return { key: `snippets:${id}.md`, id, type: 'block', root: 'snippets', path: `${id}.md`, title };
}

function page(id: string, title?: string): ContentNode {
	return { key: `docs:${id}.mdx`, id, type: 'page', root: 'docs', path: `${id}.mdx`, title };
}

function edge(from: ContentNode, targetId: string, refType: ReusableType, line = 1): ContentEdge {
	return {
		source: from.key,
		sourceId: from.id,
		target: targetId,
		type: 'uses',
		refType,
		resolved: true,
		location: { line, column: 1, offset: 0 },
	};
}

function graphOf(nodes: ContentNode[], edges: ContentEdge[]): ContentGraph {
	const known = new Set(nodes.map((node) => refOf(node.type, node.id)));
	return {
		nodes,
		edges: edges.map((e) => ({ ...e, resolved: known.has(refOf(e.refType, e.target)) })),
		generatedAt: 0,
	};
}

// ---------------------------------------------------------------------------

describe('extractReferences', () => {
	it('encontra ContentBlock e IncludePage com linha e coluna', () => {
		const raw = ['# Título', '', '<ContentBlock id="auth-warning" />', '', '<IncludePage id="guides/auth" />'].join(
			'\n'
		);

		expect(extractReferences(raw)).toEqual([
			{ type: 'block', id: 'auth-warning', location: { line: 3, column: 1, offset: 10 } },
			{ type: 'page', id: 'guides/auth', location: { line: 5, column: 1, offset: 46 } },
		]);
	});

	it('numera as linhas contando o frontmatter', () => {
		const raw = ['---', 'title: A', '---', '', '<ContentBlock id="x" />'].join('\n');
		expect(extractReferences(raw)[0].location.line).toBe(5);
	});

	it('ignora ocorrências dentro do próprio frontmatter', () => {
		const raw = ['---', 'title: <ContentBlock id="nao-conta" />', '---', '', 'texto'].join('\n');
		expect(extractReferences(raw)).toEqual([]);
	});

	it('aceita aspas simples e a forma sem barra final', () => {
		const raw = `<ContentBlock id='a' />\n<IncludePage id="b">`;
		expect(extractReferences(raw).map((r) => r.id)).toEqual(['a', 'b']);
	});

	it('não confunde outros componentes JSX', () => {
		expect(extractReferences('<Aside type="tip">oi</Aside>')).toEqual([]);
	});

	it('ignora referências dentro de blocos de código cercados', () => {
		// Uma página que documenta a sintaxe não deve virar consumidora dela.
		const raw = [
			'Exemplo:',
			'',
			'```mdx',
			'<ContentBlock id="exemplo" />',
			'```',
			'',
			'<ContentBlock id="de-verdade" />',
		].join('\n');

		expect(extractReferences(raw).map((r) => r.id)).toEqual(['de-verdade']);
	});

	it('ignora referências em código inline', () => {
		expect(extractReferences('Use `<ContentBlock id="x" />` para incluir.')).toEqual([]);
	});

	it('trata cerca ainda não fechada como código até o fim do arquivo', () => {
		const raw = ['```mdx', '<ContentBlock id="digitando" />'].join('\n');
		expect(extractReferences(raw)).toEqual([]);
	});

	it('só fecha a cerca com o mesmo marcador', () => {
		const raw = ['~~~', '<ContentBlock id="dentro" />', '```', '<ContentBlock id="ainda-dentro" />', '~~~'].join('\n');
		expect(extractReferences(raw)).toEqual([]);
	});
});

describe('grafo bidirecional', () => {
	// O caso da §53 da especificação: A → B, C → B, D → C.
	const a = page('A');
	const b = block('B');
	const c = page('C');
	const d = page('D');
	const g = graphOf(
		[a, b, c, d],
		[edge(a, 'B', 'block'), edge(c, 'B', 'block'), edge(d, 'C', 'page')]
	);

	it('B tem backlinks [A, C]', () => {
		expect(getBacklinks(g, 'block:B').map((e) => e.sourceId).sort()).toEqual(['A', 'C']);
	});

	it('C tem backlinks [D]', () => {
		expect(getBacklinks(g, 'page:C').map((e) => e.sourceId)).toEqual(['D']);
	});

	it('A não tem backlinks', () => {
		expect(getBacklinks(g, 'page:A')).toEqual([]);
	});

	it('"esta página usa" é o outro lado da mesma aresta', () => {
		expect(getUses(g, a.key).map((e) => e.target)).toEqual(['B']);
		expect(getUses(g, b.key)).toEqual([]);
	});

	it('consumidores transitivos incluem quem depende indiretamente', () => {
		// D usa C, C usa B ⇒ mudar B afeta C e D.
		expect(getTransitiveConsumers(g, 'block:B').sort()).toEqual(['page:A', 'page:C', 'page:D']);
	});
});

describe('analyzeImpact', () => {
	const shared = block('shared');
	const mid = page('mid');
	const top = page('top');
	const g = graphOf([shared, mid, top], [edge(mid, 'shared', 'block'), edge(top, 'mid', 'page')]);

	it('separa consumidores diretos de indiretos', () => {
		const impact = analyzeImpact(g, 'block:shared');
		expect(impact.direct.map((n) => n.id)).toEqual(['mid']);
		expect(impact.indirect.map((n) => n.id)).toEqual(['top']);
		expect(impact.total).toBe(2);
	});

	it('conteúdo sem consumidores tem impacto zero', () => {
		expect(analyzeImpact(g, 'page:top').total).toBe(0);
	});
});

describe('ciclos', () => {
	it('detecta A → B → C → A', () => {
		const a = block('a');
		const b = block('b');
		const c = block('c');
		const g = graphOf(
			[a, b, c],
			[edge(a, 'b', 'block'), edge(b, 'c', 'block'), edge(c, 'a', 'block')]
		);

		const cycles = findCycles(g);
		expect(cycles).toHaveLength(1);
		// Cadeia fechada, normalizada para começar no menor ref.
		expect(cycles[0]).toEqual(['block:a', 'block:b', 'block:c', 'block:a']);
	});

	it('detecta auto-referência', () => {
		const a = block('a');
		expect(findCycles(graphOf([a], [edge(a, 'a', 'block')]))).toEqual([['block:a', 'block:a']]);
	});

	it('não reporta o mesmo ciclo mais de uma vez', () => {
		const a = block('a');
		const b = block('b');
		const entry = page('entry');
		const g = graphOf(
			[a, b, entry],
			[edge(entry, 'a', 'block'), edge(a, 'b', 'block'), edge(b, 'a', 'block')]
		);
		expect(findCycles(g)).toHaveLength(1);
	});

	it('grafo acíclico não produz ciclos', () => {
		const a = page('a');
		const b = block('b');
		expect(findCycles(graphOf([a, b], [edge(a, 'b', 'block')]))).toEqual([]);
	});
});

describe('wouldCreateCycle', () => {
	const a = block('a');
	const b = block('b');
	const c = page('c');
	// a → b já existe.
	const g = graphOf([a, b, c], [edge(a, 'b', 'block')]);

	it('bloqueia inserir o conteúdo dentro dele mesmo', () => {
		expect(wouldCreateCycle(g, 'block:a', 'block:a')).toEqual(['block:a', 'block:a']);
	});

	it('bloqueia fechar o laço a → b → a', () => {
		expect(wouldCreateCycle(g, 'block:b', 'block:a')).toEqual(['block:b', 'block:a', 'block:b']);
	});

	it('permite inserções que não fecham laço', () => {
		expect(wouldCreateCycle(g, 'page:c', 'block:a')).toBeNull();
		expect(wouldCreateCycle(g, 'block:a', 'block:b')).toBeNull();
	});
});

describe('problemas do grafo', () => {
	it('marca referência para id inexistente como quebrada', () => {
		const a = page('a');
		const g = graphOf([a], [edge(a, 'nao-existe', 'block', 7)]);

		const broken = findBrokenReferences(g);
		expect(broken).toHaveLength(1);
		expect(broken[0].target).toBe('nao-existe');

		const problems = collectProblems(g);
		expect(problems[0]).toMatchObject({
			kind: 'broken-reference',
			severity: 'error',
			nodeKey: a.key,
			targetId: 'nao-existe',
		});
		expect(problems[0].location?.line).toBe(7);
	});

	it('bloco e página com o mesmo id não colidem', () => {
		// docs/auth.mdx e snippets/auth.md coexistem: <ContentBlock id="auth"/>
		// resolve no snippet, <IncludePage id="auth"/> na página.
		const p = page('auth');
		const bl = block('auth');
		const consumer = page('consumer');
		const g = graphOf([p, bl, consumer], [edge(consumer, 'auth', 'block')]);

		expect(findBrokenReferences(g)).toEqual([]);
		expect(getBacklinks(g, 'block:auth')).toHaveLength(1);
		expect(getBacklinks(g, 'page:auth')).toEqual([]);
	});

	it('detecta id duplicado (mesmo nome em .md e .mdx)', () => {
		const md: ContentNode = { key: 'snippets:x.md', id: 'x', type: 'block', root: 'snippets', path: 'x.md' };
		const mdx: ContentNode = { key: 'snippets:x.mdx', id: 'x', type: 'block', root: 'snippets', path: 'x.mdx' };
		const duplicates = findDuplicateIds(graphOf([md, mdx], []));
		expect(duplicates).toHaveLength(1);
		expect(duplicates[0].map((n) => n.path)).toEqual(['x.md', 'x.mdx']);
	});

	it('lista blocos que ninguém usa', () => {
		const usado = block('usado');
		const orfao = block('orfao');
		const consumer = page('consumer');
		const g = graphOf([usado, orfao, consumer], [edge(consumer, 'usado', 'block')]);

		expect(findUnusedReusable(g).map((n) => n.id)).toEqual(['orfao']);
	});

	it('página de documentação sem uso não conta como conteúdo órfão', () => {
		// Páginas normais existem para serem lidas, não para serem incluídas.
		expect(findUnusedReusable(graphOf([page('guia')], []))).toEqual([]);
	});

	it('collectProblems classifica cada tipo com a severidade certa', () => {
		const a = block('a');
		const b = block('b');
		const orfao = block('orfao');
		const g = graphOf(
			[a, b, orfao],
			[edge(a, 'b', 'block'), edge(b, 'a', 'block'), edge(a, 'fantasma', 'block')]
		);

		const kinds = collectProblems(g).map((p) => `${p.kind}:${p.severity}`);
		expect(kinds).toContain('broken-reference:error');
		expect(kinds).toContain('circular-reference:error');
		expect(kinds).toContain('unused-content:info');
	});
});
