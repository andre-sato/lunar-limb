/**
 * CLI da Documentation Test Suite (§15).
 *
 *   npm run docs:test                        perfil rápido (links + grafo)
 *   npm run docs:test -- --standard          acrescenta API e snippets
 *   npm run docs:test -- --strict            tudo, inclusive o que depende de rede
 *   npm run docs:test -- --changed           só o que mudou no Git
 *   npm run docs:test -- --file guides/x.mdx uma página
 *   npm run docs:test -- --json              saída legível por máquina
 *
 * Códigos de saída (§15):
 *   0 tudo passou · 1 houve falha · 2 opção inválida · 3 erro de execução
 *
 * Teste pulado **não** reprova. Ele aparece no relatório com o motivo, porque um
 * teste que não pôde rodar não é evidência de que o portal está bom — e some do
 * relatório é exatamente como se convence uma pessoa do contrário.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runDocumentationTests } from '../src/lib/doctest/runner';
import { PROFILE_CATEGORIES, type TestProfile, type TestReport, type TestResult } from '../src/lib/doctest/types';

const run = promisify(execFile);

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_BAD_USAGE = 2;
const EXIT_RUNTIME_ERROR = 3;

interface Options {
	profile: TestProfile;
	json: boolean;
	changed: boolean;
	file?: string;
}

function parseArgs(argv: string[]): Options {
	const options: Options = { profile: 'quick', json: false, changed: false };

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--quick') options.profile = 'quick';
		else if (arg === '--standard') options.profile = 'standard';
		else if (arg === '--strict') options.profile = 'strict';
		else if (arg === '--profile') {
			const value = argv[++i];
			if (!(value in PROFILE_CATEGORIES)) throw new Error(`Perfil desconhecido: ${value}`);
			options.profile = value as TestProfile;
		} else if (arg === '--changed') options.changed = true;
		else if (arg === '--file') options.file = argv[++i];
		else if (arg === '--json') options.json = true;
		else if (arg.startsWith('--')) throw new Error(`Opção desconhecida: ${arg}`);
		else options.file = arg;
	}

	if (options.file) options.file = options.file.replace(/\\/g, '/').replace(/^src\/content\/docs\//, '');

	return options;
}

/** Páginas de documentação alteradas segundo o Git. */
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

function where(result: TestResult): string {
	if (!result.location) return '';
	const { path, line, column } = result.location;
	const suffix = line ? `:${line}${column ? `:${column}` : ''}` : '';
	return paint(`src/content/docs/${path}${suffix}`, 'dim');
}

function printReport(report: TestReport): void {
	console.log('');
	console.log(`${paint('Documentation Test Suite', 'bold')}  ${paint(`perfil ${report.profile}`, 'dim')}`);
	console.log(paint(`categorias: ${report.categories.join(', ')}`, 'dim'));
	console.log('');

	const failures = report.results.filter((result) => result.status === 'fail');
	for (const failure of failures) {
		console.log(`${paint('✗', 'red')} ${paint(failure.id, 'bold')} ${failure.name}`);
		if (failure.message) console.log(`   ${failure.message}`);
		if (failure.expected || failure.actual) {
			console.log(paint(`   esperado: ${failure.expected ?? '—'}`, 'dim'));
			console.log(paint(`   obtido:   ${failure.actual ?? '—'}`, 'dim'));
		}
		const location = where(failure);
		if (location) console.log(`   ${location}`);
		console.log('');
	}

	// Pulados agrupados pelo motivo: listar duzentas linhas de "exige rede" só
	// esconde as falhas que importam.
	const skipped = report.results.filter((result) => result.status === 'skip');
	if (skipped.length > 0) {
		const byReason = new Map<string, number>();
		for (const result of skipped) {
			const reason = result.skipReason ?? 'sem motivo declarado';
			byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
		}
		console.log(paint('Pulados', 'bold'));
		for (const [reason, count] of byReason) console.log(paint(`  ${String(count).padStart(4)}  ${reason}`, 'dim'));
		console.log('');
	}

	const { summary } = report;
	console.log(
		[
			paint(`✓ ${summary.passed}`, 'green'),
			paint(`✗ ${summary.failed}`, 'red'),
			paint(`· ${summary.skipped} pulados`, 'dim'),
		].join('   ')
	);
	console.log(paint(`${summary.total} testes em ${summary.durationMs} ms`, 'dim'));
	console.log('');
	console.log(summary.passing ? paint('APROVADO', 'green') : paint('REPROVADO', 'red'));
	console.log('');
}

async function main(): Promise<number> {
	let options: Options;
	try {
		options = parseArgs(process.argv.slice(2));
	} catch (error) {
		console.error((error as Error).message);
		console.error('Use --quick, --standard, --strict, --changed, --file <caminho> ou --json.');
		return EXIT_BAD_USAGE;
	}

	const changed = options.changed ? await changedDocs() : undefined;

	if (changed && changed.length === 0) {
		if (options.json) console.log(JSON.stringify({ profile: options.profile, results: [], summary: { total: 0, passed: 0, failed: 0, skipped: 0, durationMs: 0, passing: true }, categories: [] }, null, 2));
		else console.log('Nenhuma página de documentação alterada.');
		return EXIT_OK;
	}

	const report = await runDocumentationTests({ profile: options.profile, file: options.file, changed });

	if (options.json) console.log(JSON.stringify(report, null, 2));
	else printReport(report);

	return report.summary.passing ? EXIT_OK : EXIT_FAILED;
}

main()
	.then((code) => {
		// `process.exitCode` em vez de `process.exit`: o perfil estrito deixa
		// conexões `keep-alive` abertas, e derrubar o processo no meio disso faz o
		// libuv reclamar em stderr depois do relatório. Aqui o Node encerra sozinho
		// quando os sockets fecham, e o código de saída continua o mesmo.
		process.exitCode = code;
		unref();
	})
	.catch((error) => {
		console.error('Falha ao executar os testes de documentação:', error);
		process.exitCode = EXIT_RUNTIME_ERROR;
		unref();
	});

/** Encerra o agente HTTP global para o processo não esperar o keep-alive. */
function unref(): void {
	const globalDispatcher = (globalThis as { [key: symbol]: unknown })[Symbol.for('undici.globalDispatcher.1')] as
		| { close?: () => Promise<void> }
		| undefined;
	void globalDispatcher?.close?.().catch(() => {});
}
