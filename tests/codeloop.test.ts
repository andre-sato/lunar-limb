import { describe, expect, it } from 'vitest';
import {
	analyzeImpact,
	blocksMerge,
	computeConsistency,
	computeReleaseCoverage,
	evaluatePolicy,
	findOrphans,
	findUndocumented,
} from '../src/lib/codeloop/analyze';
import { candidateIds, indexBindings, normalizeApiId, parseBindings, resolveBindings } from '../src/lib/codeloop/bindings';
import { endpointLineSpans } from '../src/lib/codeloop/service';
import { DEFAULT_POLICY, type CodeLoopPolicy, type ResolvedBinding } from '../src/lib/codeloop/types';
import type { TwinGraph } from '../src/lib/twin/types';

const policy: CodeLoopPolicy = { ...DEFAULT_POLICY };

function page(bindings: string): string {
	return `---\ntitle: Pagamentos\n${bindings}---\n\n# Pagamentos\n`;
}

const graph: TwinGraph = {
	nodes: [
		{ id: 'endpoint:POST /api/payments', type: 'endpoint', name: 'POST /api/payments' },
		{ id: 'endpoint:GET /api/payments/{id}', type: 'endpoint', name: 'GET /api/payments/{id}' },
		{ id: 'schema:Payment', type: 'schema', name: 'Payment' },
	],
	edges: [],
} as unknown as TwinGraph;

// ---------------------------------------------------------------------------
// Vínculos
// ---------------------------------------------------------------------------

describe('parseBindings', () => {
	it('lê a forma longa da spec', () => {
		const raw = page('documentation:\n  bindings:\n    - type: api\n      id: POST /api/payments\n');
		const bindings = parseBindings('payments.md', raw, policy);

		expect(bindings).toHaveLength(1);
		expect(bindings[0].entityId).toBe('POST /api/payments');
		expect(bindings[0].documentationId).toBe('payments.md');
	});

	it('aceita também a forma curta, sem o nível documentation', () => {
		const raw = page('bindings:\n  - type: api\n    id: POST /api/payments\n');
		expect(parseBindings('payments.md', raw, policy)).toHaveLength(1);
	});

	it('marca como obrigatório o que a política exige, e opcional o resto', () => {
		const raw = page(
			'documentation:\n  bindings:\n    - type: api\n      id: POST /api/payments\n    - type: function\n      id: src/lib/pay.ts#charge\n'
		);
		const bindings = parseBindings('payments.md', raw, policy);

		expect(bindings[0].required).toBe(true);
		expect(bindings[1].required).toBe(false);
	});

	it('respeita required declarado explicitamente na página', () => {
		const raw = page('documentation:\n  bindings:\n    - type: api\n      id: POST /api/payments\n      required: false\n');
		expect(parseBindings('payments.md', raw, policy)[0].required).toBe(false);
	});

	it('descarta entrada sem tipo válido em vez de inventar um', () => {
		const raw = page('documentation:\n  bindings:\n    - type: banana\n      id: X\n    - id: sem-tipo\n');
		expect(parseBindings('payments.md', raw, policy)).toEqual([]);
	});

	it('não derruba a leitura quando o frontmatter é YAML inválido', () => {
		expect(parseBindings('quebrada.md', '---\ntitle: [\n---\n\ncorpo\n', policy)).toEqual([]);
	});

	it('página sem frontmatter simplesmente não participa do loop', () => {
		expect(parseBindings('sem.md', '# Só o corpo\n', policy)).toEqual([]);
	});

	it('normaliza o caminho do endpoint como o Digital Twin faz', () => {
		expect(normalizeApiId('post /api/payments/[id]')).toBe(normalizeApiId('POST /api/payments/{id}'));
	});

	it('deixa identificador que não é endpoint como está', () => {
		expect(normalizeApiId('payments.create')).toBe('payments.create');
	});
});

describe('resolveBindings', () => {
	it('resolve o que existe no produto', () => {
		const bindings = parseBindings(
			'payments.md',
			page('documentation:\n  bindings:\n    - type: api\n      id: POST /api/payments\n'),
			policy
		);

		expect(resolveBindings(bindings, graph)[0].resolved).toBe(true);
	});

	it('marca o que não existe em vez de aceitar identificador arbitrário', () => {
		const bindings = parseBindings(
			'payments.md',
			page('documentation:\n  bindings:\n    - type: api\n      id: DELETE /api/inventado\n'),
			policy
		);

		const resolved = resolveBindings(bindings, graph)[0];
		expect(resolved.resolved).toBe(false);
		expect(resolved.reason).toContain('Digital Twin');
	});

	it('procura serviço e função pelo arquivo, ignorando o sufixo do símbolo', () => {
		expect(candidateIds({ documentationId: 'p.md', entityType: 'function', entityId: 'src/lib/pay.ts#charge', required: false })).toContain(
			'code:src/lib/pay.ts'
		);
	});
});

describe('indexBindings', () => {
	it('indexa nas duas direções sem duplicar a mesma página', () => {
		const bindings: ResolvedBinding[] = [
			{ documentationId: 'a.md', entityType: 'api', entityId: 'POST /x', required: true, resolved: true },
			{ documentationId: 'a.md', entityType: 'api', entityId: 'POST /x', required: true, resolved: true },
			{ documentationId: 'b.md', entityType: 'api', entityId: 'POST /x', required: true, resolved: true },
		];

		const index = indexBindings(bindings);
		expect(index.byEntity.get('POST /x')).toEqual(['a.md', 'b.md']);
		expect(index.byPage.get('a.md')).toHaveLength(2);
	});
});

// ---------------------------------------------------------------------------
// Impacto
// ---------------------------------------------------------------------------

const byEntity = new Map([['POST /api/payments', ['api/payments.md']]]);

describe('analyzeImpact', () => {
	it('marca como defasada a página vinculada que não mudou junto', () => {
		const impact = analyzeImpact({
			changeId: 'x',
			changedEntities: [{ entityId: 'POST /api/payments', entityType: 'api' }],
			changedPages: [],
			byEntity,
			policy,
		});

		expect(impact.affectedPages[0].stale).toBe(true);
		expect(impact.coverage).toBe(0);
	});

	it('conta como coberta a entidade cuja página mudou no mesmo conjunto', () => {
		const impact = analyzeImpact({
			changeId: 'x',
			changedEntities: [{ entityId: 'POST /api/payments', entityType: 'api' }],
			changedPages: ['api/payments.md'],
			byEntity,
			policy,
		});

		expect(impact.affectedPages[0].stale).toBe(false);
		expect(impact.coverage).toBe(100);
	});

	it('separa "sem página nenhuma" de "página não atualizada"', () => {
		const impact = analyzeImpact({
			changeId: 'x',
			changedEntities: [
				{ entityId: 'POST /api/payments', entityType: 'api' },
				{ entityId: 'DELETE /api/payments', entityType: 'api' },
			],
			changedPages: [],
			byEntity,
			policy,
		});

		expect(impact.missingDocumentation.map((entity) => entity.entityId)).toEqual(['DELETE /api/payments']);
		expect(impact.affectedPages).toHaveLength(1);
	});

	it('mudança que não toca entidade nenhuma tem cobertura 100, não 0', () => {
		const impact = analyzeImpact({ changeId: 'x', changedEntities: [], changedPages: [], byEntity, policy });
		expect(impact.coverage).toBe(100);
	});
});

// ---------------------------------------------------------------------------
// Política
// ---------------------------------------------------------------------------

describe('evaluatePolicy', () => {
	function impactWithMissing(entityType: 'api' | 'function') {
		return analyzeImpact({
			changeId: 'x',
			changedEntities: [{ entityId: 'X', entityType }],
			changedPages: [],
			byEntity: new Map(),
			policy,
		});
	}

	it('entidade de tipo obrigatório sem página é erro', () => {
		const violations = evaluatePolicy(impactWithMissing('api'), policy);
		expect(violations[0].severity).toBe('error');
		expect(blocksMerge(violations, policy)).toBe(true);
	});

	it('entidade de tipo não obrigatório sem página é só aviso', () => {
		const violations = evaluatePolicy(impactWithMissing('function'), policy);
		expect(violations[0].severity).toBe('warning');
		expect(blocksMerge(violations, policy)).toBe(false);
	});

	it('failOnViolation desligado não bloqueia nem com erro', () => {
		const relaxed = { ...policy, failOnViolation: false };
		expect(blocksMerge(evaluatePolicy(impactWithMissing('api'), relaxed), relaxed)).toBe(false);
	});

	it('mudança incompatível sem guia de migração é erro', () => {
		const impact = analyzeImpact({
			changeId: 'x',
			changedEntities: [{ entityId: 'POST /api/payments', entityType: 'api', breaking: true }],
			changedPages: ['api/payments.md'],
			byEntity,
			policy,
		});

		expect(evaluatePolicy(impact, policy).some((violation) => violation.rule === 'breakingChanges.requireMigrationGuide')).toBe(true);
	});

	it('mudança incompatível com guia de migração atualizado não viola', () => {
		const impact = analyzeImpact({
			changeId: 'x',
			changedEntities: [{ entityId: 'POST /api/payments', entityType: 'api', breaking: true }],
			changedPages: ['api/payments.md'],
			byEntity,
			migrationGuides: ['guides/migracao-v2.md'],
			policy,
		});

		expect(evaluatePolicy(impact, policy).some((violation) => violation.rule === 'breakingChanges.requireMigrationGuide')).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Consistência
// ---------------------------------------------------------------------------

describe('computeConsistency', () => {
	const bindings: ResolvedBinding[] = [
		{ documentationId: 'a.md', entityType: 'api', entityId: 'POST /x', required: true, resolved: true },
		{ documentationId: 'b.md', entityType: 'api', entityId: 'POST /y', required: true, resolved: false },
	];

	it('mede vínculos que resolvem sobre vínculos declarados', () => {
		const report = computeConsistency({ bindings, endpoints: [], schemas: [], commands: [] });
		expect(report.slices.find((slice) => slice.name === 'Endpoints')?.percentage).toBe(50);
	});

	it('fatia sem nada declarado vem como null, não como 0%', () => {
		const report = computeConsistency({ bindings, endpoints: [], schemas: [], commands: [] });
		expect(report.slices.find((slice) => slice.name === 'Comandos')?.percentage).toBeNull();
	});

	it('a média ignora as fatias sem dado em vez de puxá-las para baixo', () => {
		const report = computeConsistency({ bindings, endpoints: [], schemas: [], commands: [] });
		expect(report.overall).toBe(50);
	});

	it('sem nenhum vínculo declarado o geral é null', () => {
		expect(computeConsistency({ bindings: [], endpoints: [], schemas: [], commands: [] }).overall).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Órfãos e não documentados
// ---------------------------------------------------------------------------

describe('findOrphans', () => {
	it('só o que não resolve, e sempre como "potencialmente"', () => {
		const orphans = findOrphans([
			{ documentationId: 'a.md', entityType: 'api', entityId: 'POST /x', required: true, resolved: true },
			{ documentationId: 'b.md', entityType: 'api', entityId: 'POST /y', required: true, resolved: false },
		]);

		expect(orphans).toHaveLength(1);
		expect(orphans[0].documentationId).toBe('b.md');
		expect(orphans[0].reason).toMatch(/hist[óo]rico|planejado/i);
	});
});

describe('findUndocumented', () => {
	it('menção em texto não conta: o que conta é o vínculo declarado', () => {
		const undocumented = findUndocumented({
			entities: [{ entityId: 'POST /api/payments', entityType: 'api', evidence: ['mencionado em uma página'] }],
			byEntity: new Map(),
			policy,
		});

		expect(undocumented).toHaveLength(1);
		expect(undocumented[0].required).toBe(true);
	});

	it('entidade com vínculo declarado não aparece', () => {
		const undocumented = findUndocumented({
			entities: [{ entityId: 'POST /api/payments', entityType: 'api', evidence: [] }],
			byEntity,
			policy,
		});

		expect(undocumented).toEqual([]);
	});
});

describe('computeReleaseCoverage', () => {
	it('entidade nova sem página conta como não documentada', () => {
		const coverage = computeReleaseCoverage({
			newEntities: ['POST /api/refunds'],
			changedEntities: [],
			removedEntities: [],
			breakingEntities: [],
			byEntity,
			updatedPages: [],
			migrationGuides: [],
		});

		expect(coverage.summary.missing).toBe(1);
		expect(coverage.overall).toBe(0);
	});

	it('release que não mexeu em nada mensurável não vira 0%', () => {
		const coverage = computeReleaseCoverage({
			newEntities: [],
			changedEntities: [],
			removedEntities: [],
			breakingEntities: [],
			byEntity,
			updatedPages: [],
			migrationGuides: [],
		});

		expect(coverage.overall).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Precisão do impacto na especificação
// ---------------------------------------------------------------------------

describe('endpointLineSpans', () => {
	const spec = [
		'openapi: 3.1.0',
		'info:',
		'  title: Portal',
		'paths:',
		'  /auth/me:',
		'    get:',
		'      summary: Sessão atual',
		'      responses:',
		'        "200":',
		'          description: ok',
		'  /chat/message:',
		'    post:',
		'      summary: Conversa',
		'components:',
		'  schemas: {}',
	].join('\n');

	it('delimita cada operação da especificação', () => {
		const spans = endpointLineSpans(spec);

		expect(spans.map((span) => `${span.method} ${span.path}`)).toEqual(['GET /auth/me', 'POST /chat/message']);
	});

	it('a operação termina onde a próxima começa — não engole a seguinte', () => {
		const [first] = endpointLineSpans(spec);
		expect(first.start).toBe(6);
		expect(first.end).toBe(10);
	});

	it('não estende a última operação para dentro de components', () => {
		const last = endpointLineSpans(spec).at(-1)!;
		expect(last.end).toBe(13);
	});

	it('especificação sem paths não produz nenhuma faixa', () => {
		expect(endpointLineSpans('openapi: 3.1.0\ninfo:\n  title: X\n')).toEqual([]);
	});
});
