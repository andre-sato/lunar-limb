/**
 * O Orchestrator (§9, §12, §22, §32, §35, §40, §41, §43).
 *
 * Ele decide quais agentes rodam, em que ordem, e — o que importa mais — **quando
 * parar e chamar uma pessoa**. Três condições interrompem a execução antes do fim,
 * e nenhuma delas é falha técnica:
 *
 *   conflito entre fontes (§16)   duas fontes discordam; escolher uma em silêncio
 *                                 propagaria o conflito para a documentação
 *   pesquisa incompleta (§15)     não há evidência para o que a tarefa pede
 *   regressão de saúde (§35)      a mudança melhora uma coisa e piora o conjunto
 *
 * E uma condição que **nunca** deixa de valer: nada é publicado sem aprovação
 * humana (§22), mesmo com todos os testes verdes. O que a autonomia mais alta
 * automatiza é a abertura do pull request depois da aprovação — não a decisão.
 */

import { randomUUID } from 'node:crypto';
import { recordAudit } from '../auth/audit';
import { canGenerate, loadChatConfig, providerApiKey } from '../chat/config';
import { anthropicModel } from '../chat/models';
import { collectHealth } from '../health/collect';
import { listSnapshots, snapshotNearest } from '../health/snapshots';
import { research } from './researcher';
import { write } from './writer';
import { audit, review, test } from './validators';
import { AgentWorkspace } from './workspace';
import { PolicyViolation, refuse } from './policy';
import { saveRun } from './store';
import {
	DEFAULT_ORCHESTRATOR_CONFIG,
	type AgentRun,
	type AgentStep,
	type DocumentationTask,
	type OrchestratorConfig,
	type RunStatus,
} from './types';

export interface RunOptions {
	config?: Partial<OrchestratorConfig>;
	actorId: string;
	/** Injetável para o teste não precisar de provedor nem de disco real. */
	now?: () => string;
}

function step(agent: AgentStep['agent'], label: string): AgentStep {
	return { agent, label, status: 'running', startedAt: new Date().toISOString() };
}

function finish(entry: AgentStep, status: AgentStep['status'], patch: Partial<AgentStep> = {}): AgentStep {
	return { ...entry, ...patch, status, finishedAt: new Date().toISOString() };
}

/**
 * Executa o fluxo da §12.
 *
 * A ordem é a da spec, e cada etapa só roda se a anterior autorizar. Rodar o
 * Writer com pesquisa conflitante seria gastar uma chamada de modelo para
 * produzir texto que será descartado — e, pior, texto convincente sobre um ponto
 * que ninguém sabe qual é.
 */
export async function runTask(task: DocumentationTask, options: RunOptions): Promise<AgentRun> {
	const config: OrchestratorConfig = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...options.config };
	const now = options.now ?? (() => new Date().toISOString());

	const run: AgentRun = {
		id: randomUUID(),
		task,
		status: 'running',
		autonomy: config.autonomy,
		steps: [],
		changes: [],
		confidence: {},
		retries: 0,
		createdBy: options.actorId,
		createdAt: now(),
		updatedAt: now(),
	};

	const workspace = new AgentWorkspace(run.id);

	const stop = async (status: RunStatus, reason: string): Promise<AgentRun> => {
		run.status = status;
		run.blockedReason = reason;
		run.updatedAt = now();
		await saveRun(run);
		await recordAudit({
			actorId: options.actorId,
			action: 'AGENT_RUN_BLOCKED',
			metadata: { runId: run.id, status, reason: reason.slice(0, 200) },
		});
		return run;
	};

	try {
		await workspace.prepare();

		// --- 1. Pesquisa -----------------------------------------------------
		let entry = step('researcher', 'Pesquisa');
		run.steps.push(entry);

		const researchResult = await research(task);
		run.research = researchResult;
		run.confidence.researcher = researchResult.confidence;
		run.steps[run.steps.length - 1] = finish(entry, 'completed', {
			confidence: researchResult.confidence,
			output: { facts: researchResult.facts.length, sources: researchResult.sources.length },
			tools: ['query_digital_twin', 'query_content_graph', 'query_glossary', 'search_docs', 'query_git'],
		});

		// --- 2. Conflito interrompe (§16) ------------------------------------
		if (researchResult.conflicts.length > 0) {
			run.steps.push(
				finish(step('orchestrator', 'Verificação de conflito'), 'blocked', {
					output: researchResult.conflicts,
				})
			);

			return stop(
				'blocked',
				`As fontes discordam sobre ${researchResult.conflicts.map((conflict) => conflict.subject).join(', ')}. ` +
					'Uma pessoa precisa decidir qual está certa antes de escrever.'
			);
		}

		// --- 3. Pesquisa incompleta interrompe (§15) -------------------------
		if (researchResult.facts.length === 0) {
			run.steps.push(finish(step('orchestrator', 'Verificação de evidência'), 'blocked'));

			return stop(
				'blocked',
				`Nenhuma evidência encontrada para a tarefa. Fontes consultadas: ${researchResult.sources.join(', ') || 'nenhuma'}. ` +
					'Preencher a lacuna com suposição é o que esta camada existe para evitar.'
			);
		}

		// --- 4. Nível 0 para aqui (§24) --------------------------------------
		if (config.autonomy === 0) {
			run.status = 'awaiting-approval';
			run.blockedReason = 'Autonomia nível 0: o agente sugere, não escreve.';
			run.updatedAt = now();
			await saveRun(run);
			return run;
		}

		// --- 5. Redação ------------------------------------------------------
		entry = step('writer', 'Rascunho');
		run.steps.push(entry);

		const chatConfig = await loadChatConfig().catch(() => null);
		const model =
			chatConfig && canGenerate(chatConfig)
				? anthropicModel({ apiKey: providerApiKey(), model: chatConfig.model, effort: 'medium' })
				: undefined;

		const writerResult = await write(task, researchResult, workspace, { model });
		run.confidence.writer = writerResult.confidence;
		run.changes = await workspace.changes();

		if (run.changes.length > config.maxFiles) {
			return stop('blocked', `A execução tentou alterar ${run.changes.length} arquivos; o teto é ${config.maxFiles}.`);
		}

		run.steps[run.steps.length - 1] = finish(entry, 'completed', {
			confidence: writerResult.confidence,
			output: {
				files: writerResult.written,
				reusable: writerResult.reusable.map((block) => block.id),
				placeholders: writerResult.placeholders.length,
				// Diz de onde veio o texto. Sem isso, um rascunho estruturado e uma
				// página redigida por modelo ficam indistinguíveis no log.
				generated: writerResult.generated,
			},
			tools: ['read_docs', 'query_content_graph', 'query_glossary', 'write_workspace'],
		});

		// --- 6. Nível 1 para aqui --------------------------------------------
		if (config.autonomy === 1) {
			run.status = 'awaiting-approval';
			run.updatedAt = now();
			await saveRun(run);
			return run;
		}

		// --- 7. Revisão, testes e auditoria ----------------------------------
		entry = step('reviewer', 'Revisão');
		run.steps.push(entry);
		const reviewResult = await review(run.changes, researchResult);
		run.confidence.reviewer = reviewResult.confidence;
		run.steps[run.steps.length - 1] = finish(entry, reviewResult.passed ? 'completed' : 'failed', {
			confidence: reviewResult.confidence,
			output: reviewResult,
			tools: ['run_linter', 'query_glossary'],
		});

		entry = step('tester', 'Testes');
		run.steps.push(entry);
		const testResult = await test(run.changes);
		run.confidence.tester = testResult.confidence;
		run.steps[run.steps.length - 1] = finish(entry, testResult.passed ? 'completed' : 'failed', {
			confidence: testResult.confidence,
			output: testResult,
			tools: ['run_docs_tests', 'run_contract_tests', 'run_impact_analysis'],
		});

		entry = step('auditor', 'Auditoria de confiança');
		run.steps.push(entry);
		const auditResult = await audit(run.changes, researchResult);
		run.confidence.auditor = auditResult.confidence;
		run.steps[run.steps.length - 1] = finish(entry, auditResult.passed ? 'completed' : 'failed', {
			confidence: auditResult.confidence,
			output: auditResult,
			tools: ['query_provenance', 'query_digital_twin'],
		});

		// --- 8. Saúde: bloqueia regressão (§35) ------------------------------
		if (config.blockOnHealthRegression) {
			entry = step('orchestrator', 'Avaliação de saúde');
			run.steps.push(entry);

			const [health, snapshots] = await Promise.all([collectHealth().catch(() => null), listSnapshots()]);
			const previous = snapshotNearest(snapshots, 0);

			if (health && previous && health.overall < previous.score) {
				run.steps[run.steps.length - 1] = finish(entry, 'blocked', {
					output: { before: previous.score, after: health.overall },
				});

				return stop(
					'blocked',
					`A saúde da documentação cairia de ${previous.score} para ${health.overall}. ` +
						'A mudança melhora uma coisa e piora o conjunto.'
				);
			}

			run.steps[run.steps.length - 1] = finish(entry, 'completed', {
				output: { before: previous?.score ?? null, after: health?.overall ?? null },
				tools: ['query_health'],
			});
		}

		// --- 9. Falhou a validação: uma volta, com teto (§32) ----------------
		if (!reviewResult.passed || !testResult.passed || !auditResult.passed) {
			run.status = 'awaiting-approval';
			run.blockedReason = [
				!reviewResult.passed ? 'a revisão apontou erros' : '',
				!testResult.passed ? 'há testes reprovados' : '',
				!auditResult.passed ? 'há afirmações sem lastro' : '',
			]
				.filter(Boolean)
				.join('; ');

			run.updatedAt = now();
			await saveRun(run);
			return run;
		}

		// --- 10. Pronto para aprovação (§22) ---------------------------------
		run.pullRequestBody = composePullRequestBody(run, { reviewResult, testResult, auditResult });
		run.status = 'awaiting-approval';
		run.updatedAt = now();

		await saveRun(run);
		await recordAudit({
			actorId: options.actorId,
			action: 'AGENT_RUN_COMPLETED',
			metadata: {
				runId: run.id,
				files: run.changes.length,
				tests: testResult.documentation.total,
				trust: auditResult.trust,
			},
		});

		return run;
	} catch (error) {
		if (error instanceof PolicyViolation) {
			// Violação de política não é falha técnica: é o guardrail funcionando, e
			// o log precisa distinguir as duas coisas.
			run.steps.push(
				finish(step('orchestrator', 'Guardrail'), 'blocked', {
					errors: [{ code: error.code, message: error.message, retryable: false }],
				})
			);
			return stop('blocked', error.message);
		}

		run.status = 'failed';
		run.blockedReason = error instanceof Error ? error.message : 'Falha inesperada.';
		run.updatedAt = now();
		await saveRun(run);
		return run;
	}
}

// ---------------------------------------------------------------------------
// Corpo do pull request (§41)
// ---------------------------------------------------------------------------

export function composePullRequestBody(
	run: AgentRun,
	results: {
		reviewResult: Awaited<ReturnType<typeof review>>;
		testResult: Awaited<ReturnType<typeof test>>;
		auditResult: Awaited<ReturnType<typeof audit>>;
	}
): string {
	const { reviewResult, testResult, auditResult } = results;

	const parts: string[] = [
		'## Resumo',
		'',
		run.task.instruction,
		'',
		'## Evidência',
		'',
		...(run.research?.sources ?? []).map((source) => `- \`${source}\``),
		'',
		'## Validação',
		'',
		`- Testes de documentação: ${testResult.documentation.passed} passaram, ${testResult.documentation.failed} falharam`,
		`- Contratos: ${testResult.contracts.valid} válidos, ${testResult.contracts.invalid} quebrados`,
		`- Revisão: precisão ${reviewResult.scores.technicalAccuracy}, clareza ${reviewResult.scores.clarity}, consistência ${reviewResult.scores.consistency}`,
		`- Confiança: ${auditResult.trust}/100`,
		'',
	];

	if (testResult.impactedPages.length > 0) {
		parts.push(
			'## Impacto',
			'',
			`${testResult.impactedPages.length} página(s) mudam por causa desta alteração:`,
			'',
			...testResult.impactedPages.map((page) => `- \`${page}\``),
			''
		);
	}

	if (run.research?.unknowns.length) {
		parts.push('## Pontos em aberto', '', ...run.research.unknowns.map((unknown) => `- ${unknown}`), '');
	}

	parts.push(
		'---',
		'_Preparado por agente de documentação. Toda afirmação acima tem fonte declarada; o que não tinha evidência ficou marcado no texto._'
	);

	return parts.join('\n');
}

/** Publicar sem aprovação é recusado por política, não por configuração (§22, §25). */
export function assertApprovalBeforePublish(run: AgentRun): void {
	if (run.status !== 'approved') throw refuse('publish');
}
