/**
 * Detecção de problemas (P3.6 — §3, §4).
 *
 * Nada é detectado aqui do zero. Cada sinal vem de uma camada que já existe e já
 * foi verificada contra o repositório:
 *
 * | Problema | Fonte do sinal |
 * | --- | --- |
 * | Defasada | Documentation-to-Code Loop |
 * | Divergência de contrato | Contract Testing |
 * | Exemplo quebrado | Contract Testing |
 * | Ausente | Documentation-to-Code Loop |
 * | Terminologia | Glossário |
 * | Lacuna comportamental | Observabilidade de leitura |
 *
 * Inventar detecção própria criaria uma sétima opinião sobre a mesma
 * documentação — e a experiência das camadas anteriores é que duas opiniões
 * sobre a mesma coisa divergem na primeira semana.
 */

import { documentationImpact } from '../codeloop/service';
import { runContractTests } from '../contract/engine';
import { observability } from '../observe/service';
import type { Evidence, HealingIssue, IssueType, Severity } from './types';

function issueId(type: IssueType, subject: string): string {
	return `${type}:${subject}`
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9:/.{}-]+/g, '-')
		.replace(/-+/g, '-')
		.slice(0, 120);
}

function evidence(fact: string, source: string, confidence: number, quote?: string): Evidence {
	return quote === undefined ? { fact, source, confidence } : { fact, source, confidence, quote };
}

export interface DetectOptions {
	/** Faixa de commits para o impacto documental. */
	range?: string;
	now?: () => string;
}

/**
 * Todos os problemas que as camadas existentes conseguem apontar.
 *
 * A severidade sai do que o problema significa para quem lê, não do quanto ele é
 * fácil de corrigir: um exemplo quebrado engana alguém que copia e cola, e por
 * isso é `high` mesmo quando a correção é de uma linha.
 */
export async function detectIssues(options: DetectOptions = {}): Promise<HealingIssue[]> {
	const now = options.now ?? (() => new Date().toISOString());
	const detectedAt = now();
	const issues: HealingIssue[] = [];

	// --- Documentation-to-Code Loop ----------------------------------------
	const impact = await documentationImpact.analyze(options.range ?? 'HEAD').catch(() => null);

	if (impact) {
		for (const entity of impact.impact.missingDocumentation) {
			issues.push({
				id: issueId('missing-documentation', entity.entityId),
				type: 'missing-documentation',
				severity: 'high',
				// O vínculo declarado é verificado contra o Digital Twin: a ausência
				// não é inferida de texto, ela é a ausência de uma declaração.
				confidence: 0.95,
				evidence: [evidence(`\`${entity.entityId}\` não tem página vinculada.`, entity.detail, 0.95)],
				affectedPages: [],
				entityId: entity.entityId,
				status: 'detected',
				detectedAt,
				summary: `${entity.entityId} mudou e nenhuma página declara documentá-lo.`,
			});
		}

		for (const page of impact.impact.affectedPages.filter((entry) => entry.stale)) {
			issues.push({
				id: issueId('stale', page.path),
				type: 'stale',
				severity: 'medium',
				confidence: 0.8,
				evidence: [
					evidence(
						`${page.entities.join(', ')} mudou e \`${page.path}\` não foi atualizada no mesmo conjunto.`,
						'Documentation-to-Code Loop',
						0.8
					),
				],
				affectedPages: [page.path],
				entityId: page.entities[0],
				status: 'detected',
				detectedAt,
				summary: `${page.path} pode estar defasada.`,
			});
		}
	}

	// Documentação ausente é um **estado**, não um evento (§4.4). A primeira
	// versão só olhava o impacto da mudança, e por isso não via nada num
	// repositório sem commits recentes — enquanto quatro endpoints públicos
	// seguiam sem página vinculada. Um detector que só enxerga o que acabou de
	// mudar nunca alcança a dívida que já estava lá.
	const seen = new Set(issues.map((issue) => issue.entityId));

	for (const entity of await documentationImpact.findUndocumented().catch(() => [])) {
		if (seen.has(entity.entityId)) continue;

		issues.push({
			id: issueId('missing-documentation', entity.entityId),
			type: 'missing-documentation',
			// Obrigatório pela política é `high`; o resto é dívida conhecida, e
			// marcar tudo como alto faria a lista perder a ordem.
			severity: entity.required ? 'high' : 'medium',
			confidence: 0.95,
			evidence: entity.evidence.map((detail) => evidence(detail, 'Documentation-to-Code Loop', 0.95)),
			affectedPages: [],
			entityId: entity.entityId,
			status: 'detected',
			detectedAt,
			summary: `${entity.entityId} é público e nenhuma página declara documentá-lo.`,
		});
	}

	// --- Contract Testing ---------------------------------------------------
	const contracts = await runContractTests().catch(() => null);

	for (const contract of contracts?.contracts ?? []) {
		if (contract.status !== 'invalid') continue;

		const failures = contract.assertions.filter((assertion) => assertion.status === 'invalid');
		const pages = contract.documentation.map((reference) => reference.path);

		// Exemplo quebrado e divergência de contrato são problemas diferentes e
		// exigem correções diferentes: um exemplo errado se conserta reescrevendo o
		// exemplo; uma divergência de contrato pode significar que a documentação
		// está certa e o contrato mudou sem aviso.
		const brokenExample = failures.some((assertion) => /exemplo|example|curl|http/i.test(assertion.id));

		issues.push({
			id: issueId(brokenExample ? 'broken-example' : 'contract-mismatch', contract.id),
			type: brokenExample ? 'broken-example' : 'contract-mismatch',
			// Exemplo quebrado engana quem copia e cola. Isso é pior que uma página
			// desatualizada, mesmo quando a correção é de uma linha.
			severity: 'high',
			confidence: 0.9,
			evidence: failures
				.slice(0, 5)
				.map((assertion) => evidence(assertion.message, locationOf(assertion.location) ?? contract.id, 0.9)),
			affectedPages: pages,
			entityId: contract.id,
			status: 'detected',
			detectedAt,
			summary: `${contract.id}: ${failures.length} verificação(ões) de contrato falhando.`,
		});
	}

	// --- Observabilidade de leitura ----------------------------------------
	for (const gap of await observability.gaps().catch(() => [])) {
		// Só o sinal de busca sem resultado vira problema de healing. Saída em massa
		// e voto negativo dizem que o conteúdo existe e não serviu — a correção ali
		// é editorial, e um agente redigindo por cima de conteúdo que alguém
		// escreveu, sem saber por que ele não serviu, piora a página.
		if (gap.signal !== 'zero-result' || gap.topic.includes('não guardado')) continue;

		issues.push({
			id: issueId('behavioral-gap', gap.topic),
			type: 'behavioral-gap',
			severity: 'low',
			// Comportamento é evidência de atrito, não prova de conteúdo faltando —
			// a confiança vem de lá e não é reescalada aqui.
			confidence: gap.confidence,
			evidence: gap.evidence.map((entry) => evidence(entry, 'Observabilidade de leitura', gap.confidence)),
			affectedPages: [],
			status: 'detected',
			detectedAt,
			summary: `"${gap.topic}": ${gap.occurrences} busca(s) sem resultado.`,
		});
	}

	return issues.sort((a, b) => rank(b.severity) - rank(a.severity) || b.confidence - a.confidence);
}

/** A localização de uma asserção pode ser texto ou `{ path, line }`. */
function locationOf(location: string | { path: string; line?: number } | undefined): string | undefined {
	if (location === undefined) return undefined;
	if (typeof location === 'string') return location;
	return location.line === undefined ? location.path : `${location.path}:${location.line}`;
}

function rank(severity: Severity): number {
	return { low: 0, medium: 1, high: 2, critical: 3 }[severity];
}
