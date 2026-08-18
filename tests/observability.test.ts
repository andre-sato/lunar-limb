/**
 * Testes de Documentation Observability & SLO.
 *
 * Três regras concentram o valor desta camada, e as três são o tipo de coisa que
 * some numa refatoração se não estiver presa por teste:
 *
 *  1. **A idade sozinha não determina obsolescência.** Conteúdo estável fica
 *     válido por anos; o que decide é o cruzamento com evidência de divergência.
 *  2. **Não medido não é zero** — herdada do painel de saúde, e agora valendo
 *     também para a saúde por página.
 *  3. **Orçamento zero é caso normal**, não divisão por zero: link quebrado e
 *     contrato quebrado não têm cota.
 */

import { describe, it, expect } from 'vitest';
import { assessStaleness, bucketFor, summarizeFreshness } from '../src/lib/health/staleness';
import { computePageHealth, evaluateBudget, evaluateBudgets } from '../src/lib/health/budget';
import { correlateChanges, detectRegression, snapshotNearest, withinDays, type HealthSnapshot } from '../src/lib/health/snapshots';

function snapshot(partial: Partial<HealthSnapshot> = {}): HealthSnapshot {
	return {
		at: new Date().toISOString(),
		score: 90,
		dimensions: { quality: 95, coverage: 85 },
		reliability: { brokenLinks: 0, failedTests: 0, brokenContracts: 0, invalidPages: 0 },
		...partial,
	};
}

// ---------------------------------------------------------------------------
// Frescor (§6.4, §7)
// ---------------------------------------------------------------------------

describe('detecção de obsolescência', () => {
	it('página velha e sem sinal de divergência continua atual', () => {
		// A regra que a spec deixa explícita. Um portal que pinta de vermelho tudo
		// que passou de 180 dias enche a tela em conteúdo conceitual correto.
		const verdict = assessStaleness({ path: 'guides/conceito.md', ageDays: 400 });
		expect(verdict.status).toBe('potentially-stale');
		expect(verdict.reasons.join(' ')).toContain('400');
	});

	it('idade sozinha só levanta suspeita depois de um ano', () => {
		// Meio ano sem edição, e nada mais, é conteúdo estável — não obsoleto. A
		// suspeita começa quando a página atravessa um ano inteiro sem ninguém
		// olhar, e mesmo aí ela não passa de "possivelmente".
		expect(assessStaleness({ path: 'a.md', ageDays: 200 }).status).toBe('fresh');
		expect(assessStaleness({ path: 'a.md', ageDays: 400 }).status).toBe('potentially-stale');
	});

	it('contrato quebrado torna obsoleta mesmo com a página editada ontem', () => {
		const verdict = assessStaleness({ path: 'a.md', ageDays: 1, brokenContracts: 2 });
		expect(verdict.status).toBe('stale');
	});

	it('evidência inválida também torna obsoleta', () => {
		expect(assessStaleness({ path: 'a.md', ageDays: 5, trust: 'invalid' }).status).toBe('stale');
	});

	it('API que mudou depois da última edição pesa, mas não decide sozinha', () => {
		const verdict = assessStaleness({ path: 'a.md', ageDays: 60, productChangesSinceEdit: 3 });
		expect(verdict.status).toBe('potentially-stale');
		expect(verdict.reasons.join(' ')).toContain('mudou 3');
	});

	it('página nova e sem divergência é atual', () => {
		expect(assessStaleness({ path: 'a.md', ageDays: 3 }).status).toBe('fresh');
	});

	it('uso alto sem divergência conta a favor da página', () => {
		const verdict = assessStaleness({ path: 'a.md', ageDays: 200, usage: 50 });
		expect(verdict.status).toBe('fresh');
		expect(verdict.reasons.join(' ')).toContain('consultada com frequência');
	});

	it('sem histórico de Git o veredito é "sem informação", não "está bem"', () => {
		expect(assessStaleness({ path: 'a.md' }).status).toBe('unknown');
	});

	it('sem Git, mas com divergência, o veredito continua valendo', () => {
		expect(assessStaleness({ path: 'a.md', brokenContracts: 1 }).status).toBe('stale');
	});

	it('cada veredito declara os sinais que pesaram', () => {
		const verdict = assessStaleness({ path: 'a.md', ageDays: 400, brokenContracts: 1, trust: 'stale' });
		expect(verdict.reasons.length).toBeGreaterThanOrEqual(3);
	});

	it('classifica a idade em faixas', () => {
		expect(bucketFor(10)).toBe('<30d');
		expect(bucketFor(60)).toBe('30-90d');
		expect(bucketFor(120)).toBe('90-180d');
		expect(bucketFor(400)).toBe('>180d');
		expect(bucketFor(undefined)).toBe('unknown');
	});
});

describe('consolidação do frescor', () => {
	it('obsoleta não vale nada, possivelmente obsoleta vale metade', () => {
		const summary = summarizeFreshness([
			{ path: 'a.md', status: 'fresh', reasons: [] },
			{ path: 'b.md', status: 'potentially-stale', reasons: [] },
			{ path: 'c.md', status: 'stale', reasons: [] },
		]);
		expect(summary.score).toBe(50);
	});

	it('página sem informação fica fora da conta', () => {
		// A mesma regra do painel: ausência de medida não é nota zero.
		const summary = summarizeFreshness([
			{ path: 'a.md', status: 'fresh', reasons: [] },
			{ path: 'b.md', status: 'unknown', reasons: [] },
		]);
		expect(summary.score).toBe(100);
		expect(summary.unknown).toBe(1);
	});

	it('nada mensurável resulta em zero', () => {
		expect(summarizeFreshness([{ path: 'a.md', status: 'unknown', reasons: [] }]).score).toBe(0);
	});

	it('as piores vêm primeiro, obsoletas antes das possivelmente obsoletas', () => {
		const summary = summarizeFreshness([
			{ path: 'a.md', status: 'potentially-stale', reasons: [] },
			{ path: 'b.md', status: 'stale', reasons: [] },
		]);
		expect(summary.worst[0].path).toBe('b.md');
	});
});

// ---------------------------------------------------------------------------
// Error budget (§9)
// ---------------------------------------------------------------------------

describe('error budget', () => {
	it('orçamento zero sem ocorrência está inteiro', () => {
		// Link quebrado e contrato quebrado não têm cota, e tratar isso como divisão
		// por zero faria a barra sumir nos dois indicadores mais rígidos.
		expect(evaluateBudget({ name: 'Links', allowed: 0, used: 0 })).toMatchObject({ remaining: 100, exceeded: false });
	});

	it('orçamento zero com uma ocorrência estoura', () => {
		expect(evaluateBudget({ name: 'Links', allowed: 0, used: 1 })).toMatchObject({ remaining: 0, exceeded: true });
	});

	it('mostra quanto resta, não quanto se gastou', () => {
		expect(evaluateBudget({ name: 'Exemplos', allowed: 5, used: 2 }).remaining).toBe(60);
	});

	it('acima do limite estoura e não fica negativo', () => {
		const status = evaluateBudget({ name: 'Exemplos', allowed: 2, used: 5 });
		expect(status.exceeded).toBe(true);
		expect(status.remaining).toBe(0);
	});

	it('os estourados aparecem primeiro', () => {
		const ordered = evaluateBudgets([
			{ name: 'ok', allowed: 10, used: 1 },
			{ name: 'estourado', allowed: 0, used: 3 },
		]);
		expect(ordered[0].name).toBe('estourado');
	});
});

// ---------------------------------------------------------------------------
// Saúde por página (§17)
// ---------------------------------------------------------------------------

describe('saúde por página', () => {
	it('combina as dimensões medidas', () => {
		const health = computePageHealth({ path: 'a.md', quality: 9, failures: 0 });
		expect(health.score).toBe(95);
	});

	it('página sem proveniência não é página sem confiança', () => {
		// Puni-la faria a nota falar do esforço de anotação em vez da saúde do
		// conteúdo.
		const health = computePageHealth({ path: 'a.md', quality: 10, failures: 0 });
		expect(health.score).toBe(100);
		expect(health.unmeasured.map((entry) => entry.name)).toContain('Confiança');
	});

	it('toda dimensão não medida declara o motivo', () => {
		const health = computePageHealth({ path: 'a.md' });
		expect(health.score).toBeNull();
		expect(health.unmeasured.every((entry) => entry.reason.length > 10)).toBe(true);
	});

	it('defeito de comportamento derruba a confiabilidade rápido', () => {
		const health = computePageHealth({ path: 'a.md', failures: 2 });
		expect(health.dimensions.find((dimension) => dimension.name === 'Confiabilidade')?.value).toBe(32);
	});

	it('contrato quebrado aparece na nota da página', () => {
		const health = computePageHealth({ path: 'a.md', contracts: { valid: 1, invalid: 1 } });
		expect(health.dimensions.find((dimension) => dimension.name === 'Contratos')?.value).toBe(50);
	});

	it('página que não documenta endpoint explica por que não tem contrato', () => {
		const health = computePageHealth({ path: 'a.md', quality: 9 });
		const reason = health.unmeasured.find((entry) => entry.name === 'Contratos')?.reason;
		expect(reason).toContain('não documenta endpoint');
	});
});

// ---------------------------------------------------------------------------
// Histórico e regressão (§12, §13, §14)
// ---------------------------------------------------------------------------

describe('histórico', () => {
	const now = Date.parse('2026-08-18T12:00:00Z');
	const at = (daysAgo: number) => new Date(now - daysAgo * 86_400_000).toISOString();

	it('filtra por janela', () => {
		const snapshots = [snapshot({ at: at(3) }), snapshot({ at: at(45) })];
		expect(withinDays(snapshots, 30, now)).toHaveLength(1);
	});

	it('escolhe o snapshot mais próximo do alvo, não o primeiro da janela', () => {
		// Comparar hoje com uma medição de 29 dias e chamar de "30 dias" seria
		// impreciso de um jeito que ninguém notaria.
		const snapshots = [snapshot({ at: at(2), score: 80 }), snapshot({ at: at(29), score: 70 }), snapshot({ at: at(31), score: 60 })];
		expect(snapshotNearest(snapshots, 30, now)?.score).toBe(70);
	});

	it('sem snapshot, não há com o que comparar', () => {
		expect(snapshotNearest([], 30, now)).toBeUndefined();
	});
});

describe('regressão', () => {
	it('calcula a diferença e explica por dimensão', () => {
		const previous = snapshot({ score: 96, dimensions: { quality: 96, coverage: 92, freshness: 90 } });
		const current = snapshot({ score: 91, dimensions: { quality: 96, coverage: 90, freshness: 87 } });

		const regression = detectRegression(previous, current);
		expect(regression.delta).toBe(-5);
		expect(regression.byDimension.map((entry) => entry.dimension)).toEqual(['freshness', 'coverage']);
	});

	it('só as dimensões que pioraram entram na explicação', () => {
		// Listar as que melhoraram no meio da explicação de uma piora dilui
		// exatamente o que se quer ler.
		const previous = snapshot({ dimensions: { quality: 90, coverage: 90 } });
		const current = snapshot({ dimensions: { quality: 95, coverage: 80 } });
		expect(detectRegression(previous, current).byDimension).toEqual([{ dimension: 'coverage', delta: -10 }]);
	});

	it('defeitos novos são listados', () => {
		const previous = snapshot();
		const current = snapshot({ reliability: { brokenLinks: 2, failedTests: 0, brokenContracts: 1, invalidPages: 0 } });

		const regression = detectRegression(previous, current);
		expect(regression.newIssues).toContain('+2 link(s) quebrado(s)');
		expect(regression.newIssues).toContain('+1 contrato(s) quebrado(s)');
	});

	it('melhora não vira lista de defeitos', () => {
		const previous = snapshot({ reliability: { brokenLinks: 3, failedTests: 0, brokenContracts: 0, invalidPages: 0 } });
		const current = snapshot();
		expect(detectRegression(previous, current).newIssues).toEqual([]);
	});
});

describe('correlação com mudanças', () => {
	const commits = [
		{ commit: 'a1', subject: 'API de pagamentos v3', files: ['src/schemas/api.yaml', 'src/pages/api/pay.ts'] },
		{ commit: 'b2', subject: 'ajuste de estilo', files: ['src/styles/global.css'] },
	];

	it('lista candidatos que tocaram o que importa', () => {
		const candidates = correlateChanges(commits, ['src/content/docs/pagamentos.md']);
		expect(candidates).toHaveLength(1);
		expect(candidates[0].commit).toBe('a1');
	});

	it('commit sem arquivo relevante fica de fora', () => {
		expect(correlateChanges([commits[1]], [])).toEqual([]);
	});

	it('devolve candidatos, não causa', () => {
		// A documentação também degrada quando o produto muda e ninguém mexe nela —
		// e nesse caso o commit responsável não está na lista. O nome do tipo e o
		// texto da interface dizem isso; este teste fixa que a lista é parcial.
		const candidates = correlateChanges([], ['src/content/docs/a.md']);
		expect(candidates).toEqual([]);
	});
});
