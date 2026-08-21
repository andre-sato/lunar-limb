/**
 * CLI de OpenAPI Overlay (spec § 35).
 *
 *   npm run overlay -- list
 *   npm run overlay -- validate
 *   npm run overlay -- validate overlays/public.yaml
 *   npm run overlay -- preview --view public
 *   npm run overlay -- diff --view public
 *   npm run overlay -- apply --view public --output .generated/openapi/public.yaml
 *   npm run overlay -- apply --view public --dry-run
 *   npm run overlay -- compare --before a.yaml --after b.yaml --output overlay.yaml
 *   npm run overlay -- provenance --view partner
 *
 * Códigos de saída: 0 ok · 1 problema que bloqueia · 2 uso inválido · 3 erro.
 *
 * **A especificação base nunca é escrita.** `apply` grava no caminho de saída ou
 * em nada; `compare` grava um overlay novo. Nenhum comando toca em
 * `api.specification`.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { loadOverlayConfig } from '../src/lib/overlay/config';
import { parseOverlay } from '../src/lib/overlay/parse';
import { validateOverlay } from '../src/lib/overlay/validate';
import { overlayFromComparison, overlayToYaml } from '../src/lib/overlay/compare';
import { describeHistory, historyByNode } from '../src/lib/overlay/provenance';
import {
	diffView,
	effectiveSpecFor,
	listViews,
	problemsFor,
	loadOverlay,
} from '../src/lib/overlay/service';
import { BASE_VIEW } from '../src/lib/overlay/types';

const COLORS = {
	reset: '[0m',
	dim: '[2m',
	red: '[31m',
	yellow: '[33m',
	green: '[32m',
	bold: '[1m',
};

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (text: string, color: keyof typeof COLORS) =>
	useColor ? `${COLORS[color]}${text}${COLORS.reset}` : text;

function value(argv: string[], flag: string): string | undefined {
	const index = argv.indexOf(flag);
	return index >= 0 ? argv[index + 1] : undefined;
}

function all(argv: string[], flag: string): string[] {
	const found: string[] = [];
	argv.forEach((argument, index) => {
		if (argument === flag && argv[index + 1]) found.push(argv[index + 1]);
	});
	return found;
}

const ROOT = process.cwd();

// ---------------------------------------------------------------------------

async function commandList(json: boolean): Promise<number> {
	const [config, views] = await Promise.all([loadOverlayConfig(), listViews()]);

	if (json) {
		console.log(JSON.stringify({ specification: config.specification, views }, null, 2));
		return 0;
	}

	console.log('');
	console.log(paint('API Views', 'bold'));
	console.log(paint(`base: ${config.specification}`, 'dim'));
	console.log('');
	console.log(`  ${paint('●', 'green')} ${BASE_VIEW.padEnd(12)} ${paint('a especificação como está no disco', 'dim')}`);

	for (const view of views) {
		console.log(`  ${paint('●', 'green')} ${view.name.padEnd(12)} ${paint(view.description ?? '', 'dim')}`);
		for (const file of view.overlays) console.log(paint(`        ${file}`, 'dim'));
	}

	if (views.length === 0) {
		console.log(paint('  Nenhuma view configurada em `overlays.yml`.', 'dim'));
	}

	console.log('');
	return 0;
}

async function commandValidate(argv: string[], json: boolean): Promise<number> {
	const config = await loadOverlayConfig();
	const explicit = argv.filter((entry) => entry.endsWith('.yaml') || entry.endsWith('.yml'));
	const files = explicit.length > 0 ? explicit : [...new Set(config.views.flatMap((view) => view.overlays))];

	if (files.length === 0) {
		console.error('Nenhum overlay para validar. Configure `overlays.views` ou passe um arquivo.');
		return 2;
	}

	const results = [];
	for (const file of files) results.push(await loadOverlay(file, config));

	if (json) {
		console.log(JSON.stringify(results.map(({ overlay, validation }) => ({ file: overlay.source, validation })), null, 2));
		return results.some((entry) => !entry.validation.valid) ? 1 : 0;
	}

	console.log('');
	console.log(paint(`${files.length} overlay(s)`, 'bold'));
	console.log(paint('Validação estrutural: o arquivo está bem formado. Se os alvos existem na especificação é outra pergunta — veja `preview`.', 'dim'));
	console.log('');

	for (const { overlay, validation } of results) {
		const mark = validation.valid ? paint('✓', 'green') : paint('✗', 'red');
		console.log(`  ${mark} ${overlay.source}  ${paint(`${overlay.actions.length} ação(ões)`, 'dim')}`);

		if (overlay.governance.owner || overlay.governance.purpose) {
			console.log(paint(`      dono: ${overlay.governance.owner ?? '—'} · finalidade: ${overlay.governance.purpose ?? '—'}`, 'dim'));
		}

		for (const issue of validation.issues) {
			const icon = issue.severity === 'error' ? paint('✗', 'red') : paint('⚠', 'yellow');
			console.log(`      ${icon} ${paint(issue.code, 'dim')} ${issue.message}`);
			if (issue.at) console.log(paint(`          em ${issue.at}`, 'dim'));
		}
	}

	console.log('');
	return results.some((entry) => !entry.validation.valid) ? 1 : 0;
}

function printOutcomes(view: string, effective: Awaited<ReturnType<typeof effectiveSpecFor>>): void {
	const outcomes = effective.result?.outcomes ?? [];

	console.log('');
	console.log(`${paint('Preview', 'bold')}  view ${paint(view, 'bold')}  ${paint(`${outcomes.length} ação(ões)`, 'dim')}`);
	console.log('');

	let current = '';
	for (const outcome of outcomes) {
		if (outcome.overlay !== current) {
			current = outcome.overlay;
			console.log(paint(`  ${current}`, 'dim'));
		}

		const mark = outcome.error
			? paint('✗', 'red')
			: outcome.matched === 0
				? paint('⚠', 'yellow')
				: paint('✓', 'green');

		console.log(`    ${mark} ${outcome.target}`);
		console.log(paint(`        ${outcome.kind}${outcome.matched > 0 ? ` · ${outcome.matched} nó(s)` : ''}`, 'dim'));

		if (outcome.error) console.log(paint(`        ${outcome.error}`, 'red'));
		else if (outcome.matched === 0) console.log(paint('        alvo não encontrou nenhum nó', 'yellow'));
		else if (outcome.description) console.log(paint(`        ${outcome.description.split('\n')[0]}`, 'dim'));
	}

	console.log('');
	console.log(paint('  Nada foi escrito: preview não grava arquivo.', 'dim'));
	console.log('');
}

async function commandPreview(argv: string[], json: boolean): Promise<number> {
	const view = value(argv, '--view') ?? BASE_VIEW;
	const [effective, problems] = await Promise.all([effectiveSpecFor(view), problemsFor(view)]);

	if (json) {
		console.log(JSON.stringify({ view, outcomes: effective.result?.outcomes ?? [], problems }, null, 2));
		return problems.blocking ? 1 : 0;
	}

	printOutcomes(view, effective);
	return problems.blocking ? 1 : 0;
}

async function commandDiff(argv: string[], json: boolean): Promise<number> {
	const view = value(argv, '--view') ?? BASE_VIEW;
	const diff = await diffView(view);

	if (json) {
		console.log(JSON.stringify(diff, null, 2));
		return 0;
	}

	console.log('');
	console.log(`${paint('Diff semântico', 'bold')}  base → ${paint(view, 'bold')}`);
	console.log(paint('Comparação da especificação interpretada, não do texto: reordenar chaves do YAML não aparece aqui.', 'dim'));
	console.log('');

	if (diff.changes.length === 0) {
		console.log(paint('  Nenhuma diferença. A view é igual à base.', 'dim'));
	}

	for (const change of diff.changes) {
		const icon =
			change.kind === 'removed' ? paint('−', 'red') : change.kind === 'added' ? paint('+', 'green') : paint('~', 'yellow');
		console.log(`  ${icon} ${change.label}${change.breaking ? paint('  BREAKING', 'red') : ''}`);
	}

	console.log('');
	console.log(
		`  ${diff.summary.removed} removido(s) · ${diff.summary.added} adicionado(s) · ${diff.summary.updated} atualizado(s) · ${diff.summary.breaking} incompatível(is)`
	);

	if (diff.unmatched.length > 0) {
		console.log('');
		console.log(paint(`  ${diff.unmatched.length} alvo(s) sem correspondência`, 'yellow'));
		for (const outcome of diff.unmatched) console.log(paint(`      ${outcome.target}`, 'dim'));
	}

	console.log('');
	return 0;
}

async function commandApply(argv: string[], json: boolean): Promise<number> {
	const view = value(argv, '--view') ?? BASE_VIEW;
	const dryRun = argv.includes('--dry-run');

	const [effective, problems] = await Promise.all([effectiveSpecFor(view), problemsFor(view)]);

	if (dryRun) {
		if (json) {
			console.log(JSON.stringify({ view, dryRun: true, outcomes: effective.result?.outcomes ?? [], problems }, null, 2));
		} else {
			printOutcomes(view, effective);
		}
		return problems.blocking ? 1 : 0;
	}

	if (problems.blocking) {
		console.error(paint('A view tem problema que bloqueia; rode `preview` para ver.', 'red'));
		return 1;
	}

	const config = await loadOverlayConfig();
	const output = value(argv, '--output') ?? path.join(config.outputDir, `${view}.yaml`);
	const target = path.resolve(ROOT, output);

	await mkdir(path.dirname(target), { recursive: true });
	await writeFile(target, effective.text, 'utf-8');

	if (json) {
		console.log(JSON.stringify({ view, output, operations: effective.result?.outcomes.length ?? 0 }, null, 2));
		return 0;
	}

	console.log('');
	console.log(`${paint('✓', 'green')} ${output}`);
	console.log(paint(`  view ${view} · ${effective.overlays.length} overlay(s) aplicado(s)`, 'dim'));
	console.log(paint(`  base intacta: ${config.specification}`, 'dim'));
	console.log('');
	return 0;
}

async function commandCompare(argv: string[], json: boolean): Promise<number> {
	const before = value(argv, '--before');
	const after = value(argv, '--after');

	if (!before || !after) {
		console.error('Informe --before e --after com dois arquivos de especificação.');
		return 2;
	}

	const [beforeRaw, afterRaw] = await Promise.all([
		readFile(path.resolve(ROOT, before), 'utf-8'),
		readFile(path.resolve(ROOT, after), 'utf-8'),
	]);

	const overlay = overlayFromComparison({
		before: yaml.load(beforeRaw),
		after: yaml.load(afterRaw),
		title: value(argv, '--title') ?? `Diferença entre ${path.basename(before)} e ${path.basename(after)}`,
		version: value(argv, '--overlay-version') ?? '1.0.0',
	});

	const text = overlayToYaml(overlay);
	const output = value(argv, '--output');

	if (output) {
		const target = path.resolve(ROOT, output);
		await mkdir(path.dirname(target), { recursive: true });
		await writeFile(target, text, 'utf-8');
	}

	if (json) {
		console.log(JSON.stringify({ actions: overlay.actions.length, output: output ?? null }, null, 2));
		return 0;
	}

	if (output) {
		console.log('');
		console.log(`${paint('✓', 'green')} ${output}  ${paint(`${overlay.actions.length} ação(ões)`, 'dim')}`);
		console.log(
			paint('  Revise antes de usar: o overlay descreve o que mudou, não o que deveria mudar.', 'dim')
		);
		console.log('');
	} else {
		console.log(text);
	}

	return 0;
}

async function commandProvenance(argv: string[], json: boolean): Promise<number> {
	const view = value(argv, '--view') ?? BASE_VIEW;
	const effective = await effectiveSpecFor(view);
	const history = historyByNode(effective.result?.provenance ?? []);

	if (json) {
		console.log(JSON.stringify(history, null, 2));
		return 0;
	}

	console.log('');
	console.log(`${paint('Proveniência', 'bold')}  view ${paint(view, 'bold')}`);
	console.log(paint('De onde veio cada alteração da especificação efetiva.', 'dim'));
	console.log('');

	if (history.length === 0) console.log(paint('  Nenhuma alteração: esta view é a base.', 'dim'));
	for (const node of history) console.log(describeHistory(node));

	console.log('');
	return 0;
}

// ---------------------------------------------------------------------------

async function main(): Promise<number> {
	const argv = process.argv.slice(2);
	const command = argv.find((entry) => !entry.startsWith('--') && !entry.endsWith('.yaml') && !entry.endsWith('.yml'));
	const json = argv.includes('--json');

	switch (command ?? 'list') {
		case 'list':
			return commandList(json);
		case 'validate':
			return commandValidate(argv, json);
		case 'preview':
			return commandPreview(argv, json);
		case 'diff':
			return commandDiff(argv, json);
		case 'apply':
			return commandApply(argv, json);
		case 'compare':
			return commandCompare(argv, json);
		case 'provenance':
			return commandProvenance(argv, json);
		default:
			console.error(`Subcomando desconhecido: ${command}`);
			console.error('Use: list, validate, preview, diff, apply, compare, provenance.');
			return 2;
	}
}

main()
	.then((code) => {
		process.exitCode = code;
	})
	.catch((error) => {
		console.error('Falha no motor de overlay:', error);
		process.exitCode = 3;
	});
