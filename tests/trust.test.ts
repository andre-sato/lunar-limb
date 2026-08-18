/**
 * Testes de Trust & Provenance.
 *
 * O que mais precisa de teste aqui não é o caminho feliz — é a fronteira do que
 * o selo afirma. `verified` quer dizer "a evidência confere"; ler como "a frase
 * está certa" transforma o selo em conforto falso, e vários testes abaixo existem
 * para fixar essa distinção no comportamento, não só no comentário.
 */

import { describe, it, expect } from 'vitest';
import { inferSourceType, parsePageOwner, parseProvenance, stripSourcePrefix } from '../src/lib/trust/parse';
import { daysSince, resolveJsonPointer, splitCodeReference, verifyClaim, verifyClaims } from '../src/lib/trust/verify';
import { pageTrust, scoreTrust, summarizeTrust, trustDimension } from '../src/lib/trust/score';
import { worstStatus, type Claim } from '../src/lib/trust/types';
import { rankByTrust, trustNotice, trustWeight } from '../src/lib/chat/trust';

const NOW = Date.parse('2026-08-18T00:00:00Z');

function page(body: string, frontmatter = 'title: X'): string {
	return `---\n${frontmatter}\n---\n\n${body}\n`;
}

// ---------------------------------------------------------------------------
// Sintaxe (§5)
// ---------------------------------------------------------------------------

describe('inferência do tipo de fonte', () => {
	it('reconhece cada forma', () => {
		expect(inferSourceType('portal-api.yaml#/paths/~1users/get')).toBe('openapi');
		expect(inferSourceType('asyncapi.yaml#/channels')).toBe('asyncapi');
		expect(inferSourceType('DOC-LINK-001')).toBe('test');
		expect(inferSourceType('src/lib/auth/session.ts:42')).toBe('code');
		expect(inferSourceType('gerado de portal-api.yaml')).toBe('generated');
		expect(inferSourceType('confirmado pelo time de Plataforma')).toBe('manual');
	});

	it('prefixo explícito vence a dedução', () => {
		expect(inferSourceType('manual:DOC-LINK-001')).toBe('manual');
		expect(stripSourcePrefix('manual:DOC-LINK-001')).toBe('DOC-LINK-001');
	});
});

describe('anotação de proveniência', () => {
	it('lê o bloco do frontmatter', () => {
		const claims = parseProvenance(
			'a.md',
			page('Texto.', 'title: X\nprovenance:\n  - source: portal-api.yaml#/paths\n    verifiedAt: 2026-08-01')
		);
		expect(claims).toHaveLength(1);
		expect(claims[0].provenance[0]).toMatchObject({ sourceType: 'openapi', verifiedAt: '2026-08-01' });
	});

	it('lê o bloco mesmo quando ele é o último do frontmatter', () => {
		// O defeito que a verificação contra o portal real encontrou: JavaScript não
		// tem `\Z`, e o lookahead até o fim do texto falhava calado — justamente na
		// posição em que o bloco costuma estar.
		const claims = parseProvenance('a.md', page('Texto.', 'title: X\nowner: Time\nprovenance:\n  - source: DOC-LINK-001'));
		expect(claims).toHaveLength(1);
	});

	it('lê anotação inline e associa o parágrafo seguinte', () => {
		const claims = parseProvenance(
			'a.md',
			page('<!-- provenance:\nsource: src/lib/auth/session.ts:42\n-->\n\nA sessão expira em 30 dias.')
		);
		expect(claims[0].text).toContain('A sessão expira');
	});

	it('duas fontes na mesma anotação viram duas evidências', () => {
		const claims = parseProvenance(
			'a.md',
			page('<!-- provenance:\nsource: DOC-LINK-001\nsource: src/lib/doctest/checks.ts\n-->\n\nTexto.')
		);
		expect(claims[0].provenance).toHaveLength(2);
	});

	it('responsável sozinho não vira afirmação', () => {
		// Dizer quem responde pela página é contato, não evidência. Tratá-lo como
		// afirmação sem data fazia toda página com `owner:` aparecer como não
		// verificada — inclusive as que tinham evidência boa.
		const raw = page('Texto.', 'title: X\nowner: Time de Plataforma');
		expect(parseProvenance('a.md', raw)).toEqual([]);
		expect(parsePageOwner(raw)).toBe('Time de Plataforma');
	});

	it('o responsável da página desce para as evidências que não declaram um', () => {
		const claims = parseProvenance(
			'a.md',
			page('Texto.', 'title: X\nowner: Time de Plataforma\nprovenance:\n  - source: DOC-LINK-001')
		);
		expect(claims[0].provenance[0].owner).toBe('Time de Plataforma');
	});

	it('página sem anotação nenhuma não produz afirmação', () => {
		expect(parseProvenance('a.md', page('Só texto.'))).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// JSON Pointer (§4)
// ---------------------------------------------------------------------------

describe('resolução de ponteiro', () => {
	const document = { paths: { '/users': { get: { summary: 'lista' } } }, components: { schemas: { User: {} } } };

	it('desfaz o escape do JSON Pointer', () => {
		// `~1` é `/`. Sem desfazer isso, todo ponteiro de caminho de API seria
		// declarado inexistente.
		expect(resolveJsonPointer(document, '#/paths/~1users/get')).toEqual({ summary: 'lista' });
	});

	it('devolve undefined para o que não existe', () => {
		expect(resolveJsonPointer(document, '#/paths/~1accounts/get')).toBeUndefined();
	});

	it('ponteiro vazio é o documento inteiro', () => {
		expect(resolveJsonPointer(document, '#/')).toBe(document);
	});
});

// ---------------------------------------------------------------------------
// Verificação (§6, §7, §8)
// ---------------------------------------------------------------------------

describe('verificação de evidência', () => {
	const claim = (source: string, verifiedAt?: string, extra: Partial<Claim['provenance'][0]> = {}): Claim => ({
		path: 'a.md',
		line: 1,
		provenance: [{ sourceType: inferSourceType(source), source, verifiedAt, ...extra }],
	});

	const options = {
		freshnessDays: 180,
		now: NOW,
		openapiPointer: (source: string) => source.includes('/paths'),
		codeLocation: (file: string, line?: number) => ({ exists: file.startsWith('src/'), hasLine: (line ?? 1) <= 100 }),
		testId: (id: string) => id === 'DOC-LINK-001',
	};

	it('ponteiro que existe e data recente: verificado', () => {
		const result = verifyClaim(claim('api.yaml#/paths', '2026-08-01'), options);
		expect(result.status).toBe('verified');
	});

	it('ponteiro que não existe: inválido, mesmo com data de ontem', () => {
		// A data recente não conserta a evidência: ela só documenta que a
		// conferência de ontem não olhou o que devia.
		const result = verifyClaim(claim('api.yaml#/components/nada', '2026-08-17'), options);
		expect(result.status).toBe('invalid');
		expect(result.evidence[0].detail).toContain('não existe');
	});

	it('data vencida: verificação vencida, não inválida', () => {
		const result = verifyClaim(claim('api.yaml#/paths', '2025-01-01'), options);
		expect(result.status).toBe('stale');
		expect(result.evidence[0].detail).toContain('prazo');
	});

	it('prazo próprio da evidência sobrepõe o padrão', () => {
		const result = verifyClaim(claim('api.yaml#/paths', '2026-06-01', { freshnessDays: 30 }), options);
		expect(result.status).toBe('stale');
	});

	it('evidência que confere mas nunca foi confirmada não é verificada', () => {
		// Ninguém assinou embaixo. `verified` sem data seria um selo emitido pelo
		// próprio texto que ele deveria auditar.
		expect(verifyClaim(claim('api.yaml#/paths'), options).status).toBe('unverified');
	});

	it('arquivo de código inexistente é evidência inválida', () => {
		expect(verifyClaim(claim('fora/do/projeto.ts', '2026-08-01'), options).status).toBe('invalid');
	});

	it('linha que não existe mais é evidência inválida', () => {
		const result = verifyClaim(claim('src/lib/auth/session.ts:900', '2026-08-01'), options);
		expect(result.status).toBe('invalid');
		expect(result.evidence[0].detail).toContain('900');
	});

	it('id de teste inventado é evidência inválida', () => {
		// Referência a teste inexistente é pior que nenhuma: tem a aparência de rigor.
		expect(verifyClaim(claim('AUTH-999', '2026-08-01'), options).status).toBe('invalid');
	});

	it('sem resolvedor, a evidência fica não verificada em vez de aprovada', () => {
		const result = verifyClaim(claim('api.yaml#/paths', '2026-08-01'), { freshnessDays: 180, now: NOW });
		expect(result.status).toBe('unverified');
	});

	it('verificação manual sem data não vale', () => {
		expect(verifyClaim(claim('confirmado pelo time'), options).status).toBe('unverified');
	});

	it('verificação manual com data recente vale, e diz quem confirmou', () => {
		const result = verifyClaim(claim('confirmado pelo time', '2026-08-01', { verifiedBy: 'Plataforma' }), options);
		expect(result.status).toBe('verified');
		expect(result.evidence[0].detail).toContain('Plataforma');
	});

	it('a pior evidência decide o estado da afirmação', () => {
		const mixed: Claim = {
			path: 'a.md',
			line: 1,
			provenance: [
				{ sourceType: 'openapi', source: 'api.yaml#/paths', verifiedAt: '2026-08-01' },
				{ sourceType: 'test', source: 'AUTH-999', verifiedAt: '2026-08-01' },
			],
		};
		expect(verifyClaim(mixed, options).status).toBe('invalid');
	});

	it('conta os dias desde a verificação', () => {
		expect(daysSince('2026-08-08T00:00:00Z', NOW)).toBe(10);
		expect(daysSince('não é data', NOW)).toBeUndefined();
	});

	it('separa arquivo e linha', () => {
		expect(splitCodeReference('src/a.ts:42')).toEqual({ file: 'src/a.ts', line: 42 });
		expect(splitCodeReference('src/a.ts')).toEqual({ file: 'src/a.ts' });
	});

	it('pior estado de uma lista', () => {
		expect(worstStatus(['verified', 'stale'])).toBe('stale');
		expect(worstStatus(['verified', 'invalid', 'stale'])).toBe('invalid');
		expect(worstStatus([])).toBe('unverified');
	});
});

// ---------------------------------------------------------------------------
// Trust Score (§9, §10)
// ---------------------------------------------------------------------------

describe('trust score', () => {
	const options = { freshnessDays: 180, now: NOW, openapiPointer: () => true, testId: () => true };

	const claimsFor = (provenance: Claim['provenance']) => verifyClaims([{ path: 'a.md', line: 1, provenance }], options);

	it('página sem afirmação recebe zero — e isso é a verdade, não descuido', () => {
		// Dar nota cheia à ausência de evidência premiaria exatamente o que a camada
		// existe para corrigir.
		expect(scoreTrust([], 180).value).toBe(0);
	});

	it('evidência verificada, recente, com teste e responsável chega perto de 100', () => {
		const claims = claimsFor([
			{ sourceType: 'test', source: 'DOC-LINK-001', verifiedAt: '2026-08-18', verifiedBy: 'Docs' },
		]);
		expect(scoreTrust(claims, 180).value).toBeGreaterThanOrEqual(95);
	});

	it('o frescor degrada aos poucos, sem penhasco no último dia', () => {
		const recent = scoreTrust(claimsFor([{ sourceType: 'openapi', source: 'a.yaml#/x', verifiedAt: '2026-08-01' }]), 180);
		const older = scoreTrust(claimsFor([{ sourceType: 'openapi', source: 'a.yaml#/x', verifiedAt: '2026-04-01' }]), 180);

		expect(recent.freshness).toBeGreaterThan(older.freshness);
		expect(older.freshness).toBeGreaterThan(0);
	});

	it('verificação vencida ainda conta como fonte válida', () => {
		// O que venceu foi a conferência, não a fonte — e o frescor é o componente
		// que mede isso. Contar duas vezes puniria o mesmo problema em dobro.
		const claims = claimsFor([{ sourceType: 'openapi', source: 'a.yaml#/x', verifiedAt: '2024-01-01' }]);
		const score = scoreTrust(claims, 180);
		expect(score.sourceValidity).toBe(100);
		expect(score.freshness).toBe(0);
	});

	it('evidência inválida derruba a validade da fonte', () => {
		const claims = verifyClaims([{ path: 'a.md', line: 1, provenance: [{ sourceType: 'test', source: 'X-1', verifiedAt: '2026-08-01' }] }], {
			...options,
			testId: () => false,
		});
		expect(scoreTrust(claims, 180).sourceValidity).toBe(0);
	});

	it('converte para a escala do Quality Score sem reponderar nada', () => {
		expect(trustDimension({ value: 94, sourceValidity: 0, testCoverage: 0, freshness: 0, ownership: 0 })).toBe(9.4);
	});
});

describe('resumo do workspace', () => {
	const options = { freshnessDays: 180, now: NOW, openapiPointer: () => true, testId: (id: string) => id !== 'X-1' };

	const build = (path: string, provenance: Claim['provenance']) =>
		pageTrust(path, verifyClaims([{ path, line: 1, provenance }], options), 180);

	it('conta por estado e ignora páginas sem proveniência na média', () => {
		const pages = [
			build('a.md', [{ sourceType: 'openapi', source: 'a.yaml#/x', verifiedAt: '2026-08-01' }]),
			build('b.md', [{ sourceType: 'openapi', source: 'a.yaml#/x', verifiedAt: '2024-01-01' }]),
			pageTrust('c.md', [], 180),
		];

		const summary = summarizeTrust(pages);
		expect(summary).toMatchObject({ pages: 3, documented: 2, verified: 1, stale: 1 });
		expect(summary.averageScore).toBeGreaterThan(0);
	});

	it('a fila de revisão começa pelas inválidas', () => {
		const pages = [
			build('boa.md', [{ sourceType: 'openapi', source: 'a.yaml#/x', verifiedAt: '2026-08-01' }]),
			build('ruim.md', [{ sourceType: 'test', source: 'X-1', verifiedAt: '2026-08-01' }]),
		];
		expect(summarizeTrust(pages).worst[0].path).toBe('ruim.md');
	});
});

// ---------------------------------------------------------------------------
// Assistente (§11)
// ---------------------------------------------------------------------------

describe('confiança na recuperação', () => {
	const chunk = (path: string, score: number) => ({ documentId: path, path, score });

	const lookup = (map: Record<string, 'verified' | 'stale' | 'unverified' | 'invalid'>) => (path: string) =>
		map[path] ? { status: map[path] } : undefined;

	it('página não anotada não é penalizada', () => {
		// A maior parte do portal ainda não tem proveniência; penalizá-la seria uma
		// reordenação silenciosa e arbitrária.
		expect(trustWeight(undefined)).toBe(1);
	});

	it('entre trechos de relevância parecida, o verificado sobe', () => {
		const ranked = rankByTrust(
			[chunk('velha.md', 0.82), chunk('nova.md', 0.8)],
			lookup({ 'velha.md': 'stale', 'nova.md': 'verified' })
		);
		expect(ranked[0].path).toBe('nova.md');
	});

	it('a confiança não atropela a relevância', () => {
		// Um trecho verificado que não responde à pergunta continua não respondendo.
		const ranked = rankByTrust(
			[chunk('responde.md', 0.95), chunk('nao-responde.md', 0.4)],
			lookup({ 'responde.md': 'stale', 'nao-responde.md': 'verified' })
		);
		expect(ranked[0].path).toBe('responde.md');
	});

	it('empate mantém a ordem da busca', () => {
		const ranked = rankByTrust([chunk('a.md', 0.8), chunk('b.md', 0.8)], lookup({}));
		expect(ranked.map((item) => item.path)).toEqual(['a.md', 'b.md']);
	});

	it('conteúdo vencido não é escondido — a resposta sai com aviso', () => {
		const notice = trustNotice(['velha.md'], lookup({ 'velha.md': 'stale' }));
		expect(notice.status).toBe('stale');
		expect(notice.message).toContain('não foi verificada recentemente');
	});

	it('evidência inválida rende aviso mais forte', () => {
		const notice = trustNotice(['x.md'], lookup({ 'x.md': 'invalid' }));
		expect(notice.status).toBe('invalid');
		expect(notice.message).toContain('não confere');
	});

	it('havendo uma fonte verificada, "não verificado" não gera aviso', () => {
		// A resposta tem lastro; o aviso viraria alarme sem consequência.
		expect(trustNotice(['a.md', 'b.md'], lookup({ 'a.md': 'verified', 'b.md': 'unverified' })).message).toBeUndefined();
	});

	it('sem informação de confiança, não há aviso', () => {
		expect(trustNotice(['a.md'], lookup({}))).toEqual({});
		expect(trustNotice(['a.md'], undefined)).toEqual({});
	});
});
