/**
 * Documentation Observability na linha de comando (§19, §22).
 *
 *   npm run docs:health                    o painel
 *   npm run docs:health -- check           para CI: falha quando o SLO não passa
 *   npm run docs:health -- slo             só a tabela de SLO e os orçamentos
 *   npm run docs:health -- regressions     o que piorou desde a última medição
 *   npm run docs:health -- --history 30    a série dos últimos N dias
 *   npm run docs:health -- --snapshot      grava a medição no histórico
 *
 * Códigos de saída: 0 tudo dentro do alvo · 1 SLO violado · 3 erro de execução.
 *
 * `at-risk` **não** falha. Risco é convite a olhar; reprovar o pipeline por causa
 * dele faria a equipe afrouxar os alvos até o painel ficar sempre verde — que é o
 * oposto do que um SLO serve para fazer.
 */

import { collectHealth } from '../src/lib/health/collect';
import { buildBacklog } from '../src/lib/health/gaps';
import { listSnapshots, withinDays } from '../src/lib/health/snapshots';
import { STALENESS_MARK } from '../src/lib/health/staleness';
import { DIMENSION_LABEL, SLO_LABEL, SLO_MARK } from '../src/lib/health/types';

const EXIT_OK = 0;
const EXIT_BREACHED = 1;
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

function bar(value: number, measured: boolean, width = 22): string {
	if (!measured) return paint('—'.repeat(width), 'dim');
	const filled = Math.round((value / 100) * width);
	const color = value >= 90 ? 'green' : value >= 75 ? 'yellow' : 'red';
	return paint('█'.repeat(filled), color) + paint('░'.repeat(width - filled), 'dim');
}

function sparkline(values: readonly number[]): string {
	if (values.length === 0) return '';
	const marks = '▁▂▃▄▅▆▇█';
	const min = Math.min(...values);
	const max = Math.max(...values);
	const span = max - min || 1;
	return values.map((value) => marks[Math.min(marks.length - 1, Math.floor(((value - min) / span) * (marks.length - 1)))]).join('');
}

async function main(): Promise<number> {
	const argv = process.argv.slice(2);
	const json = argv.includes('--json');
	const quiet = argv.includes('--quiet');

	const historyIndex = argv.indexOf('--history');
	const historyDays = historyIndex >= 0 ? Number.parseInt(argv[historyIndex + 1] ?? '30', 10) : undefined;

	// O valor de `--history` é um número solto na linha de comando, e sem excluí-lo
	// aqui ele virava o subcomando: `-- --history 30` executava "30" e caía no
	// painel completo em vez da série histórica.
	//
	// A comparação precisa do `>= 0`: sem a opção, `historyIndex` é `-1`, e
	// `-1 + 1` é o índice **zero** — que é justamente onde o subcomando está.
	const valueIndex = historyIndex >= 0 ? historyIndex + 1 : -1;
	const command = argv.find((argument, index) => !argument.startsWith('--') && index !== valueIndex) ?? 'overview';

	// --- histórico, que não precisa recalcular nada -------------------------
	if (historyDays !== undefined && command === 'overview') {
		const snapshots = withinDays(await listSnapshots(), historyDays);

		if (json) {
			console.log(JSON.stringify(snapshots, null, 2));
			return EXIT_OK;
		}

		console.log('');
		console.log(paint(`Documentation Health — últimos ${historyDays} dias`, 'bold'));
		console.log('');

		if (snapshots.length === 0) {
			console.log(paint('  Nenhum snapshot no período. Grave um com `--snapshot`.', 'dim'));
			console.log('');
			return EXIT_OK;
		}

		console.log(`  ${sparkline(snapshots.map((snapshot) => snapshot.score))}`);
		console.log('');
		for (const snapshot of snapshots.slice(-12)) {
			console.log(`  ${snapshot.at.slice(0, 10)}  ${String(snapshot.score).padStart(3)}  ${paint(snapshot.commit?.slice(0, 8) ?? '', 'dim')}`);
		}
		console.log('');
		return EXIT_OK;
	}

	const report = await collectHealth({ snapshot: argv.includes('--snapshot') });
	const breached = report.slo.filter((item) => item.status === 'breached');
	const scoreBelowMinimum = report.overall < report.minimumHealthScore;

	if (json) {
		console.log(JSON.stringify(report, null, 2));
		return breached.length > 0 || scoreBelowMinimum ? EXIT_BREACHED : EXIT_OK;
	}

	// --- check: saída curta para CI (§19) ------------------------------------
	if (command === 'check') {
		console.log('');
		console.log(`${paint('Documentation Health', 'bold')}  ${report.overall}/100  ${paint(`mínimo ${report.minimumHealthScore}`, 'dim')}`);
		console.log('');

		for (const item of report.slo) {
			const mark = item.status === 'breached' ? paint('✕', 'red') : item.status === 'at-risk' ? paint('~', 'yellow') : paint('✓', 'green');
			console.log(`  ${mark} ${DIMENSION_LABEL[item.dimension].padEnd(24)} ${item.measured ? `${item.current}%` : 'não medida'}`);
		}

		console.log('');
		const passed = breached.length === 0 && !scoreBelowMinimum;
		console.log(`  SLO: ${passed ? paint('PASS', 'green') : paint('FAIL', 'red')}`);
		console.log('');
		return passed ? EXIT_OK : EXIT_BREACHED;
	}

	// --- regressions (§13, §14) ---------------------------------------------
	if (command === 'regressions') {
		console.log('');
		console.log(paint('Regressão', 'bold'));
		console.log('');

		if (!report.regression) {
			console.log(paint('  Sem medição anterior para comparar. Grave um snapshot com `--snapshot`.', 'dim'));
			console.log('');
			return EXIT_OK;
		}

		const { regression } = report;
		const sign = regression.delta >= 0 ? '+' : '';
		console.log(
			`  ${regression.previous} → ${regression.current}  ${paint(`${sign}${regression.delta}`, regression.delta < 0 ? 'red' : 'green')}  ${paint(`desde ${regression.since.slice(0, 10)}`, 'dim')}`
		);

		if (regression.byDimension.length > 0) {
			console.log('');
			for (const entry of regression.byDimension) {
				console.log(`    ${DIMENSION_LABEL[entry.dimension as keyof typeof DIMENSION_LABEL] ?? entry.dimension}  ${paint(String(entry.delta), 'red')}`);
			}
		}

		if (regression.newIssues.length > 0) {
			console.log('');
			console.log(paint('  Defeitos novos', 'bold'));
			for (const issue of regression.newIssues) console.log(`    ${issue}`);
		}

		if (report.changeCandidates.length > 0) {
			console.log('');
			console.log(paint('  Mudanças que podem explicar', 'bold'));
			console.log(paint('  (candidatos, não causa: o produto pode ter mudado sem ninguém tocar na documentação)', 'dim'));
			for (const candidate of report.changeCandidates) {
				console.log(`    ${candidate.commit.slice(0, 8)} ${candidate.subject}`);
				console.log(paint(`      ${candidate.relevantFiles.length} arquivo(s) relevante(s)`, 'dim'));
			}
		}

		console.log('');
		return EXIT_OK;
	}

	// --- slo: alvos e orçamentos (§9, §10) ----------------------------------
	if (command === 'slo') {
		console.log('');
		console.log(paint('SLO', 'bold'));
		console.log('');
		for (const item of report.slo) {
			const current = item.measured ? `${item.current}%` : 'não medida';
			console.log(`  ${SLO_MARK[item.status]} ${DIMENSION_LABEL[item.dimension].padEnd(24)} ${current.padStart(11)}  ${paint(`alvo ${item.target}%`, 'dim')}`);
		}

		console.log('');
		console.log(paint('Error budget', 'bold'));
		console.log('');
		for (const budget of report.budgets) {
			const width = 20;
			const filled = Math.round((budget.remaining / 100) * width);
			const color = budget.exceeded ? 'red' : budget.remaining < 50 ? 'yellow' : 'green';
			console.log(
				`  ${budget.name.padEnd(22)} ${paint('█'.repeat(filled), color)}${paint('░'.repeat(width - filled), 'dim')} ${String(budget.remaining).padStart(3)}%  ${paint(`${budget.used}/${budget.allowed}`, 'dim')}`
			);
		}

		console.log('');
		return breached.length > 0 || scoreBelowMinimum ? EXIT_BREACHED : EXIT_OK;
	}

	// --- painel completo -----------------------------------------------------
	console.log('');
	console.log(
		`${paint('Documentation Health', 'bold')}  ${paint(`${report.overall}/100`, 'bold')}  ${SLO_MARK[report.sloStatus]} ${SLO_LABEL[report.sloStatus]}`
	);

	if (report.regression && report.regression.delta !== 0) {
		const sign = report.regression.delta > 0 ? '+' : '';
		console.log(
			paint(`  ${sign}${report.regression.delta} desde ${report.regression.since.slice(0, 10)}`, report.regression.delta < 0 ? 'red' : 'green')
		);
	}

	console.log('');

	if (!quiet) {
		for (const dimension of report.dimensions) {
			const label = DIMENSION_LABEL[dimension.dimension].padEnd(24);
			const value = dimension.measured ? `${String(dimension.value).padStart(3)}%` : ' — ';
			console.log(`  ${label} ${bar(dimension.value, dimension.measured)} ${value}`);
			console.log(`  ${' '.repeat(24)} ${paint(dimension.basis, 'dim')}`);
		}
		console.log('');
	}

	console.log(paint('Confiabilidade', 'bold'));
	console.log(
		paint(
			`  ${report.reliability.brokenLinks} link(s) quebrado(s) · ${report.reliability.failedTests} teste(s) reprovado(s) · ${report.reliability.brokenContracts} contrato(s) quebrado(s) · ${report.reliability.invalidPages} evidência(s) inválida(s)`,
			'dim'
		)
	);

	console.log('');
	console.log(paint('Frescor', 'bold'));
	console.log(
		paint(
			`  ${report.freshness.fresh} atual(is) · ${report.freshness.potentiallyStale} possivelmente obsoleta(s) · ${report.freshness.stale} obsoleta(s) · ${report.freshness.unknown} sem informação`,
			'dim'
		)
	);

	if (!quiet && report.freshness.worst.length > 0) {
		for (const verdict of report.freshness.worst.slice(0, 8)) {
			console.log(`  ${STALENESS_MARK[verdict.status]} ${verdict.path}`);
			console.log(paint(`      ${verdict.reasons.join('; ')}`, 'dim'));
		}
	}

	const breachedOrRisk = report.slo.filter((item) => item.status !== 'healthy');
	if (breachedOrRisk.length > 0) {
		console.log('');
		console.log(paint('SLO', 'bold'));
		for (const item of breachedOrRisk) {
			console.log(
				`  ${SLO_MARK[item.status]} ${DIMENSION_LABEL[item.dimension].padEnd(24)} ${item.measured ? `${item.current}%` : 'não medida'} ${paint(`(alvo ${item.target}%)`, 'dim')}`
			);
		}
	}

	const backlog = buildBacklog(report.gaps);
	if (!quiet && report.gaps.length > 0) {
		console.log('');
		console.log(paint('O que fazer primeiro', 'bold'));
		for (const priority of ['P0', 'P1', 'P2'] as const) {
			for (const gap of backlog[priority].slice(0, 5)) {
				console.log(`  ${priority}  ${gap.title}`);
			}
		}
	}

	console.log('');
	console.log(
		paint(
			`${report.totals.pages} páginas · ${report.totals.tests} testes · ${report.history.length} medição(ões) no histórico`,
			'dim'
		)
	);
	console.log('');

	return breached.length > 0 || scoreBelowMinimum ? EXIT_BREACHED : EXIT_OK;
}

main()
	.then((code) => {
		process.exitCode = code;
	})
	.catch((error) => {
		console.error('Falha ao medir a saúde da documentação:', error);
		process.exitCode = EXIT_RUNTIME_ERROR;
	});
