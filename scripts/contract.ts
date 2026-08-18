/**
 * CLI de Contract Testing (§23, §24).
 *
 *   npm run contract -- test                 verifica todos os contratos
 *   npm run contract -- test --changed       só o que mudou no Git
 *   npm run contract -- test --api portal-api.yaml
 *   npm run contract -- report               relatório com o score
 *
 * Códigos de saída: 0 nenhum contrato quebrado · 1 há contrato quebrado ·
 * 2 uso inválido · 3 erro de execução.
 *
 * `warning` **não** reprova. Aviso é meio caminho — parâmetro obrigatório que a
 * página não lista, campo a mais numa requisição — e reprovar por isso levaria a
 * equipe a desligar o portão inteiro, que é o resultado oposto ao pretendido.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runContractTests } from '../src/lib/contract/engine';
import { CONTRACT_LABEL, CONTRACT_MARK, DIMENSION_LABEL } from '../src/lib/contract/types';

const run = promisify(execFile);

const EXIT_OK = 0;
const EXIT_BROKEN = 1;
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

async function changedDocs(): Promise<string[]> {
	let output = '';
	try {
		const { stdout } = await run('git', ['diff', '--name-only', 'HEAD']);
		output = stdout;
		const { stdout: untracked } = await run('git', ['ls-files', '--others', '--exclude-standard']);
		output += untracked;
	} catch {
		return [];
	}

	return [
		...new Set(
			output
				.split(/\r?\n/)
				.map((line) => line.trim().replace(/\\/g, '/'))
				.filter((line) => line.startsWith('src/content/docs/') && /\.mdx?$/.test(line))
				.map((line) => line.slice('src/content/docs/'.length))
		),
	];
}

async function main(): Promise<number> {
	const argv = process.argv.slice(2);
	const command = argv[0] ?? 'test';

	if (!['test', 'report'].includes(command)) {
		console.error(`Subcomando desconhecido: ${command}`);
		console.error('Use: test [--changed] [--api <arquivo>] [--json], report.');
		return EXIT_BAD_USAGE;
	}

	const json = argv.includes('--json');
	const apiIndex = argv.indexOf('--api');
	const api = apiIndex >= 0 ? argv[apiIndex + 1] : undefined;
	const changed = argv.includes('--changed') ? await changedDocs() : undefined;

	if (changed && changed.length === 0) {
		if (!json) console.log('Nenhuma página de documentação alterada.');
		else console.log(JSON.stringify({ contracts: [], counts: { valid: 0, invalid: 0, warning: 0, unknown: 0 } }, null, 2));
		return EXIT_OK;
	}

	const report = await runContractTests({ changed, api });

	if (json) {
		console.log(JSON.stringify(report, null, 2));
		return report.counts.invalid > 0 ? EXIT_BROKEN : EXIT_OK;
	}

	console.log('');
	console.log(paint('Documentation Contract Testing', 'bold'));
	console.log(paint('"este exemplo representa o contrato de verdade?"', 'dim'));
	console.log('');

	for (const contract of report.contracts) {
		if (command === 'test' && contract.status === 'valid') continue;

		console.log(`${CONTRACT_MARK[contract.status]} ${paint(contract.id, 'bold')} ${paint(CONTRACT_LABEL[contract.status], 'dim')}`);

		if (contract.documentation.length > 0) {
			console.log(
				paint(
					`   documentado em: ${contract.documentation.map((reference) => `${reference.path} (${reference.association === 'declared' ? 'declarado' : 'inferido'})`).join(', ')}`,
					'dim'
				)
			);
		}

		for (const assertion of contract.assertions) {
			if (assertion.status === 'valid') continue;
			const mark = assertion.status === 'invalid' ? paint('✗', 'red') : assertion.status === 'warning' ? paint('⚠', 'yellow') : paint('·', 'dim');
			console.log(`   ${mark} ${assertion.id} ${assertion.message}`);
			if (assertion.expected || assertion.actual) {
				console.log(paint(`      esperado: ${assertion.expected ?? '—'} · obtido: ${assertion.actual ?? '—'}`, 'dim'));
			}
			if (assertion.location) {
				console.log(paint(`      src/content/docs/${assertion.location.path}${assertion.location.line ? `:${assertion.location.line}` : ''}`, 'dim'));
			}
		}
		console.log('');
	}

	if (command === 'report') {
		console.log(paint('Contract Score', 'bold'));
		for (const dimension of report.score.byDimension) {
			console.log(`  ${DIMENSION_LABEL[dimension.dimension].padEnd(20)} ${String(dimension.value).padStart(3)}%  ${paint(`${dimension.checked} verificação(ões)`, 'dim')}`);
		}
		console.log(`  ${paint('Geral'.padEnd(20), 'bold')} ${String(report.score.value).padStart(3)}%`);
		console.log('');
	}

	const { valid, invalid, warning, unknown } = report.counts;
	console.log(
		[
			paint(`🟢 ${valid}`, 'green'),
			paint(`🔴 ${invalid}`, 'red'),
			paint(`🟡 ${warning}`, 'yellow'),
			paint(`⚪ ${unknown}`, 'dim'),
		].join('   ')
	);
	console.log('');

	// Só `invalid` reprova. Ver o comentário do topo.
	return invalid > 0 ? EXIT_BROKEN : EXIT_OK;
}

main()
	.then((code) => {
		process.exitCode = code;
	})
	.catch((error) => {
		console.error('Falha ao testar os contratos:', error);
		process.exitCode = EXIT_RUNTIME_ERROR;
	});
