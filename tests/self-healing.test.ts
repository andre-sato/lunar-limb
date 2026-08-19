import { describe, expect, it } from 'vitest';
import { assessRisk, detectConflict, diagnose, mostAuthoritative, type SourceClaim } from '../src/lib/heal/diagnose';
import { addedLines, checkLinks, checkMarkdown, checkNoPlaceholders, checkRemoval, removedLines } from '../src/lib/heal/validate';
import { headlineOf, yamlScalar } from '../src/lib/agents/writer';
import { DEFAULT_HEALING_POLICY, type DocumentationChange, type HealingIssue } from '../src/lib/heal/types';

function issue(partial: Partial<HealingIssue> = {}): HealingIssue {
	return {
		id: 'i1',
		type: 'contract-mismatch',
		severity: 'high',
		confidence: 0.9,
		evidence: [{ fact: 'divergência', source: 'contrato', confidence: 0.9 }],
		affectedPages: ['api/pagamentos.md'],
		entityId: 'POST /api/payments',
		status: 'detected',
		detectedAt: '2026-08-19T00:00:00.000Z',
		summary: 'divergência de contrato',
		...partial,
	};
}

function change(diff: string, path = 'p.md'): DocumentationChange {
	return {
		path,
		diff,
		added: addedLines(diff).length,
		removed: removedLines(diff).length,
	};
}

// ---------------------------------------------------------------------------
// Fontes e conflito
// ---------------------------------------------------------------------------

describe('mostAuthoritative', () => {
	it('o contrato de produção vence o código', () => {
		const claims: SourceClaim[] = [
			{ source: 'source-code', reference: 'a.ts', claim: 'x' },
			{ source: 'production-contract', reference: 'api.yaml', claim: 'x' },
		];

		expect(mostAuthoritative(claims, DEFAULT_HEALING_POLICY.authority)?.source).toBe('production-contract');
	});
});

describe('detectConflict', () => {
	it('duas fontes autoritativas discordando é conflito', () => {
		const claims: SourceClaim[] = [
			{ source: 'production-contract', reference: 'api.yaml', claim: 'client_secret obrigatório' },
			{ source: 'source-code', reference: 'auth.ts', claim: 'client_secret opcional' },
		];

		expect(detectConflict(claims)).toBeDefined();
	});

	it('documentação divergindo do contrato não é conflito — é o problema', () => {
		const claims: SourceClaim[] = [
			{ source: 'production-contract', reference: 'api.yaml', claim: 'obrigatório' },
			{ source: 'documentation', reference: 'p.md', claim: 'opcional' },
		];

		expect(detectConflict(claims)).toBeUndefined();
	});

	it('fontes autoritativas concordando não é conflito', () => {
		const claims: SourceClaim[] = [
			{ source: 'production-contract', reference: 'api.yaml', claim: 'igual' },
			{ source: 'source-code', reference: 'a.ts', claim: 'igual' },
		];

		expect(detectConflict(claims)).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Diagnóstico
// ---------------------------------------------------------------------------

describe('diagnose', () => {
	const policy = DEFAULT_HEALING_POLICY;

	it('conflito zera a confiança e impede correção', () => {
		const result = diagnose({
			issue: issue(),
			claims: [
				{ source: 'production-contract', reference: 'api.yaml', claim: 'obrigatório' },
				{ source: 'source-code', reference: 'a.ts', claim: 'opcional' },
			],
			policy,
		});

		expect(result.confidence).toBe(0);
		expect(result.unhealable).toBe(true);
		expect(result.conflict).toBeDefined();
	});

	it('sem fonte autoritativa não há o que copiar para a documentação', () => {
		const result = diagnose({ issue: issue(), claims: [], policy });

		expect(result.unhealable).toBe(true);
		expect(result.reason).toContain('autoritativa');
	});

	it('fonte mais nova que a documentação aponta a causa', () => {
		const result = diagnose({
			issue: issue(),
			claims: [
				{ source: 'production-contract', reference: 'api.yaml', claim: 'x', changedAt: '2026-08-17T00:00:00.000Z' },
			],
			policy,
			documentationChangedAt: '2026-06-03T00:00:00.000Z',
		});

		expect(result.rootCause).toContain('não acompanhou');
		expect(result.unhealable).toBe(false);
	});

	it('documentação mais nova que a fonte reduz a confiança em vez de inventar causa', () => {
		const result = diagnose({
			issue: issue(),
			claims: [
				{ source: 'production-contract', reference: 'api.yaml', claim: 'x', changedAt: '2026-01-01T00:00:00.000Z' },
			],
			policy,
			documentationChangedAt: '2026-08-01T00:00:00.000Z',
		});

		expect(result.confidence).toBeLessThan(0.6);
	});

	it('documentação ausente é diagnosticável sem fonte autoritativa', () => {
		const result = diagnose({ issue: issue({ type: 'missing-documentation' }), claims: [], policy });
		expect(result.unhealable).toBe(false);
	});

	it('a confiança do diagnóstico nunca supera a do problema', () => {
		// Diagnosticar bem um problema duvidoso continua sendo duvidoso.
		const result = diagnose({
			issue: issue({ type: 'missing-documentation', confidence: 0.3 }),
			claims: [],
			policy,
		});

		expect(result.confidence).toBeLessThanOrEqual(0.3);
	});

	it('lacuna comportamental não soa mais certa que o sinal', () => {
		const result = diagnose({ issue: issue({ type: 'behavioral-gap', confidence: 0.9 }), claims: [], policy });
		expect(result.confidence).toBeLessThanOrEqual(0.6);
	});
});

// ---------------------------------------------------------------------------
// Risco
// ---------------------------------------------------------------------------

describe('assessRisk', () => {
	it('correção pequena e aditiva é baixo risco', () => {
		expect(assessRisk({ issue: issue({ type: 'stale' }), added: 3, removed: 0, pages: 1 }).risk).toBe('low');
	});

	it('página sensível a segurança sobe o risco', () => {
		const result = assessRisk({ issue: issue(), added: 3, removed: 0, pages: 1, securitySensitive: true });
		expect(result.risk).toBe('high');
	});

	it('remoção grande pesa mais que adição grande', () => {
		const removing = assessRisk({ issue: issue({ type: 'stale' }), added: 0, removed: 30, pages: 1 });
		const adding = assessRisk({ issue: issue({ type: 'stale' }), added: 30, removed: 0, pages: 1 });

		expect(removing.risk).not.toBe(adding.risk);
	});

	it('sempre explica por quê', () => {
		expect(assessRisk({ issue: issue({ type: 'stale' }), added: 1, removed: 0, pages: 1 }).factors.length).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

describe('checkMarkdown', () => {
	it('aprova Markdown bem formado', () => {
		expect(checkMarkdown([change('+---\n+title: X\n+---\n+\n+Texto.')]).passed).toBe(true);
	});

	it('reprova frontmatter que não é YAML válido', () => {
		// A primeira proposta real do ciclo passou nesta validação com o
		// frontmatter quebrado pela instrução de várias linhas.
		const broken = change('+---\n+title: Documentar\n+Use apenas as evidências abaixo\n+description: X\n+---');
		expect(checkMarkdown([broken]).passed).toBe(false);
	});

	it('reprova cerca de código sem fechamento', () => {
		expect(checkMarkdown([change('+```bash\n+npm run x')]).passed).toBe(false);
	});

	it('reprova link sem fechamento', () => {
		expect(checkMarkdown([change('+veja o [guia](/guides/x')]).passed).toBe(false);
	});
});

describe('checkNoPlaceholders', () => {
	it('reprova TODO', () => {
		expect(checkNoPlaceholders([change('+TODO: escrever isto')]).passed).toBe(false);
	});

	it('reprova o marcador que o próprio Writer emite sem evidência', () => {
		// A validação aprovava um texto que dizia, nele mesmo, que faltava
		// evidência para redigi-lo.
		expect(checkNoPlaceholders([change('+<!-- ESCREVER: sem evidência suficiente -->')]).passed).toBe(false);
	});

	it('aprova texto sem marcador', () => {
		expect(checkNoPlaceholders([change('+Texto completo e verificado.')]).passed).toBe(true);
	});
});

describe('checkLinks', () => {
	it('reprova link para caminho local', () => {
		expect(checkLinks([change('+[x](C:/Users/andre/nota.md)')]).passed).toBe(false);
	});

	it('reprova link com destino vazio', () => {
		expect(checkLinks([change('+[x]()')]).passed).toBe(false);
	});

	it('aprova link relativo comum', () => {
		expect(checkLinks([change('+[x](/guides/intro/)')]).passed).toBe(true);
	});
});

describe('checkRemoval', () => {
	it('reprova remoção grande com pouca reposição', () => {
		const diff = ['+uma linha nova', ...Array.from({ length: 20 }, (_, index) => `-linha ${index}`)].join('\n');
		expect(checkRemoval([change(diff)]).passed).toBe(false);
	});

	it('aprova reescrita que repõe o que removeu', () => {
		const diff = [
			...Array.from({ length: 15 }, (_, index) => `-antiga ${index}`),
			...Array.from({ length: 15 }, (_, index) => `+nova ${index}`),
		].join('\n');

		expect(checkRemoval([change(diff)]).passed).toBe(true);
	});

	it('remoção pequena não bloqueia', () => {
		expect(checkRemoval([change('-uma linha\n+outra')]).passed).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Writer: título e frontmatter
// ---------------------------------------------------------------------------

describe('headlineOf', () => {
	it('usa apenas a primeira linha da instrução', () => {
		// Cortar por caractere ignorando a quebra de linha fazia a instrução inteira
		// vazar para o frontmatter, que deixava de ser YAML.
		expect(headlineOf('Documentar POST /api/auth/login\n\nCausa provável: algo', 60)).toBe(
			'Documentar POST /api/auth/login'
		);
	});

	it('respeita o limite de caracteres', () => {
		expect(headlineOf('a'.repeat(200), 60)).toHaveLength(60);
	});

	it('instrução vazia não vira título vazio', () => {
		expect(headlineOf('\n\n', 60)).toBe('Documentação');
	});
});

describe('yamlScalar', () => {
	it('aspas o valor que contém dois-pontos', () => {
		expect(yamlScalar('Documentar POST /api/x: sessão')).toBe('"Documentar POST /api/x: sessão"');
	});

	it('deixa texto simples como está', () => {
		expect(yamlScalar('Autenticação')).toBe('Autenticação');
	});
});
