/**
 * CLI do Agent Orchestrator (§42).
 *
 *   npm run agent -- run --task "Atualize a documentação de autenticação"
 *   npm run agent -- run --task "..." --target api-reference/authentication.md
 *   npm run agent -- list
 *   npm run agent -- review <run-id>     mostra o diff e a validação
 *   npm run agent -- logs <run-id>       o registro completo da execução
 *   npm run agent -- approve <run-id>
 *   npm run agent -- reject <run-id>
 *
 * Códigos de saída: 0 executou · 1 bloqueado ou reprovado · 2 uso inválido ·
 * 3 erro de execução.
 *
 * `approve` **não publica**. Ele marca a execução como aprovada; levar o conteúdo
 * do workspace ao repositório é passo separado, e é assim de propósito.
 */

import { randomUUID } from 'node:crypto';
import { runTask } from '../src/lib/agents/orchestrator';
import { approveRun, getRun, listRuns, rejectRun } from '../src/lib/agents/store';
import { AGENT_LABEL, RUN_STATUS_LABEL, type AutonomyLevel, type DocumentationTask } from '../src/lib/agents/types';

const EXIT_OK = 0;
const EXIT_BLOCKED = 1;
const EXIT_BAD_USAGE = 2;
const EXIT_RUNTIME_ERROR = 3;

const COLORS = {
	reset: '[0m',
	dim: '[2m',
	red: '[31m',
	yellow: '[33m',
	green: '[32m',
	bold: '[1m',
};

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
function paint(text: string, color: keyof typeof COLORS): string {
	return useColor ? `${COLORS[color]}${text}${COLORS.reset}` : text;
}

function value(argv: string[], flag: string): string | undefined {
	const index = argv.indexOf(flag);
	return index >= 0 ? argv[index + 1] : undefined;
}

function stepMark(status: string): string {
	if (status === 'completed') return paint('●', 'green');
	if (status === 'failed') return paint('●', 'red');
	if (status === 'blocked') return paint('●', 'yellow');
	return paint('○', 'dim');
}

async function main(): Promise<number> {
	const argv = process.argv.slice(2);
	const command = argv[0] ?? 'list';
	const json = argv.includes('--json');
	const actor = process.env.USER ?? process.env.USERNAME ?? 'cli';

	if (command === 'run') {
		const instruction = value(argv, '--task');
		if (!instruction) {
			console.error('Informe a tarefa: npm run agent -- run --task "..."');
			return EXIT_BAD_USAGE;
		}

		const autonomy = Number.parseInt(value(argv, '--autonomy') ?? '2', 10);
		if (![0, 1, 2, 3].includes(autonomy)) {
			console.error('Autonomia deve ser 0, 1, 2 ou 3.');
			return EXIT_BAD_USAGE;
		}

		const task: DocumentationTask = {
			id: randomUUID(),
			type: (value(argv, '--type') as DocumentationTask['type']) ?? 'update',
			target: value(argv, '--target'),
			instruction,
		};

		const run = await runTask(task, { actorId: actor, config: { autonomy: autonomy as AutonomyLevel } });

		if (json) {
			console.log(JSON.stringify(run, null, 2));
			return run.status === 'blocked' || run.status === 'failed' ? EXIT_BLOCKED : EXIT_OK;
		}

		console.log('');
		console.log(`${paint('Execução', 'bold')} ${run.id}`);
		console.log(paint(`  ${task.instruction}`, 'dim'));
		console.log('');

		for (const entry of run.steps) {
			const label = entry.agent === 'orchestrator' ? entry.label : `${AGENT_LABEL[entry.agent]} — ${entry.label}`;
			const confidence = entry.confidence !== undefined ? paint(` ${Math.round(entry.confidence * 100)}%`, 'dim') : '';
			console.log(`  ${stepMark(entry.status)} ${label.padEnd(34)} ${entry.status}${confidence}`);
		}

		console.log('');

		if (run.research) {
			console.log(
				paint(
					`  ${run.research.facts.length} fato(s) · ${run.research.sources.length} fonte(s) · ${run.research.unknowns.length} lacuna(s) · ${run.research.conflicts.length} conflito(s)`,
					'dim'
				)
			);
		}

		if (run.blockedReason) {
			console.log('');
			console.log(`  ${paint('Parado:', 'yellow')} ${run.blockedReason}`);
		}

		if (run.changes.length > 0) {
			console.log('');
			console.log(paint(`  ${run.changes.length} arquivo(s) no workspace:`, 'bold'));
			for (const change of run.changes) console.log(`    ${change.kind === 'create' ? '+' : '~'} ${change.path}`);
			console.log('');
			console.log(paint(`  Veja o diff:  npm run agent -- review ${run.id}`, 'dim'));
		}

		console.log('');
		console.log(`  ${RUN_STATUS_LABEL[run.status]}`);
		console.log('');

		return run.status === 'blocked' || run.status === 'failed' ? EXIT_BLOCKED : EXIT_OK;
	}

	if (command === 'list') {
		const runs = await listRuns();

		if (json) {
			console.log(JSON.stringify(runs, null, 2));
			return EXIT_OK;
		}

		console.log('');
		if (runs.length === 0) console.log(paint('  Nenhuma execução ainda.', 'dim'));

		for (const run of runs.slice(0, 20)) {
			console.log(`  ${run.id.slice(0, 8)}  ${RUN_STATUS_LABEL[run.status].padEnd(22)} ${run.task.instruction.slice(0, 60)}`);
		}
		console.log('');
		return EXIT_OK;
	}

	const id = argv[1];
	if (!id || id.startsWith('--')) {
		console.error(`Informe o id: npm run agent -- ${command} <run-id>`);
		return EXIT_BAD_USAGE;
	}

	const run = (await listRuns()).find((candidate) => candidate.id === id || candidate.id.startsWith(id));
	if (!run) {
		console.error(`Execução não encontrada: ${id}`);
		return EXIT_BAD_USAGE;
	}

	if (command === 'review') {
		if (json) {
			console.log(JSON.stringify({ changes: run.changes, steps: run.steps }, null, 2));
			return EXIT_OK;
		}

		console.log('');
		console.log(`${paint(run.task.instruction, 'bold')}  ${paint(RUN_STATUS_LABEL[run.status], 'dim')}`);
		console.log('');

		for (const change of run.changes) {
			console.log(paint(`${change.kind === 'create' ? 'novo' : 'alterado'}: ${change.path}`, 'bold'));
			for (const line of change.diff.split('\n')) {
				if (line.startsWith('+')) console.log(paint(line, 'green'));
				else if (line.startsWith('-')) console.log(paint(line, 'red'));
				else console.log(paint(line, 'dim'));
			}
			console.log('');
		}

		if (run.pullRequestBody) {
			console.log(paint('Corpo do pull request', 'bold'));
			console.log(paint(run.pullRequestBody, 'dim'));
			console.log('');
		}

		console.log(paint(`Aprovar:  npm run agent -- approve ${run.id}`, 'dim'));
		console.log(paint(`Rejeitar: npm run agent -- reject ${run.id}`, 'dim'));
		console.log('');
		return EXIT_OK;
	}

	if (command === 'logs') {
		if (json) {
			console.log(JSON.stringify(run, null, 2));
			return EXIT_OK;
		}

		console.log('');
		console.log(`${paint('Execução', 'bold')} ${run.id}`);
		console.log(paint(`  criada por ${run.createdBy} em ${run.createdAt}`, 'dim'));
		console.log('');

		for (const entry of run.steps) {
			const label = entry.agent === 'orchestrator' ? entry.label : `${AGENT_LABEL[entry.agent]} — ${entry.label}`;
			console.log(`  ${stepMark(entry.status)} ${label}`);
			if (entry.tools?.length) console.log(paint(`      ferramentas: ${entry.tools.join(', ')}`, 'dim'));
			if (entry.confidence !== undefined) console.log(paint(`      confiança: ${Math.round(entry.confidence * 100)}%`, 'dim'));
			if (entry.errors?.length) {
				for (const error of entry.errors) console.log(paint(`      ${error.code}: ${error.message}`, 'red'));
			}
		}

		if (run.research) {
			console.log('');
			console.log(paint('  Fontes consultadas', 'bold'));
			for (const source of run.research.sources) console.log(paint(`    ${source}`, 'dim'));

			if (run.research.unknowns.length > 0) {
				console.log('');
				console.log(paint('  Lacunas', 'bold'));
				for (const unknown of run.research.unknowns) console.log(paint(`    ${unknown}`, 'yellow'));
			}
		}

		console.log('');
		return EXIT_OK;
	}

	if (command === 'approve') {
		await approveRun(run.id, actor);
		console.log(paint(`Execução ${run.id.slice(0, 8)} aprovada.`, 'green'));
		console.log(paint('Aprovar não publica: o conteúdo continua no workspace até alguém aplicá-lo.', 'dim'));
		return EXIT_OK;
	}

	if (command === 'reject') {
		await rejectRun(run.id, actor, value(argv, '--reason'));
		console.log(`Execução ${run.id.slice(0, 8)} rejeitada; o workspace foi descartado.`);
		return EXIT_OK;
	}

	console.error(`Subcomando desconhecido: ${command}`);
	console.error('Use: run, list, review <id>, logs <id>, approve <id>, reject <id>.');
	return EXIT_BAD_USAGE;
}

main()
	.then((code) => {
		process.exitCode = code;
	})
	.catch((error) => {
		console.error('Falha ao executar o agente:', error);
		process.exitCode = EXIT_RUNTIME_ERROR;
	});
