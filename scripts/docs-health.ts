/**
 * Health Center na linha de comando (§2, §5, §11).
 *
 *   npm run docs:health              painel completo
 *   npm run docs:health -- --json    saída legível por máquina
 *   npm run docs:health -- --quiet   só o resumo e os SLOs violados
 *
 * Códigos de saída:
 *   0 nenhum SLO violado · 1 algum violado · 3 erro de execução
 *
 * O código de saída é o que permite usar isto em CI. `at-risk` **não** falha:
 * risco é convite a olhar, e reprovar o pipeline por causa dele faria a equipe
 * afrouxar os alvos até o painel ficar sempre verde — que é o oposto do que um
 * SLO serve para fazer.
 */

import { collectHealth } from '../src/lib/health/collect';
import { buildBacklog } from '../src/lib/health/gaps';
import { DIMENSION_LABEL, SLO_LABEL, SLO_MARK } from '../src/lib/health/types';

const EXIT_OK = 0;
const EXIT_BREACHED = 1;
const EXIT_RUNTIME_ERROR = 3;

const COLORS = {
	reset: '[0m',
	dim: '[2m',
	red: '[31m',
	yellow: '[33m',
	green: '[32m',
	bold: '[1m',
};

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
function paint(text: string, color: keyof typeof COLORS): string {
	return useColor ? `${COLORS[color]}${text}${COLORS.reset}` : text;
}

function bar(value: number, measured: boolean, width = 24): string {
	if (!measured) return paint('—'.repeat(width), 'dim');
	const filled = Math.round((value / 100) * width);
	const color = value >= 90 ? 'green' : value >= 75 ? 'yellow' : 'red';
	return paint('█'.repeat(filled), color) + paint('░'.repeat(width - filled), 'dim');
}

async function main(): Promise<number> {
	const argv = process.argv.slice(2);
	const json = argv.includes('--json');
	const quiet = argv.includes('--quiet');

	const report = await collectHealth();
	const backlog = buildBacklog(report.gaps);

	if (json) {
		console.log(JSON.stringify({ ...report, backlog }, null, 2));
		return report.sloStatus === 'breached' ? EXIT_BREACHED : EXIT_OK;
	}

	console.log('');
	console.log(
		`${paint('Documentation Health', 'bold')}  ${paint(`${report.overall}%`, 'bold')}  ${SLO_MARK[report.sloStatus]} ${SLO_LABEL[report.sloStatus]}`
	);
	console.log('');

	if (!quiet) {
		for (const dimension of report.dimensions) {
			const label = DIMENSION_LABEL[dimension.dimension].padEnd(20);
			const value = dimension.measured ? `${String(dimension.value).padStart(3)}%` : ' — ';
			console.log(`  ${label} ${bar(dimension.value, dimension.measured)} ${value}`);
			console.log(`  ${' '.repeat(20)} ${paint(dimension.basis, 'dim')}`);
		}
		console.log('');
	}

	const breached = report.slo.filter((item) => item.status === 'breached');
	const atRisk = report.slo.filter((item) => item.status === 'at-risk');

	for (const item of [...breached, ...atRisk]) {
		const mark = SLO_MARK[item.status];
		const current = item.measured ? `${item.current}%` : 'não medida';
		console.log(`  ${mark} ${DIMENSION_LABEL[item.dimension].padEnd(20)} ${current} (alvo ${item.target}%)`);
	}

	if (breached.length === 0 && atRisk.length === 0) console.log(paint('  Todos os SLOs dentro do alvo.', 'green'));

	if (!quiet && report.gaps.length > 0) {
		console.log('');
		console.log(paint('O que fazer primeiro', 'bold'));
		for (const priority of ['P0', 'P1', 'P2'] as const) {
			for (const gap of backlog[priority].slice(0, 8)) {
				console.log(`  ${priority}  ${gap.title}`);
				console.log(`      ${paint(gap.detail, 'dim')}`);
			}
			if (backlog[priority].length > 8) {
				console.log(paint(`      … e mais ${backlog[priority].length - 8} em ${priority}`, 'dim'));
			}
		}
	}

	console.log('');
	console.log(
		paint(
			`${report.totals.pages} páginas · ${report.totals.documentedEndpoints}/${report.totals.endpoints} endpoints · ${report.totals.tests} testes · ${report.totals.brokenLinks} link(s) quebrado(s)`,
			'dim'
		)
	);
	console.log('');

	return breached.length > 0 ? EXIT_BREACHED : EXIT_OK;
}

main()
	.then((code) => {
		process.exitCode = code;
	})
	.catch((error) => {
		console.error('Falha ao medir a saúde da documentação:', error);
		process.exitCode = EXIT_RUNTIME_ERROR;
	});
