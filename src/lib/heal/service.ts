/**
 * `SelfHealingService` (P3.6 — §28).
 *
 * O que costura as etapas. Ele **não escreve documentação** — quem redige é o
 * Agent Orchestrator, em workspace isolado, com os guardrails que já existem lá
 * (caminho permitido, teto de arquivos, checagem de remoção de conteúdo, revisão
 * e auditoria antes de qualquer aplicação).
 *
 * A lista da §24 do que o self-healing não pode fazer é cumprida por construção,
 * não por disciplina:
 *
 * - **Inventar fatos** — `diagnose` recusa sem fonte autoritativa.
 * - **Alterar código** — a política do Orchestrator só permite escrever em
 *   `src/content`.
 * - **Publicar sem validação** — `validated` exige toda validação aplicável.
 * - **Remover documentação sem evidência** — `checkContentRemoval`, no
 *   Orchestrator.
 * - **Merge automático de alto risco** — nada aqui faz merge, em nível nenhum.
 * - **Mascarar falha de validação** — validação que não roda vale `null`, e
 *   `null` nunca conta como aprovação.
 */

import { randomUUID } from 'node:crypto';
import { detectIssues } from './detect';
import { assessRisk, diagnose, type SourceClaim } from './diagnose';
import { validateCandidate } from './validate';
import { loadHealingPolicy } from './config';
import { appendRecord, listRecords, readRecord } from './store';
import { runTask } from '../agents/orchestrator';
import { timelineOf } from '../history/git';
import { collectGovernance } from '../governance/service';
import { documentationImpact } from '../codeloop/service';
import type {
	Diagnosis,
	HealingCandidate,
	HealingIssue,
	HealingRecord,
	HealingSummary,
	SelfHealingPolicy,
} from './types';

/**
 * O que as fontes afirmam sobre a entidade de um problema.
 *
 * Hoje as reivindicações vêm do que as camadas existentes já sabem: a
 * especificação (contrato de produção) e o código que a implementa. Nenhuma é
 * inventada — e quando não há nenhuma, `diagnose` recusa em vez de improvisar.
 */
async function claimsFor(issue: HealingIssue): Promise<SourceClaim[]> {
	if (!issue.entityId) return [];

	const claims: SourceClaim[] = [];
	const bindings = await documentationImpact.getBindings(issue.entityId).catch(() => []);

	for (const binding of bindings) {
		if (!binding.resolved) continue;
		claims.push({
			source: 'documentation',
			reference: binding.documentationId,
			claim: `documenta ${binding.entityId}`,
		});
	}

	// A especificação é o contrato de produção. Quando o problema veio do Contract
	// Testing, a divergência apontada já é a comparação dela com a documentação.
	if (issue.type === 'contract-mismatch' || issue.type === 'broken-example' || issue.type === 'stale') {
		claims.push({
			source: 'production-contract',
			reference: 'src/schemas/portal-api.yaml',
			claim: issue.evidence[0]?.fact ?? issue.summary,
			changedAt: await lastChangeOf('src/schemas/portal-api.yaml'),
		});
	}

	return claims;
}

async function lastChangeOf(file: string): Promise<string | undefined> {
	const timeline = await timelineOf(file, 1).catch(() => []);
	return timeline[0]?.date;
}

async function documentationChangedAt(pages: readonly string[]): Promise<string | undefined> {
	for (const page of pages) {
		const at = await lastChangeOf(`src/content/docs/${page}`);
		if (at) return at;
	}
	return undefined;
}

/**
 * A instrução que vai ao Writer: uma linha, depois o contexto.
 *
 * O Writer deriva **título e nome de arquivo** da primeira linha. A primeira
 * proposta real deste ciclo usou uma instrução de várias linhas, e ela vazou
 * inteira para o `title:` e o `description:` do frontmatter — que deixou de ser
 * YAML válido. O detalhe vai depois da linha em branco, onde ele é contexto e
 * não nome.
 */
function instructionFor(issue: HealingIssue, diagnosis: Diagnosis): string {
	const headline = issue.entityId ? `Documentar ${issue.entityId}` : issue.summary.replace(/[.:].*$/, '');

	return [
		headline,
		'',
		`Causa provável: ${diagnosis.rootCause}`,
		'Use apenas as evidências abaixo. Não complete lacunas com suposição — se faltar evidência, pare e diga o que falta.',
		...diagnosis.evidence.map((entry) => `- ${entry.fact} (${entry.source})`),
	].join('\n');
}

// ---------------------------------------------------------------------------
// Serviço
// ---------------------------------------------------------------------------

export interface SelfHealingService {
	detect(): Promise<HealingIssue[]>;
	diagnose(issueId: string): Promise<Diagnosis | null>;
	propose(issueId: string, actorId: string): Promise<HealingCandidate | null>;
	getHistory(issueId?: string): Promise<HealingRecord[]>;
	summary(): Promise<HealingSummary>;
	policy(): Promise<SelfHealingPolicy>;
}

export const selfHealing: SelfHealingService = {
	async detect() {
		const issues = await detectIssues();

		for (const issue of issues) {
			const existing = await readRecord(issue.id);
			if (existing) continue;

			await appendRecord({
				issueId: issue.id,
				issue,
				attempts: 0,
				status: 'detected',
				updatedAt: issue.detectedAt,
				timeline: [{ at: issue.detectedAt, event: 'detectado', detail: issue.summary }],
			});
		}

		return issues;
	},

	async diagnose(issueId) {
		const record = await readRecord(issueId);
		if (!record) return null;

		const policy = await loadHealingPolicy();
		const claims = await claimsFor(record.issue);

		const result = diagnose({
			issue: record.issue,
			claims,
			policy,
			documentationChangedAt: await documentationChangedAt(record.issue.affectedPages),
		});

		await appendRecord({
			...record,
			diagnosis: result,
			status: result.unhealable ? 'failed' : 'candidate',
			updatedAt: new Date().toISOString(),
			timeline: [
				...record.timeline,
				{
					at: new Date().toISOString(),
					event: result.unhealable ? 'não diagnosticável' : 'diagnosticado',
					detail: result.reason ?? result.rootCause,
				},
			],
		});

		return result;
	},

	/**
	 * Gera o candidato — isto é, manda o Agent Orchestrator redigir.
	 *
	 * Quatro portas antes de chegar lá, e cada uma existe por um motivo diferente:
	 * autonomia insuficiente, tentativas esgotadas, conflito de fontes e confiança
	 * abaixo do mínimo. A ordem importa: verificar autonomia por último gastaria
	 * uma chamada de modelo para descobrir que o nível não permitia usá-la.
	 */
	async propose(issueId, actorId) {
		const [record, policy] = await Promise.all([readRecord(issueId), loadHealingPolicy()]);
		if (!record) return null;

		const now = () => new Date().toISOString();
		const stop = async (event: string, detail: string) => {
			await appendRecord({
				...record,
				status: 'failed',
				updatedAt: now(),
				timeline: [...record.timeline, { at: now(), event, detail }],
			});
			return null;
		};

		if (policy.autonomy < 2) {
			return stop('bloqueado', `Nível de autonomia ${policy.autonomy} não permite redigir.`);
		}

		if (record.attempts >= policy.maxAttempts) {
			// O sistema não tenta indefinidamente. Esgotadas as tentativas, o problema
			// vira lacuna para intervenção humana — é melhor uma fila visível que um
			// laço invisível queimando chamadas de modelo.
			return stop(
				'tentativas esgotadas',
				policy.onFailure === 'create-gap'
					? `${record.attempts} tentativa(s) sem resolver. Registrado como lacuna para intervenção humana.`
					: `${record.attempts} tentativa(s) sem resolver.`
			);
		}

		const diagnosis = record.diagnosis ?? (await selfHealing.diagnose(issueId));

		if (!diagnosis || diagnosis.unhealable) {
			return stop('não corrigível', diagnosis?.reason ?? 'Sem diagnóstico.');
		}

		if (diagnosis.confidence < policy.minimumConfidence) {
			return stop(
				'confiança insuficiente',
				`Diagnóstico com ${Math.round(diagnosis.confidence * 100)}% de confiança, abaixo do mínimo de ${Math.round(policy.minimumConfidence * 100)}%.`
			);
		}

		const target = record.issue.affectedPages[0];

		const run = await runTask(
			{
				id: `heal:${record.issueId}`,
				type: target ? 'update' : 'create',
				target,
				instruction: instructionFor(record.issue, diagnosis),
				context: record.issue.entityId ? { productNodes: [record.issue.entityId] } : undefined,
				constraints: target ? { allowedPaths: [target] } : undefined,
			},
			{ actorId }
		);

		const changes = run.changes.map((change) => ({
			path: change.path,
			diff: change.diff,
			added: change.diff.split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++')).length,
			removed: change.diff.split('\n').filter((line) => line.startsWith('-') && !line.startsWith('---')).length,
		}));

		if (changes.length === 0) {
			return stop('sem proposta', run.blockedReason ?? 'O agente não produziu alteração alguma.');
		}

		const governance = await collectGovernance().catch(() => null);
		const touched = new Set(changes.map((change) => change.path));

		const risk = assessRisk({
			issue: record.issue,
			added: changes.reduce((sum, change) => sum + change.added, 0),
			removed: changes.reduce((sum, change) => sum + change.removed, 0),
			pages: changes.length,
			touchesPublicApi: (governance?.approvals ?? []).some(
				(approval) => touched.has(approval.path) && approval.triggers.includes('public-api')
			),
			securitySensitive: (governance?.approvals ?? []).some(
				(approval) => touched.has(approval.path) && approval.triggers.includes('security-sensitive')
			),
		});

		const validations = await validateCandidate(changes);

		const candidate: HealingCandidate = {
			id: randomUUID(),
			issueId: record.issueId,
			changes,
			evidence: diagnosis.evidence,
			confidence: diagnosis.confidence,
			risk: risk.risk,
			validations,
			// Validação que não rodou vale `null` e **não** conta como aprovação:
			// mascarar falha de validação é o último item da lista de coisas que o
			// self-healing não pode fazer.
			validated: validations.every((validation) => validation.passed === true),
			runId: run.id,
			createdAt: now(),
		};

		await appendRecord({
			...record,
			diagnosis,
			candidate,
			attempts: record.attempts + 1,
			status: 'in-progress',
			updatedAt: now(),
			timeline: [
				...record.timeline,
				{
					at: now(),
					event: 'proposta gerada',
					detail: `${changes.length} arquivo(s) · risco ${risk.risk} · ${risk.factors.join(' ')}`,
				},
				...(candidate.validated
					? []
					: [
							{
								at: now(),
								event: 'validação incompleta',
								detail: validations
									.filter((validation) => validation.passed !== true)
									.map((validation) => `${validation.name}: ${validation.detail}`)
									.join(' · '),
							},
						]),
			],
		});

		return candidate;
	},

	async getHistory(issueId) {
		const records = await listRecords();
		return issueId ? records.filter((record) => record.issueId === issueId) : records;
	},

	async summary() {
		const records = await listRecords();

		const byType: Record<string, number> = {};
		for (const record of records) byType[record.issue.type] = (byType[record.issue.type] ?? 0) + 1;

		const resolved = records.filter((record) => record.status === 'resolved').length;
		const failed = records.filter((record) => record.status === 'failed').length;
		const concluded = resolved + failed;

		return {
			detected: records.length,
			candidates: records.filter((record) => record.diagnosis && !record.diagnosis.unhealable).length,
			drafted: records.filter((record) => record.candidate).length,
			pullRequests: records.filter((record) => record.pullRequest).length,
			resolved,
			failed,
			// Sem nada concluído a taxa é `null`, não 0%: um ciclo que ainda não
			// terminou nenhuma correção não tem 0% de sucesso.
			successRate: concluded === 0 ? null : Math.round((resolved / concluded) * 100),
			byType,
		};
	},

	policy: loadHealingPolicy,
};
