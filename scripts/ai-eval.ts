/**
 * CLI de AI Evaluation (P3.3 — § CLI).
 *
 *   npm run ai:eval
 *   npm run ai:eval -- --dataset golden
 *   npm run ai:eval -- --label baseline
 *   npm run ai:eval -- --compare baseline candidate
 *   npm run ai:eval -- --regression
 *   npm run ai:eval -- history
 *
 * Códigos de saída: 0 ok · 1 reprovado ou regressão · 2 uso inválido · 3 erro.
 *
 * Sem `ANTHROPIC_API_KEY` a corrida mede **recuperação**, não resposta gerada —
 * e o relatório diz isso em cada caso e no resumo, em vez de deixar os dois
 * regimes parecerem a mesma coisa.
 */

import { loadDatasets } from '../src/lib/eval/datasets';
import { runEvaluation } from '../src/lib/eval/runner';
import { compareRuns } from '../src/lib/eval/regression';
import { latestRun, listRuns, saveRun } from '../src/lib/eval/store';
import { DATASET_LABEL, DEFAULT_EVAL_POLICY } from '../src/lib/eval/types';

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

function ratio(name: string, entry: number | null): string {
	return `  ${name.padEnd(22)} ${entry === null ? paint('  — não medido', 'dim') : `${String(Math.round(entry * 100)).padStart(3)}%`}`;
}

async function main(): Promise<number> {
	const argv = process.argv.slice(2);
	const json = argv.includes('--json');
	const command = argv.find((argument) => !argument.startsWith('--')) ?? 'run';

	if (command === 'history') {
		const runs = await listRuns();
		if (json) {
			console.log(JSON.stringify(runs.map((run) => ({ ...run, results: undefined })), null, 2));
			return 0;
		}

		console.log('');
		console.log(paint(`${runs.length} corrida(s) guardada(s)`, 'bold'));
		console.log('');

		for (const run of runs.slice(-20)) {
			const score = run.summary.averageScore === null ? '—' : run.summary.averageScore.toFixed(1);
			console.log(
				`  ${paint(run.at.slice(0, 19).replace('T', ' '), 'dim')}  ${run.label.padEnd(12)} nota ${score}  ${run.summary.passed}/${run.summary.total}${run.summary.retrievalOnly ? paint('  (só recuperação)', 'dim') : ''}`
			);
		}

		console.log('');
		return 0;
	}

	// --- comparação ---------------------------------------------------------
	const compareIndex = argv.indexOf('--compare');
	if (compareIndex >= 0 || argv.includes('--regression')) {
		const baselineLabel = compareIndex >= 0 ? argv[compareIndex + 1] : 'baseline';
		const candidateLabel = compareIndex >= 0 ? argv[compareIndex + 2] : undefined;

		const [baseline, candidate] = await Promise.all([latestRun(baselineLabel), latestRun(candidateLabel)]);

		if (!baseline || !candidate) {
			console.error('Não há duas corridas para comparar. Rode `npm run ai:eval -- --label baseline` primeiro.');
			return 2;
		}

		const report = compareRuns(baseline, candidate, DEFAULT_EVAL_POLICY);

		if (json) {
			console.log(JSON.stringify(report, null, 2));
			return report.regressed ? 1 : 0;
		}

		console.log('');
		console.log(`${paint('Comparação', 'bold')}  ${report.baseline} → ${report.candidate}`);
		console.log('');

		if (report.incomparable) {
			console.log(paint(`  ${report.reason}`, 'yellow'));
			console.log('');
			return 0;
		}

		for (const entry of report.deltas) {
			if (entry.delta === null) {
				console.log(`  ${entry.name.padEnd(22)} ${paint('sem comparação', 'dim')}`);
				continue;
			}
			const arrow = entry.delta > 0 ? '↑' : entry.delta < 0 ? '↓' : '=';
			const color = entry.regressed ? 'red' : entry.delta > 0 ? 'green' : 'dim';
			console.log(
				`  ${entry.name.padEnd(22)} ${Math.round((entry.before ?? 0) * 100)}% → ${Math.round((entry.after ?? 0) * 100)}%  ${paint(`${arrow} ${Math.round(entry.delta * 100)}pp`, color)}`
			);
		}

		if (report.brokeCases.length > 0) {
			console.log('');
			console.log(paint(`  ${report.brokeCases.length} caso(s) que passavam e pararam:`, 'red'));
			for (const caseId of report.brokeCases) console.log(paint(`    ${caseId}`, 'dim'));
		}

		if (report.fixedCases.length > 0) {
			console.log('');
			console.log(paint(`  ${report.fixedCases.length} caso(s) corrigido(s):`, 'green'));
			for (const caseId of report.fixedCases) console.log(paint(`    ${caseId}`, 'dim'));
		}

		console.log('');
		console.log(report.regressed ? paint('  ❌ Regressão detectada', 'red') : paint('  ✓ Sem regressão', 'green'));
		console.log('');

		return report.regressed ? 1 : 0;
	}

	// --- corrida ------------------------------------------------------------
	const dataset = value(argv, '--dataset');
	const cases = await loadDatasets(dataset);

	if (cases.length === 0) {
		console.error(dataset ? `Nenhum caso no conjunto "${dataset}".` : 'Nenhum conjunto de avaliação em `evals/`.');
		return 2;
	}

	const run = await runEvaluation(cases, { label: value(argv, '--label') ?? 'local' });
	if (!argv.includes('--no-save')) await saveRun(run);

	if (json) {
		console.log(JSON.stringify(run, null, 2));
		return run.summary.failed > 0 ? 1 : 0;
	}

	const { summary } = run;

	console.log('');
	console.log(
		`${paint('AI Evaluation', 'bold')}  ${paint(`${run.label} · ${run.model ?? 'sem modelo'}`, 'dim')}`
	);
	console.log('');

	for (const result of run.results) {
		const mark =
			result.passed === null ? paint('·', 'dim') : result.passed ? paint('✓', 'green') : paint('✗', 'red');
		const score = result.score === null ? ' — ' : result.score.toFixed(1).padStart(4);

		console.log(`  ${mark} ${score}  ${result.caseId}  ${paint(DATASET_LABEL[result.kind], 'dim')}`);

		if (result.passed === false || result.passed === null) {
			for (const entry of Object.values(result.metrics)) {
				if (entry.value === null || entry.value === 1) continue;
				console.log(paint(`        ${entry.detail}`, 'dim'));
			}
			for (const note of result.notes) console.log(paint(`        ${note}`, 'dim'));
		}
	}

	console.log('');
	console.log(ratio('Termos presentes', summary.termCoverage));
	console.log(ratio('Citações válidas', summary.citationValidity));
	console.log(ratio('Páginas esperadas', summary.sourceRecall));
	console.log(ratio('Segurança', summary.safety));
	console.log('');
	console.log(
		`  Nota média             ${summary.averageScore === null ? paint('— não medido', 'dim') : summary.averageScore.toFixed(1)}`
	);
	console.log(`  Aprovados              ${summary.passed}/${summary.total - summary.unmeasured}`);
	if (summary.unmeasured > 0) console.log(`  Não medidos            ${summary.unmeasured}`);
	console.log(
		`  Latência mediana       ${summary.medianLatencyMs === null ? '—' : `${summary.medianLatencyMs}ms`}`
	);

	if (summary.limitations.length > 0) {
		console.log('');
		console.log(paint('  O que esta corrida não sustenta:', 'bold'));
		for (const note of summary.limitations) console.log(paint(`    · ${note}`, 'dim'));
	}

	console.log('');
	console.log(
		paint(
			'  "Termos presentes" é presença de palavra, não verdade: uma resposta pode conter todos os termos e estar errada.',
			'dim'
		)
	);
	console.log('');

	return summary.failed > 0 ? 1 : 0;
}

main()
	.then((code) => {
		process.exitCode = code;
	})
	.catch((error) => {
		console.error('Falha ao executar a avaliação:', error);
		process.exitCode = 3;
	});
