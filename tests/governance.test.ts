import { describe, expect, it } from 'vitest';
import { parseActor, parseGovernance, parseInterval } from '../src/lib/governance/parse';
import { applyRules, findTeam, isSecuritySensitive, ruleFor } from '../src/lib/governance/config';
import { approvalRequirement, computeCompliance, effectiveState, reviewStatus, severityFor } from '../src/lib/governance/review';
import { DEFAULT_CONFIG, type GovernanceConfig, type PageGovernance } from '../src/lib/governance/types';

const DAY = 86_400_000;
const NOW = Date.parse('2026-08-18T12:00:00Z');

const config: GovernanceConfig = {
	...DEFAULT_CONFIG,
	teams: [
		{ id: 'documentation', label: 'Time de Documentação' },
		{ id: 'platform', label: 'Plataforma' },
	],
	defaults: { owner: { type: 'team', id: 'documentation' } },
	rules: [
		{ path: 'api-reference', owner: { type: 'team', id: 'platform' }, reviewIntervalDays: 90 },
		{ path: 'api-reference/internal', reviewIntervalDays: 30 },
	],
	securitySensitive: ['api-reference/authentication.md'],
};

function page(frontmatter: string): string {
	return `---\ntitle: Página\n${frontmatter}---\n\n# Página\n`;
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

describe('parseActor', () => {
	it('lê a forma longa da spec', () => {
		expect(parseActor({ type: 'team', id: 'payments' })).toEqual({ type: 'team', id: 'payments' });
	});

	it('aceita a string solta que as páginas já usavam antes desta camada', () => {
		expect(parseActor('Time de Documentação')).toEqual({ type: 'team', id: 'Time de Documentação' });
	});

	it('trata @fulano como pessoa, não como time', () => {
		expect(parseActor('@andre')).toEqual({ type: 'user', id: 'andre' });
	});

	it('descarta valor sem id em vez de inventar um', () => {
		expect(parseActor({ type: 'team' })).toBeUndefined();
		expect(parseActor('   ')).toBeUndefined();
	});
});

describe('parseInterval', () => {
	it('entende dias, semanas, meses e anos', () => {
		expect(parseInterval('90d')).toBe(90);
		expect(parseInterval('2w')).toBe(14);
		expect(parseInterval('6m')).toBe(180);
		expect(parseInterval('1y')).toBe(365);
	});

	it('número puro são dias', () => {
		expect(parseInterval(45)).toBe(45);
	});

	it('valor sem sentido não vira intervalo', () => {
		expect(parseInterval('sempre')).toBeUndefined();
		expect(parseInterval(0)).toBeUndefined();
		expect(parseInterval(-30)).toBeUndefined();
	});
});

describe('parseGovernance', () => {
	it('lê o bloco governance da spec', () => {
		const parsed = parseGovernance(
			'p.md',
			page('governance:\n  owner:\n    type: team\n    id: payments\n  review:\n    interval: 90d\n')
		);

		expect(parsed.owner).toEqual({ type: 'team', id: 'payments' });
		expect(parsed.reviewIntervalDays).toBe(90);
	});

	it('o owner solto continua valendo quando não há bloco governance', () => {
		expect(parseGovernance('p.md', page('owner: Time de Documentação\n')).owner?.id).toBe('Time de Documentação');
	});

	it('o bloco governance vence o owner solto', () => {
		const parsed = parseGovernance('p.md', page('owner: Antigo\ngovernance:\n  owner: Novo\n'));
		expect(parsed.owner?.id).toBe('Novo');
	});

	it('lê a data de revisão declarada', () => {
		const parsed = parseGovernance('p.md', page('governance:\n  review:\n    at: 2026-05-01\n    by: mestre\n'));
		expect(parsed.reviewedAt?.slice(0, 10)).toBe('2026-05-01');
		expect(parsed.reviewedBy).toBe('mestre');
	});

	it('estado inválido é ignorado em vez de virar estado', () => {
		expect(parseGovernance('p.md', page('governance:\n  state: quase\n')).state).toBeUndefined();
	});

	it('frontmatter ilegível não derruba a leitura', () => {
		expect(parseGovernance('p.md', '---\ntitle: [\n---\n\ncorpo\n').owner).toBeUndefined();
	});

	it('página sem frontmatter simplesmente não tem governança declarada', () => {
		expect(parseGovernance('p.md', '# Só o corpo\n').inherited).toEqual({});
	});
});

// ---------------------------------------------------------------------------
// Regras
// ---------------------------------------------------------------------------

describe('ruleFor', () => {
	it('a regra mais específica vence, não a declarada por último', () => {
		expect(ruleFor(config.rules, 'api-reference/internal/x.md')?.path).toBe('api-reference/internal');
	});

	it('prefixo só casa em fronteira de diretório', () => {
		expect(ruleFor(config.rules, 'api-reference-antiga/x.md')).toBeUndefined();
	});
});

describe('applyRules', () => {
	it('herda dono da regra e registra de onde ele veio', () => {
		const merged = applyRules({ path: 'api-reference/x.md', inherited: {} }, config);

		expect(merged.owner?.id).toBe('platform');
		expect(merged.inherited.owner).toContain('api-reference');
	});

	it('a página vence a regra, e nada é marcado como herdado', () => {
		const merged = applyRules(
			{ path: 'api-reference/x.md', owner: { type: 'team', id: 'documentation' }, inherited: {} },
			config
		);

		expect(merged.owner?.id).toBe('documentation');
		expect(merged.inherited.owner).toBeUndefined();
	});

	it('cai no padrão quando nenhuma regra casa', () => {
		const merged = applyRules({ path: 'index.md', inherited: {} }, config);
		expect(merged.owner?.id).toBe('documentation');
		expect(merged.inherited.owner).toBe('padrão');
	});

	it('normaliza o time escrito pelo rótulo para o id declarado', () => {
		// Sem isto o mesmo time aparecia duas vezes no relatório: uma pelo id da
		// regra, outra pelo rótulo escrito nas páginas antigas.
		const merged = applyRules({ path: 'x.md', owner: { type: 'team', id: 'Time de Documentação' }, inherited: {} }, config);
		expect(merged.owner?.id).toBe('documentation');
		expect(merged.owner?.label).toBe('Time de Documentação');
	});

	it('procura o time ignorando acento e caixa', () => {
		expect(findTeam(config, 'DOCUMENTAÇÃO')).toBeUndefined();
		expect(findTeam(config, 'Documentation')?.id).toBe('documentation');
	});
});

describe('isSecuritySensitive', () => {
	it('reconhece o caminho declarado', () => {
		expect(isSecuritySensitive('api-reference/authentication.md', config)).toBe(true);
	});

	it('não confunde prefixo com diretório', () => {
		expect(isSecuritySensitive('api-reference/authentication-v2.md', config)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Revisão
// ---------------------------------------------------------------------------

function status(overrides: Partial<PageGovernance>, intervalDays?: number) {
	return reviewStatus({ page: { path: 'p.md', inherited: {}, ...overrides }, config, intervalDays, now: NOW });
}

describe('reviewStatus', () => {
	it('página revisada dentro do intervalo está em dia', () => {
		const result = status({ reviewedAt: new Date(NOW - 10 * DAY).toISOString() }, 90);

		expect(result.expired).toBe(false);
		expect(result.state).toBe('published');
		expect(result.daysUntilDue).toBe(80);
	});

	it('página revisada além do intervalo vence', () => {
		const result = status({ reviewedAt: new Date(NOW - 100 * DAY).toISOString() }, 90);

		expect(result.expired).toBe(true);
		expect(result.state).toBe('review-required');
		expect(result.daysUntilDue).toBe(-10);
	});

	it('nunca revisada não é o mesmo que vencida', () => {
		// O relatório real desmentiu a primeira versão: no dia em que o regime
		// entrou, 27 páginas apareceram como atrasadas sem que nada tivesse
		// atrasado.
		const result = status({}, 90);

		expect(result.expired).toBe(false);
		expect(result.neverReviewed).toBe(true);
		expect(result.underRegime).toBe(true);
		expect(result.state).toBe('review-required');
	});

	it('página sem intervalo não está atrasada nem em dia — está fora do regime', () => {
		const result = status({});

		expect(result.underRegime).toBe(false);
		expect(result.expired).toBe(false);
		expect(result.state).toBe('published');
		expect(result.dueAt).toBeNull();
	});

	it('rascunho continua rascunho mesmo com revisão vencida', () => {
		const result = status({ state: 'draft', reviewedAt: new Date(NOW - 400 * DAY).toISOString() }, 90);
		expect(result.state).toBe('draft');
	});

	it('data de revisão inválida conta como nunca revisada, não como hoje', () => {
		const result = status({ reviewedAt: 'ontem' }, 90);
		expect(result.neverReviewed).toBe(true);
	});
});

describe('severityFor', () => {
	it('cresce com o atraso', () => {
		expect(severityFor(5, false)).toBe('medium');
		expect(severityFor(45, false)).toBe('high');
		expect(severityFor(120, false)).toBe('critical');
	});

	it('em dia é low', () => {
		expect(severityFor(null, false)).toBe('low');
	});

	it('nunca revisada é medium, não critical', () => {
		expect(severityFor(null, true)).toBe('medium');
	});
});

describe('effectiveState', () => {
	it('publicada vencida vira revisão pendente', () => {
		expect(effectiveState({ path: 'p.md', inherited: {} }, true)).toBe('review-required');
	});

	it('em revisão não é sobrescrita pelo vencimento', () => {
		expect(effectiveState({ path: 'p.md', state: 'in-review', inherited: {} }, true)).toBe('in-review');
	});
});

// ---------------------------------------------------------------------------
// Aprovação
// ---------------------------------------------------------------------------

describe('approvalRequirement', () => {
	const base = { page: { path: 'p.md', inherited: {} } as PageGovernance, config };

	it('página que documenta API pública exige aprovação', () => {
		const requirement = approvalRequirement({ ...base, documentsPublicApi: true });
		expect(requirement?.triggers).toEqual(['public-api']);
	});

	it('página sem gatilho não exige nada', () => {
		expect(approvalRequirement(base)).toBeNull();
	});

	it('gatilho fora da configuração não conta', () => {
		const restricted = { ...config, approvalRequiredFor: ['breaking-change' as const] };
		expect(approvalRequirement({ ...base, config: restricted, documentsPublicApi: true })).toBeNull();
	});

	it('sem aprovador designado a exigência não está satisfeita', () => {
		expect(approvalRequirement({ ...base, securitySensitive: true })?.satisfied).toBe(false);
	});

	it('com aprovador designado ela está', () => {
		const requirement = approvalRequirement({
			...base,
			page: { path: 'p.md', approver: { type: 'team', id: 'platform' }, inherited: {} },
			securitySensitive: true,
		});

		expect(requirement?.satisfied).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Conformidade
// ---------------------------------------------------------------------------

describe('computeCompliance', () => {
	const pages: PageGovernance[] = [
		{ path: 'a.md', owner: { type: 'team', id: 'x' }, inherited: {} },
		{ path: 'b.md', inherited: {} },
	];

	it('mede cobertura de dono sobre todas as páginas', () => {
		const report = computeCompliance({ pages, statuses: [], approvals: [] });

		expect(report.ownership.percentage).toBe(50);
		expect(report.unownedPages).toEqual(['b.md']);
	});

	it('a conta de revisão ignora quem está fora do regime', () => {
		const statuses = [
			status({ reviewedAt: new Date(NOW - 10 * DAY).toISOString() }, 90),
			status({}),
		];

		const report = computeCompliance({ pages, statuses, approvals: [] });
		expect(report.review.total).toBe(1);
		expect(report.review.percentage).toBe(100);
	});

	it('nunca revisada entra na própria contagem, não na de vencidas', () => {
		const report = computeCompliance({ pages, statuses: [status({}, 90)], approvals: [] });

		expect(report.expiredReviews).toBe(0);
		expect(report.neverReviewed).toBe(1);
	});

	it('sem página que exija aprovação o percentual é null, não 0%', () => {
		const report = computeCompliance({ pages, statuses: [], approvals: [] });
		expect(report.approval.percentage).toBeNull();
	});

	it('portal vazio não vira 0% de cobertura', () => {
		const report = computeCompliance({ pages: [], statuses: [], approvals: [] });
		expect(report.ownership.percentage).toBeNull();
	});
});
