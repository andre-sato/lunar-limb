import type { APIRoute } from 'astro';
import { branchDiff } from '../../../../lib/git/diff';
import { detectDefaultBranch, currentBranch } from '../../../../lib/git/workflow';
import {
	changedPaths,
	composePullRequestBody,
	createPullRequest,
	getRemote,
	providerToken,
} from '../../../../lib/git/pull-request';
import { lintDocument } from '../../../../lib/linter/lint';
import { loadConfig } from '../../../../lib/linter/config';
import { getGlossaryIndex } from '../../../../lib/glossary/loader';
import { setGlossaryIndex } from '../../../../lib/linter/rules/glossary';
import { getContentFs } from '../../../../lib/editor/content-fs';
import { recordAudit } from '../../../../lib/auth/audit';
import { runDocumentationTests } from '../../../../lib/doctest/runner';
import { analyzeImpactOf } from '../../../../lib/impact/engine';
import { documentationImpact } from '../../../../lib/codeloop/service';
import { analyzeSdkImpact, sdkGovernance } from '../../../../lib/sdk/integration';
import { digitalTwin } from '../../../../lib/twin/service';
import { loadTwinConfig } from '../../../../lib/twin/load';
import { loadContractConfig, runContractTests } from '../../../../lib/contract/engine';
import { collectHealth } from '../../../../lib/health/collect';
import { listSnapshots, snapshotNearest } from '../../../../lib/health/snapshots';

export const prerender = false;

/**
 * Revisão da branch: diff, portão de qualidade e criação do pull request
 * (§3.3, §3.4, §3.6, §4).
 *
 * O `GET` responde "o que mudou e está pronto?"; o `POST` cria o pull request.
 * Separados porque a primeira pergunta é feita várias vezes enquanto se escreve,
 * e a segunda uma vez só, no fim.
 */

const DOCS_PREFIX = 'src/content/docs/';
const SNIPPETS_PREFIX = 'src/content/snippets/';

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

/**
 * Roda o linter nos arquivos de conteúdo alterados (§3.4).
 *
 * Só o conteúdo: um PR que mexe em `astro.config.mjs` não tem nota de
 * documentação, e inventar uma seria pior que não ter.
 */
async function runGate(paths: readonly string[]) {
	const content = paths.filter(
		(file) => (file.startsWith(DOCS_PREFIX) || file.startsWith(SNIPPETS_PREFIX)) && /\.mdx?$/.test(file)
	);

	if (content.length === 0) {
		return { score: null, passed: true, files: [], findings: 0 };
	}

	const config = await loadConfig('default');
	setGlossaryIndex(await getGlossaryIndex());

	const docs = getContentFs('docs');
	const snippets = getContentFs('snippets');

	const files: Array<{ path: string; score: number; passed: boolean; findings: number }> = [];

	for (const file of content) {
		const isDoc = file.startsWith(DOCS_PREFIX);
		const relative = file.slice((isDoc ? DOCS_PREFIX : SNIPPETS_PREFIX).length);

		try {
			const document = await (isDoc ? docs : snippets).readDocument(relative);
			const result = await lintDocument(document.content, { path: relative, config });
			files.push({
				path: file,
				score: result.score,
				// `warning` passa: o portão reprova só o que o linter reprova.
				passed: result.gate !== 'fail',
				findings: result.findings.length,
			});
		} catch {
			// Arquivo apagado nesta branch: não há o que analisar.
		}
	}

	if (files.length === 0) return { score: null, passed: true, files: [], findings: 0 };

	// A nota do conjunto é a **menor** das páginas, não a média: uma página ruim
	// no meio de dez boas continua sendo uma página ruim indo para revisão.
	const score = Math.min(...files.map((file) => file.score));

	return {
		score,
		passed: files.every((file) => file.passed),
		files,
		findings: files.reduce((total, file) => total + file.findings, 0),
	};
}

/**
 * Roda a Documentation Test Suite nos arquivos do PR (§12).
 *
 * Perfil `standard`: links, grafo, exemplos de API e estrutura dos snippets. O
 * `strict` fica fora porque depende de rede e de terceiros, e um PR não deve
 * reprovar porque um site alheio está fora do ar neste minuto.
 */
async function runTests(paths: readonly string[]) {
	const docs = paths.filter((file) => file.startsWith(DOCS_PREFIX) && /\.mdx?$/.test(file));
	if (docs.length === 0) return { total: 0, passed: 0, failed: 0, skipped: 0, passing: true, failures: [] };

	try {
		const report = await runDocumentationTests({ profile: 'standard', changed: docs });
		return {
			...report.summary,
			// Só as falhas vão para a interface: a lista completa de passados tem
			// centenas de linhas e nada a decidir.
			failures: report.results
				.filter((result) => result.status === 'fail')
				.map((result) => ({ id: result.id, name: result.name, message: result.message, location: result.location })),
		};
	} catch (error) {
		// A suíte não rodar não é o mesmo que aprovar. Informa e deixa claro.
		return {
			total: 0,
			passed: 0,
			failed: 0,
			skipped: 0,
			passing: false,
			error: error instanceof Error ? error.message : 'Falha ao rodar os testes.',
			failures: [],
		};
	}
}

/**
 * Cobertura documental do Digital Twin (§21 do Digital Twin).
 *
 * O limite olha a cobertura de **endpoints**, não a média das quatro fatias: a
 * média dilui justamente o número que este portão existe para proteger, e um
 * portal pode passar no agregado com metade dos endpoints sem página.
 */
async function coverageGate() {
	try {
		const [coverage, config] = await Promise.all([digitalTwin.getCoverage(), loadTwinConfig()]);
		const current = coverage.endpoints.percentage;

		return {
			endpoints: current,
			minimum: config.minimumCoverage,
			// Sem endpoint para medir não há o que reprovar. Tratar "nada a medir"
			// como violação bloquearia PRs de portais que ainda não têm API.
			passed: current === null || current >= config.minimumCoverage,
			undocumented: coverage.endpoints.total - coverage.endpoints.documented,
			overall: coverage.overall,
		};
	} catch (error) {
		return {
			endpoints: null,
			minimum: 0,
			passed: true,
			undocumented: 0,
			overall: null,
			error: error instanceof Error ? error.message : 'Falha ao medir a cobertura.',
		};
	}
}

/**
 * Contratos de documentação (§20, §21 do Contract Testing).
 *
 * Só `invalid` bloqueia. Um contrato `unknown` — endpoint que nenhuma página
 * documenta — é assunto de cobertura, não de contrato: reprovar por ele
 * bloquearia todo PR de um portal que ainda está começando a documentar.
 */
/**
 * O portão do SDK.
 *
 * Ele responde a pergunta que nenhum outro portão faz: **esta mudança quebra
 * quem já instalou o pacote?** Documentação errada custa uma leitura confusa;
 * SDK incompatível quebra o build de outra pessoa, em outro repositório, sem
 * aviso.
 *
 * O impacto vem do contrato, não da comparação dos arquivos gerados: trocar a
 * indentação do gerador mudaria todo arquivo e nenhum contrato.
 */
async function sdkGate(base: string) {
	try {
		const [impact, dimensions] = await Promise.all([analyzeSdkImpact(base), sdkGovernance(base)]);

		return {
			breaking: impact.breaking,
			additive: impact.additive,
			regenerate: impact.regenerate,
			unavailable: impact.unavailable,
			dimensions,
			// Só ruptura bloqueia. SDK fora de sincronia é aviso: quem abre o PR
			// pode não ter rodado o gerador ainda, e travar por isso ensinaria a
			// equipe a desligar o portão.
			blocked: impact.breaking > 0,
		};
	} catch (error) {
		// Mesma política dos outros portões: falhar em executar não é aprovar, mas
		// também não bloqueia.
		console.error('[sdk] portão não executou', error);
		return { breaking: 0, additive: 0, regenerate: [], unavailable: true, dimensions: [], blocked: false, error: true };
	}
}

/**
 * O portão do Documentation-to-Code Loop (P2.2).
 *
 * Ele responde uma pergunta que nenhum outro portão faz: as **entidades do
 * produto** que esta branch alterou têm página vinculada e atualizada? O
 * Contract Testing verifica se o exemplo bate com a especificação; este verifica
 * se alguém sequer documentou o que mudou.
 */
async function codeLoopGate(base: string) {
	try {
		const report = await documentationImpact.analyze(`${base}...HEAD`);

		return {
			coverage: report.impact.coverage,
			blocked: report.blocked,
			entities: report.impact.affectedEntities.length,
			missing: report.impact.missingDocumentation.map((entity) => entity.entityId),
			stalePages: report.impact.affectedPages.filter((page) => page.stale).map((page) => page.path),
			violations: report.violations,
		};
	} catch (error) {
		// Mesma política dos outros portões: falhar em executar não é aprovar, mas
		// também não bloqueia — um erro de execução travando todo merge é como se
		// desliga um portão para sempre.
		console.error('[codeloop] portão não executou', error);
		return { coverage: 0, blocked: false, entities: 0, missing: [], stalePages: [], violations: [], error: true };
	}
}

async function contractGate(paths: readonly string[]) {
	const docs = paths.filter((file) => file.startsWith(DOCS_PREFIX) && /\.mdx?$/.test(file));

	try {
		const [report, config] = await Promise.all([
			runContractTests(docs.length > 0 ? { changed: docs.map((file) => file.slice(DOCS_PREFIX.length)) } : {}),
			loadContractConfig(),
		]);

		const broken = report.contracts.filter((contract) => contract.status === 'invalid');

		return {
			score: report.score.value,
			counts: report.counts,
			blocked: config.failOnBreaking && broken.length > 0,
			broken: broken.map((contract) => ({
				id: contract.id,
				pages: contract.documentation.map((reference) => reference.path),
				problems: contract.assertions
					.filter((assertion) => assertion.status === 'invalid')
					.map((assertion) => ({ id: assertion.id, message: assertion.message, location: assertion.location })),
			})),
		};
	} catch (error) {
		// A verificação não rodar não é aprovação — mas também não bloqueia: um erro
		// de execução travando todo merge é como se desliga um portão para sempre.
		return {
			score: 0,
			counts: { valid: 0, invalid: 0, warning: 0, unknown: 0 },
			blocked: false,
			broken: [],
			error: error instanceof Error ? error.message : 'Falha ao testar os contratos.',
		};
	}
}

/**
 * Saúde antes e depois (§20 do Observability).
 *
 * O "antes" é o snapshot mais recente do histórico, e o "depois" é a medição de
 * agora. Sem snapshot não há comparação — e dizer isso é melhor que inventar uma
 * linha de base, porque um PR que mostra "-0" quando não havia base ensina a
 * equipe a ignorar o número.
 */
async function healthGate() {
	try {
		const [report, snapshots] = await Promise.all([collectHealth(), listSnapshots()]);
		const previous = snapshotNearest(snapshots, 0);

		return {
			score: report.overall,
			minimum: report.minimumHealthScore,
			previous: previous?.score ?? null,
			delta: previous ? report.overall - previous.score : null,
			regression: report.regression,
			newIssues: report.regression?.newIssues ?? [],
			passed: report.overall >= report.minimumHealthScore && report.sloStatus !== 'breached',
		};
	} catch (error) {
		// Não conseguir medir não é aprovar, mas também não bloqueia: o portão de
		// merge que trava por erro de execução é o portão que alguém desliga.
		return {
			score: null,
			minimum: 0,
			previous: null,
			delta: null,
			regression: null,
			newIssues: [],
			passed: true,
			error: error instanceof Error ? error.message : 'Falha ao medir a saúde.',
		};
	}
}

export const GET: APIRoute = async ({ url }) => {
	try {
		const base = url.searchParams.get('base') || (await detectDefaultBranch());
		const head = await currentBranch();

		const [diff, paths, remote] = await Promise.all([branchDiff(base), changedPaths(base), getRemote()]);
		const [gate, impact, tests, coverage, contracts, health, codeLoop, sdk] = await Promise.all([
			runGate(paths),
			analyzeImpactOf({ base }),
			runTests(paths),
			coverageGate(),
			contractGate(paths),
			healthGate(),
			codeLoopGate(base),
			sdkGate(base),
		]);

		return json({
			base,
			head,
			diff,
			gate,
			impact,
			tests,
			coverage,
			contracts,
			health,
			codeLoop,
			sdk,
			remote: remote ? { url: remote.url, owner: remote.owner, repo: remote.repo } : null,
			// A interface precisa saber se o botão cria o PR ou abre o provedor.
			canCreatePullRequest: Boolean(remote && providerToken()),
		});
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : 'Falha ao comparar.' }, 500);
	}
};

export const POST: APIRoute = async ({ request, locals }) => {
	try {
		const body = await request.json();
		const title = String(body?.title ?? '').trim();
		if (title === '') return json({ error: 'O título é obrigatório.' }, 400);

		const base = String(body?.base ?? '') || (await detectDefaultBranch());
		const head = String(body?.head ?? '') || (await currentBranch());

		if (base === head) {
			return json({ error: 'A branch de origem e a de destino são a mesma.' }, 400);
		}

		const paths = await changedPaths(base);
		if (paths.length === 0) {
			return json({ error: 'Não há alterações entre as duas branches.' }, 400);
		}

		const [gate, impact, tests, coverage, contracts, health, codeLoop, sdk] = await Promise.all([
			runGate(paths),
			analyzeImpactOf({ base }),
			runTests(paths),
			coverageGate(),
			contractGate(paths),
			healthGate(),
			codeLoopGate(base),
			sdkGate(base),
		]);

		const input = {
			title,
			description: String(body?.description ?? ''),
			base,
			head,
			score: gate.score ?? undefined,
			gatePassed: gate.passed,
			changedFiles: paths,
			impact,
			tests: { total: tests.total, passed: tests.passed, failed: tests.failed, skipped: tests.skipped },
			coverage: coverage.endpoints === null ? undefined : { endpoints: coverage.endpoints, minimum: coverage.minimum, passed: coverage.passed },
			contracts:
				contracts.counts.invalid + contracts.counts.warning === 0
					? undefined
					: { broken: contracts.counts.invalid, warning: contracts.counts.warning, pages: contracts.broken.flatMap((item) => item.pages) },
			health:
				health.score === null
					? undefined
					: { score: health.score, previous: health.previous, delta: health.delta, newIssues: health.newIssues },
			// Estes dois eram calculados, devolvidos na resposta e **não** chegavam
			// ao corpo do pull request: as seções existiam e nunca renderizavam.
			codeLoop:
				codeLoop.entities === 0
					? undefined
					: {
							coverage: codeLoop.coverage,
							blocked: codeLoop.blocked,
							entities: codeLoop.entities,
							missing: codeLoop.missing,
							stalePages: codeLoop.stalePages,
						},
			sdk:
				sdk.unavailable || sdk.breaking + sdk.additive === 0
					? undefined
					: { breaking: sdk.breaking, additive: sdk.additive, regenerate: sdk.regenerate },
		};

		const result = await createPullRequest(input);

		await recordAudit({
			actorId: locals.user?.id ?? 'anonymous',
			action: 'PULL_REQUEST_PREPARED',
			metadata: {
				base,
				head,
				created: result.created,
				files: paths.length,
				score: gate.score ?? null,
				testsFailed: tests.failed,
				impactScore: impact.score.value,
				impactHighest: impact.highest,
			},
		});

		return json({ ...result, gate, impact, tests, coverage, contracts, health, codeLoop, sdk, body: composePullRequestBody(input) });
	} catch (error) {
		return json({ error: error instanceof Error ? error.message : 'Falha ao criar o pull request.' }, 500);
	}
};
