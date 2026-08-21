/**
 * CLI de API Views (spec § 16, § 32, § 36).
 *
 *   npm run api -- views
 *   npm run api -- build
 *   npm run api -- build --view public
 *   npm run api -- check
 *
 * `check` é o comando consolidado que a CI roda: valida os overlays, resolve os
 * alvos, procura conflito, e confirma que cada especificação efetiva ainda é uma
 * OpenAPI que o parser aceita.
 *
 * Ele **não** roda contratos, testes de documentação nem SDK — esses já têm os
 * seus comandos, e chamá-los daqui criaria um segundo lugar onde a mesma
 * verificação pode divergir. O que este comando garante é o degrau anterior: que
 * a especificação que aqueles comandos vão consumir existe e é válida.
 *
 * Códigos de saída: 0 ok · 1 verificação reprovada · 2 uso inválido · 3 erro.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseOpenApi } from '../src/lib/api-explorer/model';
import { loadOverlayConfig } from '../src/lib/overlay/config';
import { effectiveSpecFor, listViews, problemsFor } from '../src/lib/overlay/service';
import { BASE_VIEW } from '../src/lib/overlay/types';

const COLORS = {
	reset: '[0m',
	dim: '[2m',
	red: '[31m',
	yellow: '[33m',
	green: '[32m',
	bold: '[1m',
};

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (text: string, color: keyof typeof COLORS) =>
	useColor ? `${COLORS[color]}${text}${COLORS.reset}` : text;

function value(argv: string[], flag: string): string | undefined {
	const index = argv.indexOf(flag);
	return index >= 0 ? argv[index + 1] : undefined;
}

const ROOT = process.cwd();

/** As views a processar: a pedida, ou a base mais todas as configuradas. */
async function targetViews(requested?: string): Promise<string[]> {
	if (requested) return [requested];
	return [BASE_VIEW, ...(await listViews()).map((view) => view.name)];
}

async function commandViews(json: boolean): Promise<number> {
	const [config, views] = await Promise.all([loadOverlayConfig(), listViews()]);

	if (json) {
		console.log(JSON.stringify({ specification: config.specification, enabled: config.enabled, views }, null, 2));
		return 0;
	}

	console.log('');
	console.log(paint('API Views', 'bold'));
	console.log(
		paint(
			'Uma view é um nome e a lista ordenada de overlays que a produzem. A mesma OpenAPI origina vários produtos de API sem duplicar o contrato.',
			'dim'
		)
	);
	console.log('');

	for (const name of await targetViews()) {
		const effective = await effectiveSpecFor(name);
		const model = parseOpenApi(effective.text);
		const overlays = effective.overlays.length;

		console.log(
			`  ${paint('●', 'green')} ${name.padEnd(12)} ${String(model.operations.length).padStart(3)} operação(ões)  ${paint(overlays === 0 ? 'sem overlay' : `${overlays} overlay(s)`, 'dim')}`
		);

		const view = views.find((entry) => entry.name === name);
		if (view?.description) console.log(paint(`        ${view.description}`, 'dim'));
	}

	console.log('');
	return 0;
}

async function commandBuild(argv: string[], json: boolean): Promise<number> {
	const config = await loadOverlayConfig();
	const views = await targetViews(value(argv, '--view'));
	const written: Array<{ view: string; output: string; operations: number }> = [];

	for (const name of views) {
		const problems = await problemsFor(name);
		if (problems.blocking) {
			console.error(paint(`✗ ${name}: problema que bloqueia. Rode \`npm run overlay -- preview --view ${name}\`.`, 'red'));
			return 1;
		}

		const effective = await effectiveSpecFor(name);
		const output = path.join(config.outputDir, `${name}.yaml`);
		const target = path.resolve(ROOT, output);

		await mkdir(path.dirname(target), { recursive: true });
		await writeFile(target, effective.text, 'utf-8');

		written.push({ view: name, output, operations: parseOpenApi(effective.text).operations.length });
	}

	if (json) {
		console.log(JSON.stringify({ written }, null, 2));
		return 0;
	}

	console.log('');
	console.log(paint('Especificações efetivas', 'bold'));
	console.log('');

	for (const entry of written) {
		console.log(`  ${paint('✓', 'green')} ${entry.output.padEnd(38)} ${String(entry.operations).padStart(3)} operação(ões)`);
	}

	console.log('');
	console.log(paint(`  Base intacta: ${config.specification}`, 'dim'));
	console.log(paint('  O diretório de saída é derivado e ignorado pelo Git — versioná-lo criaria uma segunda cópia do contrato.', 'dim'));
	console.log('');
	return 0;
}

async function commandCheck(argv: string[], json: boolean): Promise<number> {
	const views = await targetViews(value(argv, '--view'));
	const report: Array<{ view: string; ok: boolean; notes: string[] }> = [];

	for (const name of views) {
		const notes: string[] = [];
		let ok = true;

		const problems = await problemsFor(name);

		for (const entry of problems.invalidOverlays) {
			ok = false;
			for (const issue of entry.validation.issues.filter((i) => i.severity === 'error')) {
				notes.push(`${entry.overlay.source}: ${issue.code} ${issue.message}`);
			}
		}

		for (const outcome of problems.failedTargets) {
			ok = false;
			notes.push(`${outcome.overlay} ação ${outcome.index}: ${outcome.error}`);
		}

		for (const outcome of problems.unmatched) {
			if (problems.blocking) ok = false;
			notes.push(`${outcome.overlay} ação ${outcome.index}: alvo \`${outcome.target}\` não encontrou nenhum nó`);
		}

		for (const conflict of problems.conflicts) {
			if (conflict.severity === 'error') ok = false;
			notes.push(`conflito em ${conflict.label}: ${conflict.explanation}`);
		}

		// O degrau final: a especificação efetiva ainda é uma OpenAPI legível?
		// Um overlay pode remover `info` inteiro e produzir um documento que o
		// parser recusa — e é melhor descobrir aqui que no build da documentação.
		try {
			const effective = await effectiveSpecFor(name);
			const model = parseOpenApi(effective.text);
			if (model.operations.length === 0) {
				notes.push('a especificação efetiva não tem nenhuma operação');
			}
		} catch (error) {
			ok = false;
			notes.push(`especificação efetiva inválida: ${error instanceof Error ? error.message : error}`);
		}

		report.push({ view: name, ok, notes });
	}

	const failed = report.filter((entry) => !entry.ok);

	if (json) {
		console.log(JSON.stringify({ report, passed: failed.length === 0 }, null, 2));
		return failed.length > 0 ? 1 : 0;
	}

	console.log('');
	console.log(paint('Verificação das API Views', 'bold'));
	console.log('');

	for (const entry of report) {
		console.log(`  ${entry.ok ? paint('✓', 'green') : paint('✗', 'red')} ${entry.view}`);
		for (const note of entry.notes) console.log(paint(`      ${note}`, entry.ok ? 'yellow' : 'red'));
	}

	console.log('');
	console.log(
		failed.length === 0
			? paint('  APROVADO', 'green')
			: paint(`  REPROVADO — ${failed.length} view(s)`, 'red')
	);
	console.log('');
	console.log(
		paint(
			'  Contratos, testes de documentação e SDK têm os seus próprios comandos. Este garante o degrau anterior: que a especificação que eles consomem existe e é válida.',
			'dim'
		)
	);
	console.log('');

	return failed.length > 0 ? 1 : 0;
}

async function main(): Promise<number> {
	const argv = process.argv.slice(2);
	const command = argv.find((entry) => !entry.startsWith('--')) ?? 'views';
	const json = argv.includes('--json');

	switch (command) {
		case 'views':
			return commandViews(json);
		case 'build':
			return commandBuild(argv, json);
		case 'check':
			return commandCheck(argv, json);
		default:
			console.error(`Subcomando desconhecido: ${command}`);
			console.error('Use: views, build, check.');
			return 2;
	}
}

main()
	.then((code) => {
		process.exitCode = code;
	})
	.catch((error) => {
		console.error('Falha ao processar as API Views:', error);
		process.exitCode = 3;
	});
