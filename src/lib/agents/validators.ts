/**
 * Reviewer, Tester e Auditor (§6, §7, §8, §20, §37, §38, §39).
 *
 * Os três compartilham um princípio: **nenhum deles reimplementa verificação**.
 * O Reviewer usa o linter, o Tester usa a Documentation Test Suite e o Contract
 * Testing, o Auditor usa a camada de Trust. Uma segunda régua com critérios
 * ligeiramente diferentes é como um portal passa a ter duas opiniões sobre a
 * mesma página.
 *
 * O que eles acrescentam é **julgamento sobre a proposta**: se o texto responde à
 * tarefa, se o que ele afirma tem lastro nas evidências, e se a mudança piora
 * alguma coisa.
 */

import { lintDocument } from '../linter/lint';
import { loadConfig } from '../linter/config';
import { getGlossaryIndex } from '../glossary/loader';
import { setGlossaryIndex } from '../linter/rules/glossary';
import { runDocumentationTests } from '../doctest/runner';
import { runContractTests } from '../contract/engine';
import { analyzeImpactOf } from '../impact/engine';
import { parseProvenance } from '../trust/parse';
import { assertTool } from './policy';
import type { Evidence, FileChange, ResearchResult } from './types';

// ---------------------------------------------------------------------------
// Reviewer (§6, §20)
// ---------------------------------------------------------------------------

export interface ReviewResult {
	/** Notas de 0 a 10, na escala do Quality Score. */
	scores: {
		technicalAccuracy: number;
		completeness: number;
		clarity: number;
		consistency: number;
		structure: number;
	};
	findings: Array<{ severity: 'error' | 'warning' | 'info'; message: string; path?: string }>;
	passed: boolean;
	confidence: number;
}

/**
 * Precisão técnica: quanto do texto tem lastro nas evidências.
 *
 * A medida é grosseira de propósito — comparar frases com fatos exigiria um
 * modelo, e um modelo julgando o texto de outro modelo erra de formas
 * correlacionadas. O que se mede aqui é concreto: marcações de lacuna deixadas
 * pelo Writer, e afirmações numéricas que não aparecem em nenhuma evidência.
 */
export function technicalAccuracy(content: string, facts: readonly Evidence[]): { score: number; unsupported: string[] } {
	const unsupported: string[] = [];

	const placeholders = (content.match(/ESCREVER:/g) ?? []).length;

	const evidenceText = facts
		.map((fact) => `${fact.fact} ${fact.quote ?? ''}`)
		.join(' ')
		.toLowerCase();

	// Número específico numa página técnica é uma afirmação sobre o produto.
	for (const match of content.matchAll(/\b(\d{2,})\s*(dias|horas|minutos|segundos|tentativas|vezes)\b/gi)) {
		if (!evidenceText.includes(match[1])) {
			unsupported.push(`"${match[0]}" não aparece em nenhuma evidência`);
		}
	}

	const penalty = Math.min(6, placeholders * 1.5 + unsupported.length * 2);
	return { score: Math.max(0, Math.round((10 - penalty) * 10) / 10), unsupported };
}

export async function review(changes: readonly FileChange[], research: ResearchResult): Promise<ReviewResult> {
	assertTool('reviewer', 'run_linter');
	assertTool('reviewer', 'query_glossary');

	const config = await loadConfig('default');
	setGlossaryIndex(await getGlossaryIndex());

	const findings: ReviewResult['findings'] = [];
	let clarity = 10;
	let consistency = 10;
	let structure = 10;
	let accuracy = 10;
	let completeness = 10;

	for (const change of changes) {
		const relative = change.path.replace(/^src\/content\/docs\//, '');
		const result = await lintDocument(change.after, { path: relative, config });

		clarity = Math.min(clarity, result.categories.clarity);
		consistency = Math.min(consistency, result.categories.consistency);
		structure = Math.min(structure, result.categories.structure);
		completeness = Math.min(completeness, result.categories.completeness);

		for (const finding of result.findings.slice(0, 20)) {
			findings.push({
				severity: finding.severity === 'error' ? 'error' : finding.severity === 'warning' ? 'warning' : 'info',
				message: `${finding.ruleId}: ${finding.message}`,
				path: change.path,
			});
		}

		const technical = technicalAccuracy(change.after, research.facts);
		accuracy = Math.min(accuracy, technical.score);

		for (const claim of technical.unsupported) {
			findings.push({ severity: 'error', message: `Afirmação sem lastro: ${claim}`, path: change.path });
		}

		if (change.after.includes('ESCREVER:')) {
			findings.push({
				severity: 'warning',
				message: 'O rascunho tem trechos marcados para escrita humana.',
				path: change.path,
			});
		}
	}

	const scores = {
		technicalAccuracy: accuracy,
		completeness,
		clarity,
		consistency,
		structure,
	};

	return {
		scores,
		findings,
		// Erro reprova a revisão; aviso não. Um rascunho com lacuna marcada é um
		// rascunho honesto, e reprovar por isso impediria justamente o fluxo em que
		// a pessoa completa o que falta.
		passed: !findings.some((finding) => finding.severity === 'error'),
		confidence: Math.min(...Object.values(scores)) / 10,
	};
}

// ---------------------------------------------------------------------------
// Tester (§7, §37, §39)
// ---------------------------------------------------------------------------

export interface TestResultSummary {
	documentation: { total: number; passed: number; failed: number; failures: string[] };
	contracts: { valid: number; invalid: number; warning: number; failures: string[] };
	/** Páginas que mudam por tabela, do Impact Engine. */
	impactedPages: string[];
	passed: boolean;
	confidence: number;
}

/**
 * Roda o que é relevante para o que mudou (§39).
 *
 * A suíte inteira a cada ciclo custa tempo e não acrescenta informação: o que
 * interessa é o efeito da alteração. O escopo sai do Impact Engine, que já sabe
 * quais páginas mudam por tabela.
 */
export async function test(changes: readonly FileChange[]): Promise<TestResultSummary> {
	assertTool('tester', 'run_docs_tests');
	assertTool('tester', 'run_impact_analysis');

	const paths = changes.map((change) => change.path.replace(/^src\/content\/docs\//, ''));

	const impacted = new Set<string>();
	for (const change of changes) {
		const impact = await analyzeImpactOf({ file: change.path }).catch(() => null);
		for (const item of impact?.items ?? []) impacted.add(item.node.path);
	}

	const documentation = await runDocumentationTests({ profile: 'standard', changed: paths }).catch(() => null);

	// Contratos só quando a mudança toca API — mas quando toca, é obrigatório
	// (§37). Rodar sempre custaria tempo em toda alteração de guia conceitual.
	const touchesApi = changes.some(
		(change) => /api|endpoint|contrato/i.test(change.after) || change.path.includes('api-reference')
	);

	const contracts = touchesApi ? await runContractTests({ changed: paths }).catch(() => null) : null;

	const documentationFailures = (documentation?.results ?? [])
		.filter((result) => result.status === 'fail')
		.map((result) => `${result.id} ${result.name}${result.message ? `: ${result.message}` : ''}`);

	const contractFailures = (contracts?.contracts ?? [])
		.filter((contract) => contract.status === 'invalid')
		.flatMap((contract) =>
			contract.assertions
				.filter((assertion) => assertion.status === 'invalid')
				.map((assertion) => `${contract.id} — ${assertion.id}: ${assertion.message}`)
		);

	const passed = documentationFailures.length === 0 && contractFailures.length === 0;

	return {
		documentation: {
			total: documentation?.summary.total ?? 0,
			passed: documentation?.summary.passed ?? 0,
			failed: documentation?.summary.failed ?? 0,
			failures: documentationFailures,
		},
		contracts: {
			valid: contracts?.counts.valid ?? 0,
			invalid: contracts?.counts.invalid ?? 0,
			warning: contracts?.counts.warning ?? 0,
			failures: contractFailures,
		},
		impactedPages: [...impacted].sort(),
		passed,
		// Sem teste algum executado, a confiança é baixa — não alta. "Nada falhou"
		// e "nada foi verificado" são estados diferentes.
		confidence: documentation && documentation.summary.total > 0 ? (passed ? 1 : 0.3) : 0.4,
	};
}

// ---------------------------------------------------------------------------
// Auditor (§8)
// ---------------------------------------------------------------------------

export interface AuditResult {
	sources: number;
	unsupportedClaims: string[];
	staleSources: string[];
	/** 0–100, na escala do Trust Score. */
	trust: number;
	passed: boolean;
	confidence: number;
}

/**
 * Auditoria de proveniência sobre a proposta.
 *
 * Ela responde a uma pergunta específica: o texto que o agente propôs **declara**
 * de onde veio? Uma página gerada sem nenhuma anotação de proveniência é uma
 * página que ninguém conseguirá reverificar em seis meses — que é exatamente o
 * problema que a camada de Trust existe para resolver.
 */
export async function audit(changes: readonly FileChange[], research: ResearchResult): Promise<AuditResult> {
	assertTool('auditor', 'query_provenance');

	const unsupported: string[] = [];
	const stale: string[] = [];
	let declared = 0;

	for (const change of changes) {
		const relative = change.path.replace(/^src\/content\/docs\//, '');
		const claims = parseProvenance(relative, change.after);
		declared += claims.reduce((sum, claim) => sum + claim.provenance.length, 0);

		if (claims.length === 0) {
			unsupported.push(`\`${change.path}\` não declara proveniência para nenhuma afirmação.`);
		}

		const technical = technicalAccuracy(change.after, research.facts);
		unsupported.push(...technical.unsupported.map((claim) => `\`${change.path}\`: ${claim}`));
	}

	for (const fact of research.facts) {
		if (fact.confidence < 0.6) stale.push(`${fact.source} (confiança ${fact.confidence})`);
	}

	// A nota combina a densidade de proveniência declarada com a ausência de
	// afirmação sem lastro. Uma proposta com fonte para tudo e nenhuma invenção
	// chega a 100; cada afirmação solta derruba bastante, porque é o defeito que a
	// camada existe para pegar.
	const trust = Math.max(0, Math.min(100, Math.round(60 + declared * 10 - unsupported.length * 25)));

	return {
		sources: research.sources.length,
		unsupportedClaims: unsupported,
		staleSources: stale,
		trust,
		passed: unsupported.length === 0,
		confidence: trust / 100,
	};
}
