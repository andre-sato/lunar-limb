import { describe, expect, it } from 'vitest';
import { JsonPathError, parsePath, pointerOf, query } from '../src/lib/overlay/jsonpath';
import { OverlayParseError, parseOverlay } from '../src/lib/overlay/parse';
import { SUPPORTED_VERSION, validateOverlay } from '../src/lib/overlay/validate';
import { applyOverlays, mergeInto } from '../src/lib/overlay/apply';
import { diffDocuments, labelFor } from '../src/lib/overlay/preview';
import { detectConflicts } from '../src/lib/overlay/conflicts';
import { overlayFromComparison, overlayToYaml, targetFor } from '../src/lib/overlay/compare';
import { historyByNode } from '../src/lib/overlay/provenance';
import type { Overlay } from '../src/lib/overlay/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function spec() {
	return {
		openapi: '3.1.0',
		info: { title: 'API', version: '1.0.0' },
		servers: [{ url: 'https://api.example' }],
		tags: [{ name: 'public' }],
		paths: {
			'/users': {
				get: { summary: 'List users', responses: { '200': { description: 'ok' } } },
				post: { summary: 'Create user' },
			},
			'/internal/metrics': { get: { summary: 'Internal' } },
		},
		components: { schemas: { User: { type: 'object' } } },
	};
}

function overlay(actions: Overlay['actions'], source = 'overlays/test.yaml'): Overlay {
	return {
		overlay: SUPPORTED_VERSION,
		info: { title: 'Test', version: '1.0.0' },
		actions,
		extensions: {},
		governance: {},
		source,
	};
}

// ---------------------------------------------------------------------------
// JSONPath
// ---------------------------------------------------------------------------

describe('jsonpath — o subconjunto suportado', () => {
	it('encontra um filho por nome e por colchete', () => {
		expect(query(spec(), '$.info.title')[0].value).toBe('API');
		expect(query(spec(), "$.paths['/users'].get")[0].value).toMatchObject({ summary: 'List users' });
	});

	it('resolve índice de array', () => {
		expect(query(spec(), '$.servers[0].url')[0].value).toBe('https://api.example');
	});

	it('expande curinga em ordem de documento', () => {
		const found = query(spec(), '$.paths.*');
		expect(found.map((match) => match.path[1])).toEqual(['/users', '/internal/metrics']);
	});

	it('combina curinga em dois níveis', () => {
		// `$.paths.*.get` pega o get de cada caminho, e não o post.
		const found = query(spec(), '$.paths.*.get');
		expect(found).toHaveLength(2);
		expect(found.every((match) => match.path[2] === 'get')).toBe(true);
	});

	it('desce recursivamente sem repetir nó', () => {
		const found = query(spec(), '$..summary');
		expect(found.map((match) => match.value)).toEqual(['List users', 'Create user', 'Internal']);
	});

	it('devolve lista vazia quando o documento não tem o alvo', () => {
		expect(query(spec(), "$.paths['/nao-existe']")).toEqual([]);
	});

	// Esta é a distinção que evita alguém caçar o bug errado: expressão fora do
	// subconjunto **lança**, em vez de parecer "zero nós encontrados".
	it.each([
		["$.paths[?(@.deprecated)]", 'filtro'],
		['$.paths[(@.length-1)]', 'script'],
		["$.paths['a','b']", 'união'],
		['$.servers[0:2]', 'fatia'],
	])('recusa %s em vez de encontrar zero nós', (expression) => {
		expect(() => parsePath(expression)).toThrow(JsonPathError);
	});

	it('recusa expressão que não começa em $', () => {
		expect(() => parsePath('paths.users')).toThrow(JsonPathError);
	});

	it('escapa barra e til no ponteiro JSON', () => {
		// Sem escape, `/users` e `users` produziriam o mesmo ponteiro e a
		// proveniência apontaria para o nó errado.
		expect(pointerOf(['paths', '/users', 'get'])).toBe('/paths/~1users/get');
		expect(pointerOf(['a~b'])).toBe('/a~0b');
	});
});

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

describe('parse', () => {
	it('lê YAML e JSON pelo mesmo caminho', () => {
		const asYaml = parseOverlay('overlay: 1.0.0\ninfo:\n  title: T\n  version: "1"\nactions: []', 'a.yaml');
		const asJson = parseOverlay('{"overlay":"1.0.0","info":{"title":"T","version":"1"},"actions":[]}', 'a.json');
		expect(asYaml.info).toEqual(asJson.info);
	});

	it('preserva extensões x-* e lê a governança de x-lunar', () => {
		const parsed = parseOverlay(
			'overlay: 1.0.0\ninfo: {title: T, version: "1"}\nx-lunar: {owner: platform, purpose: public-api}\nx-outro: 1\nactions: []',
			'a.yaml'
		);
		expect(parsed.governance.owner).toBe('platform');
		expect(parsed.extensions).toHaveProperty('x-outro');
	});

	it('mantém a posição de uma ação malformada em vez de descartá-la', () => {
		// Descartar faria a ação 1 do relatório ser a ação 2 do arquivo.
		const parsed = parseOverlay(
			'overlay: 1.0.0\ninfo: {title: T, version: "1"}\nactions:\n  - {}\n  - {target: "$.info", remove: true}',
			'a.yaml'
		);
		expect(parsed.actions).toHaveLength(2);
		expect(parsed.actions[0].target).toBe('');
		expect(parsed.actions[1].remove).toBe(true);
	});

	it('lança em YAML inválido', () => {
		expect(() => parseOverlay('actions: [a, b', 'a.yaml')).toThrow(OverlayParseError);
	});

	it('lança quando o documento não é um mapa', () => {
		// Um overlay que é uma lista, ou um texto solto, não tem `info` nem
		// `actions` para ler. Devolver um overlay vazio faria o validador reclamar
		// de campos ausentes em vez de dizer que o arquivo está errado.
		expect(() => parseOverlay('- um\n- dois', 'a.yaml')).toThrow(OverlayParseError);
		expect(() => parseOverlay('só um texto', 'a.yaml')).toThrow(OverlayParseError);
	});
});

// ---------------------------------------------------------------------------
// Validador
// ---------------------------------------------------------------------------

describe('validate — estrutura, não aplicação', () => {
	it('aprova um overlay bem formado', () => {
		const result = validateOverlay(
			overlay([{ target: '$.info', description: 'Motivo', update: { title: 'X' } }])
		);
		expect(result.valid).toBe(true);
		expect(result.issues.filter((issue) => issue.severity === 'error')).toHaveLength(0);
	});

	it('reprova ação sem update nem remove', () => {
		const result = validateOverlay(overlay([{ target: '$.info', description: 'x' }]));
		expect(result.valid).toBe(false);
		expect(result.issues.some((issue) => issue.code === 'OVL-008')).toBe(true);
	});

	it('reprova target com JSONPath fora do subconjunto', () => {
		const result = validateOverlay(overlay([{ target: '$.paths[?(@.x)]', remove: true }]));
		expect(result.issues.some((issue) => issue.code === 'OVL-007')).toBe(true);
	});

	it('avisa, sem reprovar, quando update e remove convivem', () => {
		const result = validateOverlay(
			overlay([{ target: '$.info', description: 'x', update: { a: 1 }, remove: true }])
		);
		expect(result.valid).toBe(true);
		expect(result.issues.find((issue) => issue.code === 'OVL-009')?.severity).toBe('warning');
	});

	it('trata versão diferente como aviso, não como recusa', () => {
		const result = validateOverlay({ ...overlay([{ target: '$.info', remove: true }]), overlay: '1.0.1' });
		expect(result.valid).toBe(true);
		expect(result.issues.find((issue) => issue.code === 'OVL-002')?.severity).toBe('warning');
	});

	it('exige dono e finalidade só quando a governança está ligada', () => {
		const actions = [{ target: '$.info', description: 'x', remove: true }];
		expect(validateOverlay(overlay(actions)).valid).toBe(true);
		expect(validateOverlay(overlay(actions), { requireGovernance: true }).valid).toBe(false);
	});

	// A distinção da spec § 6: um overlay pode estar perfeito e mirar um nó que
	// não existe. Isso não é problema do validador.
	it('aprova overlay cujo alvo não existe no documento', () => {
		expect(validateOverlay(overlay([{ target: "$.paths['/nada']", description: 'x', remove: true }])).valid).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Aplicação
// ---------------------------------------------------------------------------

describe('apply', () => {
	it('mescla em profundidade sem apagar irmãos', () => {
		expect(mergeInto({ a: 1, nested: { x: 1, y: 2 } }, { nested: { y: 9 } })).toEqual({
			a: 1,
			nested: { x: 1, y: 9 },
		});
	});

	it('substitui array em vez de concatenar', () => {
		// Concatenar transformaria "troque os servidores" em "acrescente", e não
		// há sintaxe no overlay para dizer qual dos dois se quer.
		expect(mergeInto({ list: [1, 2] }, { list: [3] })).toEqual({ list: [3] });
	});

	it('remove o alvo', () => {
		const result = applyOverlays({
			document: spec(),
			overlays: [overlay([{ target: "$.paths['/internal/metrics']", remove: true }])],
		});
		expect((result.document as any).paths).not.toHaveProperty('/internal/metrics');
		expect(result.outcomes[0].matched).toBe(1);
	});

	it('não altera o documento original', () => {
		const original = spec();
		applyOverlays({ document: original, overlays: [overlay([{ target: '$.paths', remove: true }])] });
		expect(original.paths).toHaveProperty('/users');
	});

	it('aplica as ações na ordem, e uma vê o resultado da anterior', () => {
		const result = applyOverlays({
			document: spec(),
			overlays: [
				overlay([
					{ target: '$.info', update: { contact: { name: 'A' } } },
					{ target: '$.info.contact', update: { name: 'B' } },
				]),
			],
		});
		expect((result.document as any).info.contact.name).toBe('B');
	});

	it('remove prevalece sobre update na mesma ação', () => {
		const result = applyOverlays({
			document: spec(),
			overlays: [overlay([{ target: "$.paths['/users']", update: { get: { summary: 'X' } }, remove: true }])],
		});
		expect((result.document as any).paths).not.toHaveProperty('/users');
		expect(result.outcomes[0].kind).toBe('remove');
	});

	it('atinge vários nós com curinga', () => {
		const result = applyOverlays({
			document: spec(),
			overlays: [overlay([{ target: '$.paths.*.get', update: { 'x-audited': true } }])],
		});
		expect(result.outcomes[0].matched).toBe(2);
		expect((result.document as any).paths['/users'].get['x-audited']).toBe(true);
	});

	it('separa alvo sem correspondência de alvo inválido', () => {
		const result = applyOverlays({
			document: spec(),
			overlays: [
				overlay([
					{ target: "$.paths['/nada']", remove: true },
					{ target: '$.paths[?(@.x)]', remove: true },
				]),
			],
		});
		expect(result.unmatched).toHaveLength(1);
		expect(result.failed).toHaveLength(1);
		expect(result.failed[0].error).toBeTruthy();
	});

	it('registra proveniência de cada nó alterado', () => {
		const result = applyOverlays({
			document: spec(),
			overlays: [
				overlay([{ target: '$.info', description: 'Enquadra', update: { title: 'Pública' } }], 'overlays/a.yaml'),
			],
		});
		expect(result.provenance[0]).toMatchObject({ pointer: '/info', overlay: 'overlays/a.yaml', action: 0, kind: 'update' });
	});

	it('encadeia overlays na ordem recebida', () => {
		const result = applyOverlays({
			document: spec(),
			overlays: [
				overlay([{ target: '$.info', update: { title: 'Primeiro' } }], 'a.yaml'),
				overlay([{ target: '$.info', update: { title: 'Segundo' } }], 'b.yaml'),
			],
		});
		expect((result.document as any).info.title).toBe('Segundo');
	});
});

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

describe('preview e diff', () => {
	it('nomeia um nó de forma legível', () => {
		expect(labelFor(['paths', '/users', 'get'])).toBe('GET /users');
		expect(labelFor(['info', 'title'])).toBe('info.title');
	});

	it('classifica remoção de operação como incompatível', () => {
		const before = spec();
		const after = spec();
		delete (after.paths as any)['/users'];

		const diff = diffDocuments(before, after, []);
		expect(diff.summary.breaking).toBeGreaterThan(0);
		expect(diff.changes.some((change) => change.kind === 'removed' && change.breaking)).toBe(true);
	});

	it('não classifica descrição alterada como incompatível', () => {
		const before = spec();
		const after = spec();
		(after.paths as any)['/users'].get.summary = 'Outro texto';

		const diff = diffDocuments(before, after, []);
		expect(diff.summary.breaking).toBe(0);
	});

	it('não vê diferença quando nada mudou', () => {
		expect(diffDocuments(spec(), spec(), []).changes).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Conflitos
// ---------------------------------------------------------------------------

describe('conflitos entre overlays', () => {
	function outcome(over: string, index: number, kind: 'update' | 'remove', pointer: string) {
		return { index, overlay: over, target: 'x', kind, matched: 1, pointers: [pointer] };
	}

	it('trata remove seguido de update como erro', () => {
		const conflicts = detectConflicts([
			outcome('a.yaml', 0, 'remove', '/paths/~1users'),
			outcome('b.yaml', 0, 'update', '/paths/~1users'),
		]);
		expect(conflicts).toHaveLength(1);
		expect(conflicts[0].severity).toBe('error');
	});

	it('trata update duplo como aviso', () => {
		const conflicts = detectConflicts([
			outcome('a.yaml', 0, 'update', '/info'),
			outcome('b.yaml', 0, 'update', '/info'),
		]);
		expect(conflicts[0].severity).toBe('warning');
	});

	it('ignora duas ações do mesmo overlay', () => {
		// Ali a ordem é local, visível no arquivo, e costuma ser intencional.
		expect(
			detectConflicts([outcome('a.yaml', 0, 'update', '/info'), outcome('a.yaml', 1, 'update', '/info')])
		).toHaveLength(0);
	});

	it('ignora overlays que mexem em nós independentes', () => {
		expect(
			detectConflicts([outcome('a.yaml', 0, 'update', '/info'), outcome('b.yaml', 0, 'update', '/tags')])
		).toHaveLength(0);
	});

	it('detecta atualização dentro de nó já removido', () => {
		const conflicts = detectConflicts([
			outcome('a.yaml', 0, 'remove', '/paths/~1users'),
			outcome('b.yaml', 0, 'update', '/paths/~1users/get'),
		]);
		expect(conflicts).toHaveLength(1);
		expect(conflicts[0].severity).toBe('error');
	});
});

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------

describe('compare — duas especificações viram um overlay', () => {
	it('escreve o target com aspas quando a chave tem barra', () => {
		expect(targetFor(['paths', '/users'])).toBe("$.paths['/users']");
	});

	it('gera remove para o que saiu e update para o que mudou', () => {
		const before = spec();
		const after = spec();
		delete (after.paths as any)['/internal/metrics'];
		(after.info as any).title = 'Outra';

		const generated = overlayFromComparison({ before, after, title: 'Gerado', version: '1.0.0' });

		expect(generated.actions.some((action) => action.remove && action.target.includes('/internal/metrics'))).toBe(true);
		expect(generated.actions.some((action) => action.update)).toBe(true);
	});

	it('gera um overlay que reproduz o alvo quando reaplicado', () => {
		// O teste que dá sentido ao comando: o overlay gerado leva `before` a `after`.
		const before = spec();
		const after = spec();
		delete (after.paths as any)['/internal/metrics'];
		(after.info as any).title = 'Outra';

		const generated = overlayFromComparison({ before, after, title: 'Gerado', version: '1.0.0' });
		const result = applyOverlays({ document: before, overlays: [generated] });

		expect((result.document as any).paths).not.toHaveProperty('/internal/metrics');
		expect((result.document as any).info.title).toBe('Outra');
	});

	it('serializa em YAML que o parser lê de volta', () => {
		const generated = overlayFromComparison({
			before: spec(),
			after: { ...spec(), info: { title: 'Nova', version: '1.0.0' } },
			title: 'Gerado',
			version: '1.0.0',
		});
		const reparsed = parseOverlay(overlayToYaml(generated), 'gerado.yaml');
		expect(reparsed.actions).toHaveLength(generated.actions.length);
		expect(validateOverlay(reparsed).valid).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Proveniência
// ---------------------------------------------------------------------------

describe('proveniência', () => {
	it('agrupa por nó preservando a ordem de aplicação', () => {
		const history = historyByNode([
			{ pointer: '/paths/~1users', overlay: 'a.yaml', action: 1, kind: 'update' },
			{ pointer: '/paths/~1users', overlay: 'b.yaml', action: 3, kind: 'update' },
			{ pointer: '/info', overlay: 'a.yaml', action: 0, kind: 'update' },
		]);

		const users = history.find((entry) => entry.pointer === '/paths/~1users');
		expect(users?.entries).toHaveLength(2);
		expect(users?.entries.map((entry) => entry.overlay)).toEqual(['a.yaml', 'b.yaml']);
	});
});
