/**
 * CLI do Documentation Linter (§73, §74).
 *
 *   npm run docs:lint                  analisa toda a documentação
 *   npm run docs:lint -- --changed     só o que mudou no Git, mais os consumidores
 *   npm run docs:lint -- --json        saída legível por máquina
 *   npm run docs:lint -- --path guides/authentication.mdx
 *
 * Códigos de saída (§74):
 *   0 aprovado · 1 quality gate reprovado · 2 erro de configuração · 3 erro de execução
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lintDocument, summarizeWorkspace } from '../src/lib/linter/lint';
import { loadConfig } from '../src/lib/linter/config';
import { getContentGraph } from '../src/lib/editor/content-graph';
import type { LintResult } from '../src/lib/linter/types';

const run = promisify(execFile);

const EXIT_OK = 0;
const EXIT_GATE_FAILED = 1;
const EXIT_CONFIG_ERROR = 2;
const EXIT_RUNTIME_ERROR = 3;

const DOCS_ROOT = path.resolve(process.cwd(), 'src/content/docs');
const SNIPPETS_ROOT = path.resolve(process.cwd(), 'src/content/snippets');

interface Options {
	changed: boolean;
	json: boolean;
	quiet: boolean;
	paths: string[];
	profile?: string;
	minScore?: number;
}

function parseArgs(argv: string[]): Options {
	const options: Options = { changed: false, json: false, quiet: false, paths: [] };

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--changed') options.changed = true;
		else if (arg === '--json') options.json = true;
		else if (arg === '--quiet') options.quiet = true;
		else if (arg === '--path') options.paths.push(argv[++i]);
		else if (arg === '--profile') options.profile = argv[++i];
		else if (arg === '--min-score') options.minScore = Number.parseFloat(argv[++i]);
		else if (arg.startsWith('--')) throw new Error(`Opção desconhecida: ${arg}`);
		else options.paths.push(arg);
	}

	return options;
}

async function walk(dir: string, base = ''): Promise<string[]> {
	const found: string[] = [];
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return found;
	}

	for (const entry of entries) {
		const relative = base ? `${base}/${entry.name}` : entry.name;
		if (entry.isDirectory()) found.push(...(await walk(path.join(dir, entry.name), relative)));
		else if (/\.mdx?$/.test(entry.name)) found.push(relative);
	}
	return found;
}

/**
 * Arquivos alterados segundo o Git, mais as páginas que consomem os blocos
 * alterados (§76, §77).
 *
 * É o ponto em que o linter se apoia no Content Graph que já existe: mexer em
 * `authentication-warning.md` muda o texto renderizado de toda página que o
 * inclui, então analisar só o arquivo tocado deixaria passar o efeito real.
 */
async function changedFiles(): Promise<string[]> {
	let output = '';
	try {
		const { stdout } = await run('git', ['diff', '--name-only', 'HEAD']);
		output = stdout;
		const { stdout: untracked } = await run('git', ['ls-files', '--others', '--exclude-standard']);
		output += untracked;
	} catch {
		return [];
	}

	const all = output
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => line.replace(/\\/g, '/'));

	const docs = all
		.filter((file) => file.startsWith('src/content/docs/') && /\.mdx?$/.test(file))
		.map((file) => file.slice('src/content/docs/'.length));

	const snippets = all
		.filter((file) => file.startsWith('src/content/snippets/') && /\.mdx?$/.test(file))
		.map((file) => file.slice('src/content/snippets/'.length));

	if (snippets.length === 0) return [...new Set(docs)];

	// Um bloco mudou: acrescenta quem o consome.
	const affected = new Set(docs);
	try {
		const graph = await getContentGraph({ fresh: true });
		for (const snippet of snippets) {
			const id = snippet.replace(/\.mdx?$/, '');
			for (const edge of graph.edges) {
				if (edge.target !== id) continue;
				const consumer = graph.nodes.find((node) => node.key === edge.source);
				if (consumer && consumer.root === 'docs') affected.add(consumer.path);
			}
		}
	} catch {
		// Sem grafo disponível, analisa ao menos os arquivos tocados.
	}

	return [...affected];
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

function severityMark(severity: string): string {
	if (severity === 'error') return paint('✗', 'red');
	if (severity === 'warning') return paint('⚠', 'yellow');
	if (severity === 'suggestion') return paint('·', 'dim');
	return paint('i', 'dim');
}

function printResult(result: LintResult, quiet: boolean): void {
	const scoreText = result.score.toFixed(1).padStart(4);
	const colored =
		result.gate === 'fail'
			? paint(scoreText, 'red')
			: result.gate === 'warning'
				? paint(scoreText, 'yellow')
				: paint(scoreText, 'green');

	console.log(`${colored}  ${result.path}  ${paint(result.band, 'dim')}`);

	if (quiet) return;

	for (const finding of result.findings) {
		if (finding.severity === 'info') continue;
		const where = paint(`${finding.location.startLine}:${finding.location.startColumn}`, 'dim');
		console.log(`      ${severityMark(finding.severity)} ${where} ${finding.message} ${paint(finding.ruleId, 'dim')}`);
	}
}

async function main(): Promise<number> {
	let options: Options;
	try {
		options = parseArgs(process.argv.slice(2));
	} catch (error) {
		console.error((error as Error).message);
		return EXIT_CONFIG_ERROR;
	}

	let config;
	try {
		config = await loadConfig(options.profile ?? 'default');
	} catch (error) {
		console.error(`Erro de configuração: ${(error as Error).message}`);
		return EXIT_CONFIG_ERROR;
	}

	if (options.minScore !== undefined) {
		if (!Number.isFinite(options.minScore)) {
			console.error('--min-score exige um número.');
			return EXIT_CONFIG_ERROR;
		}
		config = { ...config, qualityGate: { ...config.qualityGate, minimumScore: options.minScore } };
	}

	let targets: string[];
	if (options.paths.length > 0) targets = options.paths;
	else if (options.changed) targets = await changedFiles();
	else targets = await walk(DOCS_ROOT);

	if (targets.length === 0) {
		if (!options.json) console.log('Nenhum documento para analisar.');
		return EXIT_OK;
	}

	const results: LintResult[] = [];
	for (const relative of targets) {
		const absolute = path.resolve(DOCS_ROOT, relative);
		let raw: string;
		try {
			raw = await readFile(absolute, 'utf8');
		} catch {
			// Arquivo excluído no diff, ou um snippet: tenta a outra raiz.
			try {
				raw = await readFile(path.resolve(SNIPPETS_ROOT, relative), 'utf8');
			} catch {
				continue;
			}
		}
		results.push(await lintDocument(raw, { path: relative, config, profile: options.profile }));
	}

	const summary = summarizeWorkspace(results);

	if (options.json) {
		console.log(JSON.stringify({ summary, results }, null, 2));
	} else {
		console.log('');
		console.log(paint('Documentation Linter', 'bold'));
		console.log('');

		const ordered = [...results].sort((a, b) => a.score - b.score);
		for (const result of ordered) printResult(result, options.quiet);

		console.log('');
		console.log(`${summary.analyzed} páginas analisadas`);
		console.log(`${paint(`✓ ${summary.passing} aprovadas`, 'green')}   ${paint(`✗ ${summary.failing} reprovadas`, 'red')}`);
		console.log(`Nota média: ${summary.averageScore.toFixed(1)}`);

		if (summary.topProblems.length > 0) {
			console.log('');
			console.log(paint('Problemas mais frequentes', 'bold'));
			for (const problem of summary.topProblems.slice(0, 6)) {
				console.log(`  ${String(problem.count).padStart(4)}  ${problem.ruleId}`);
			}
		}

		const gateLabel =
			summary.gate === 'fail'
				? paint('REPROVADO', 'red')
				: summary.gate === 'warning'
					? paint('APROVADO COM AVISOS', 'yellow')
					: paint('APROVADO', 'green');
		console.log('');
		console.log(`Quality gate: ${gateLabel}  (mínimo ${config.qualityGate.minimumScore.toFixed(1)})`);
		console.log('');
	}

	return summary.gate === 'fail' ? EXIT_GATE_FAILED : EXIT_OK;
}

main()
	.then((code) => process.exit(code))
	.catch((error) => {
		console.error('Falha ao executar o linter:', error);
		process.exit(EXIT_RUNTIME_ERROR);
	});
