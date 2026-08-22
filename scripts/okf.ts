/**
 * CLI do Open Knowledge Format (issue #16).
 *
 *   npm run okf                    gera o bundle em `okf/`
 *   npm run okf -- --check         confere se o bundle comitado está em dia
 *   npm run okf -- validate        valida a conformidade do bundle no disco
 *   npm run okf -- --json          saída legível por máquina
 *
 * Códigos de saída: 0 ok · 1 não conformante ou desatualizado · 2 uso inválido · 3 erro.
 *
 * O bundle é **comitado**, e não gerado no build. O ponto do OKF é ser
 * compartilhável — um diretório que dá para clonar, empacotar num tarball ou
 * apontar um agente. Um bundle que só existe depois de `npm run build` não é
 * compartilhável; é um artefato. O preço disso é ele poder ficar velho, e é o
 * `--check` (mais o teste) que cobra o preço.
 */

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { collectContent } from '../src/lib/okf/collect';
import { buildBundle, renderBundle } from '../src/lib/okf/bundle';
import { validateBundle, type OkfFile } from '../src/lib/okf/validate';
import { loadGovernanceConfig } from '../src/lib/governance/config';
import { OKF_VERSION } from '../src/lib/okf/types';
import { portal } from '../src/config/portal';

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;
const EXIT_RUNTIME = 3;

const BUNDLE_ROOT = 'okf';

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

/** Lê o bundle que está no disco, para comparar ou validar. */
async function readBundle(root: string): Promise<OkfFile[]> {
	const files: OkfFile[] = [];

	async function visit(dir: string, prefix: string): Promise<void> {
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const absolute = path.join(dir, entry.name);
			const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) await visit(absolute, relative);
			else if (entry.name.endsWith('.md')) {
				files.push({ path: relative, contents: await readFile(absolute, 'utf-8') });
			}
		}
	}

	await visit(path.resolve(process.cwd(), root), '');
	return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function generate(now: number): Promise<OkfFile[]> {
	const [content, config] = await Promise.all([collectContent(), loadGovernanceConfig()]);

	const bundle = buildBundle(content, {
		siteUrl: process.env.SITE_URL ?? portal.siteUrl,
		now,
		config,
		title: `${portal.portalName} — Open Knowledge Bundle`,
		description: portal.description,
	});

	return renderBundle(bundle);
}

/**
 * Compara ignorando `generated.at` e a data do log.
 *
 * Sem isso, `--check` reprovaria a cada execução: o carimbo de geração muda por
 * definição, e um verificador que sempre falha ensina a equipe a ignorá-lo.
 */
function stableContents(file: OkfFile): string {
	return file.contents
		.replace(/^(\s*at:).*$/gm, '$1 <generated>')
		.replace(/^# \d{4}-\d{2}-\d{2}$/gm, '# <date>')
		.replace(/Bundle regenerado a partir do portal: \d+ conceitos/g, 'Bundle regenerado: <n> conceitos');
}

function diffBundles(fresh: OkfFile[], onDisk: OkfFile[]): string[] {
	const problems: string[] = [];
	const diskByPath = new Map(onDisk.map((file) => [file.path, file]));
	const freshByPath = new Map(fresh.map((file) => [file.path, file]));

	for (const file of fresh) {
		const existing = diskByPath.get(file.path);
		if (!existing) {
			problems.push(`faltando no disco: ${file.path}`);
			continue;
		}
		if (stableContents(existing) !== stableContents(file)) {
			problems.push(`desatualizado: ${file.path}`);
		}
	}
	for (const file of onDisk) {
		if (!freshByPath.has(file.path)) problems.push(`sobrando no disco: ${file.path}`);
	}

	return problems;
}

async function writeBundle(files: OkfFile[], root: string): Promise<void> {
	const absolute = path.resolve(process.cwd(), root);
	// Apaga antes de escrever para que um conceito removido do portal não fique
	// para trás no bundle — um arquivo órfão continuaria sendo servido como
	// conhecimento válido.
	await rm(absolute, { recursive: true, force: true });

	for (const file of files) {
		const target = path.join(absolute, file.path);
		await mkdir(path.dirname(target), { recursive: true });
		await writeFile(target, file.contents, 'utf-8');
	}
}

function reportValidation(
	validation: ReturnType<typeof validateBundle>,
	json: boolean
): void {
	if (json) {
		console.log(JSON.stringify(validation, null, 2));
		return;
	}

	const errors = validation.findings.filter((finding) => finding.severity === 'error');
	const warnings = validation.findings.filter((finding) => finding.severity === 'warning');

	console.log('');
	console.log(
		`${paint('OKF', 'bold')} ${paint(`v${OKF_VERSION}`, 'dim')}  ` +
			`${validation.concepts} conceitos · ${validation.files} arquivos`
	);
	console.log('');
	console.log(
		validation.conformant
			? `  ${paint('conformante', 'green')}`
			: `  ${paint('NÃO conformante', 'red')}  ${errors.length} erro(s)`
	);

	for (const finding of errors.slice(0, 20)) {
		console.log(`  ${paint('erro', 'red')}  ${finding.path}  ${paint(finding.rule, 'dim')}`);
		console.log(`        ${finding.message}`);
	}
	if (warnings.length > 0) {
		console.log('');
		console.log(`  ${paint(`${warnings.length} aviso(s)`, 'yellow')}`);
		for (const finding of warnings.slice(0, 10)) {
			console.log(`  ${paint('aviso', 'yellow')} ${finding.path}  ${paint(finding.rule, 'dim')}`);
			console.log(`        ${finding.message}`);
		}
		if (warnings.length > 10) {
			console.log(`        ${paint(`… e mais ${warnings.length - 10}`, 'dim')}`);
		}
	}
	console.log('');
}

async function main(): Promise<number> {
	const argv = process.argv.slice(2);
	const json = argv.includes('--json');
	const check = argv.includes('--check');
	const command = argv.find((argument) => !argument.startsWith('--')) ?? (check ? 'check' : 'build');

	if (!['build', 'check', 'validate'].includes(command)) {
		console.error(`Comando desconhecido: ${command}. Use build, check ou validate.`);
		return EXIT_USAGE;
	}

	const now = Date.now();

	if (command === 'validate') {
		const onDisk = await readBundle(BUNDLE_ROOT);
		if (onDisk.length === 0) {
			console.error(`Nenhum bundle em \`${BUNDLE_ROOT}/\`. Rode \`npm run okf\` primeiro.`);
			return EXIT_FAILED;
		}
		const validation = validateBundle(onDisk);
		reportValidation(validation, json);
		return validation.conformant ? EXIT_OK : EXIT_FAILED;
	}

	const fresh = await generate(now);
	const validation = validateBundle(fresh);

	if (command === 'check' || check) {
		const onDisk = await readBundle(BUNDLE_ROOT);
		const problems = diffBundles(fresh, onDisk);

		if (json) {
			console.log(JSON.stringify({ ...validation, upToDate: problems.length === 0, problems }, null, 2));
		} else {
			reportValidation(validation, false);
			if (problems.length === 0) {
				console.log(`  ${paint('bundle em dia', 'green')}`);
			} else {
				console.log(`  ${paint('bundle desatualizado', 'red')}  ${problems.length} diferença(s)`);
				for (const problem of problems.slice(0, 20)) console.log(`    ${problem}`);
				console.log('');
				console.log(`  Rode ${paint('npm run okf', 'bold')} para regenerar.`);
			}
			console.log('');
		}

		return problems.length === 0 && validation.conformant ? EXIT_OK : EXIT_FAILED;
	}

	await writeBundle(fresh, BUNDLE_ROOT);
	if (!json) console.log(`  ${paint('escrito', 'green')} ${BUNDLE_ROOT}/ · ${fresh.length} arquivos`);
	reportValidation(validation, json);

	return validation.conformant ? EXIT_OK : EXIT_FAILED;
}

main()
	.then((code) => process.exit(code))
	.catch((error) => {
		console.error(error instanceof Error ? error.stack : error);
		process.exit(EXIT_RUNTIME);
	});
