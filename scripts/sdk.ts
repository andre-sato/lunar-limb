/**
 * CLI de SDK Engineering (§4.1, §13, §19, §20).
 *
 *   npm run sdk -- generate
 *   npm run sdk -- generate --language typescript
 *   npm run sdk -- check
 *   npm run sdk -- diff --from HEAD~1
 *
 * Códigos de saída: 0 ok · 1 inconsistente ou desatualizado · 2 uso inválido · 3 erro.
 *
 * **Local-first** (§24): nada aqui vai à rede, e `generate` nunca publica. Uma
 * geração que publica implicitamente transforma um comando de desenvolvimento
 * num lançamento.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { generateSdk, loadSdkConfig, readApiModel, readApiModelAt, specificationFor } from '../src/lib/sdk/service';
import { checkConsistency, diffSpecifications } from '../src/lib/sdk/check';

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

/**
 * Compila o SDK gerado (§13).
 *
 * Roda o `tsc` que já está em `node_modules` do projeto, contra o `tsconfig.json`
 * gerado. Sem `npm install` dentro do SDK: o pacote gerado não tem dependência de
 * execução, e instalar nada é mais rápido e mais previsível que instalar algo.
 */
function compile(output: string): { ok: boolean; detail: string } {
	const root = path.resolve(process.cwd(), output);
	if (!existsSync(path.join(root, 'tsconfig.json'))) return { ok: false, detail: 'Nenhum `tsconfig.json` gerado.' };

	const result = spawnSync('node', [path.resolve(process.cwd(), 'node_modules/typescript/bin/tsc'), '-p', root, '--noEmit'], {
		encoding: 'utf-8',
		cwd: process.cwd(),
	});

	if (result.error) return { ok: false, detail: `Não consegui executar o compilador: ${result.error.message}` };

	return result.status === 0
		? { ok: true, detail: 'Compila sem erro de tipo.' }
		: { ok: false, detail: `${(result.stdout || result.stderr).trim().split('\n').slice(0, 12).join('\n      ')}` };
}

async function main(): Promise<number> {
	const argv = process.argv.slice(2);
	const json = argv.includes('--json');

	const positional = argv.filter((argument, index) => !argument.startsWith('--') && !argv[index - 1]?.startsWith('--'));
	const command = positional[0] ?? 'generate';
	const language = value(argv, '--language');

	// --- diff ---------------------------------------------------------------
	if (command === 'diff') {
		const config = await loadSdkConfig();
		const from = value(argv, '--from') ?? 'HEAD';

		const [current, previous] = await Promise.all([readApiModel(config), readApiModelAt(config, from)]);

		if (!previous) {
			console.error(`Não consegui ler a especificação em \`${from}\`. Informe uma referência de Git válida.`);
			return 2;
		}

		const generator = config.generators[language ?? 'typescript'] ?? Object.values(config.generators)[0];
		const diff = diffSpecifications(specificationFor(previous, generator), specificationFor(current, generator));

		if (json) {
			console.log(JSON.stringify(diff, null, 2));
			return diff.breaking > 0 ? 1 : 0;
		}

		console.log('');
		console.log(`${paint('SDK CHANGE', 'bold')}  ${paint(`${from} → agora`, 'dim')}`);
		console.log('');

		const breaking = diff.changes.filter((change) => change.kind === 'breaking');
		const additive = diff.changes.filter((change) => change.kind === 'additive');

		if (breaking.length > 0) {
			console.log(paint('  BREAKING', 'red'));
			for (const change of breaking) {
				console.log(`    ${paint('-', 'red')} ${change.subject}`);
				console.log(paint(`        ${change.detail}`, 'dim'));
			}
			console.log('');
		}

		if (additive.length > 0) {
			console.log(paint('  ADDITIVE', 'green'));
			for (const change of additive) {
				console.log(`    ${paint('+', 'green')} ${change.subject}`);
				console.log(paint(`        ${change.detail}`, 'dim'));
			}
			console.log('');
		}

		if (diff.changes.length === 0) console.log(paint('  Nenhuma mudança de contrato.', 'dim'));

		if (diff.regenerate.length > 0) {
			console.log(paint('  REGENERATED', 'bold'));
			for (const file of diff.regenerate) console.log(paint(`    ${file}`, 'dim'));
			console.log('');
		}

		console.log(
			paint('  O diff deriva da diferença entre os contratos, não de comparação textual dos arquivos gerados.', 'dim')
		);
		console.log('');

		return diff.breaking > 0 ? 1 : 0;
	}

	if (command !== 'generate' && command !== 'check') {
		console.error(`Subcomando desconhecido: ${command}`);
		console.error('Use: generate, check, diff --from <ref>.');
		return 2;
	}

	// --- generate e check ---------------------------------------------------
	const write = command === 'generate';
	const results = await generateSdk({ write, language });

	if (results.length === 0) {
		console.error('Nenhum gerador habilitado em `sdk.yml`.');
		return 2;
	}

	if (json) {
		console.log(
			JSON.stringify(
				results.map((result) => ({
					language: result.language,
					output: result.output,
					files: result.files.map((file) => file.path),
					changed: result.changed,
					orphaned: result.orphaned,
					limitations: result.specification.limitations,
				})),
				null,
				2
			)
		);
		return 0;
	}

	let failed = false;

	for (const result of results) {
		const { specification } = result;

		console.log('');
		console.log(
			`${paint(`SDK ${result.language}`, 'bold')}  ${paint(`${specification.packageName}@${specification.version} · API ${specification.apiVersion}`, 'dim')}`
		);
		console.log('');
		console.log(
			`  ${specification.resources.length} recurso(s) · ${specification.resources.reduce((sum, resource) => sum + resource.operations.length, 0)} operação(ões) · ${specification.models.length} modelo(s)`
		);
		console.log(paint(`  ${result.files.length} arquivo(s) em \`${result.output}\``, 'dim'));

		if (command === 'generate') {
			console.log('');
			if (result.changed.length === 0) console.log(paint('  Nada mudou desde a última geração.', 'dim'));
			else for (const file of result.changed.slice(0, 20)) console.log(paint(`    ~ ${file}`, 'yellow'));
			for (const file of result.orphaned) console.log(paint(`    − ${file} (removido)`, 'red'));
		}

		// --- consistência (§14) ---------------------------------------------
		const problems = checkConsistency(specification, result.files);
		const errors = problems.filter((problem) => problem.severity === 'error');

		console.log('');
		console.log(paint('  Consistência SDK ↔ OpenAPI', 'bold'));

		if (problems.length === 0) {
			console.log(paint('    ✓ Toda operação, parâmetro e modelo da especificação está no SDK.', 'green'));
		} else {
			for (const problem of problems) {
				const mark = problem.severity === 'error' ? paint('✗', 'red') : paint('⚠', 'yellow');
				console.log(`    ${mark} ${problem.subject}: ${problem.message}`);
			}
		}

		if (errors.length > 0) failed = true;

		// --- compilação (§13) -----------------------------------------------
		if (command === 'check') {
			const compiled = compile(result.output);

			console.log('');
			console.log(paint('  Compilação', 'bold'));
			console.log(`    ${compiled.ok ? paint('✓', 'green') : paint('✗', 'red')} ${compiled.detail}`);

			if (!compiled.ok) failed = true;

			// SDK fora de sincronia com a especificação é o defeito que a CI existe
			// para pegar: quem instalou o pacote está usando um contrato que não
			// existe mais.
			const config = await loadSdkConfig();
			if (result.changed.length > 0) {
				console.log('');
				console.log(paint(`  ⚠ ${result.changed.length} arquivo(s) fora de sincronia com a especificação.`, 'yellow'));
				for (const file of result.changed.slice(0, 10)) console.log(paint(`    ~ ${file}`, 'dim'));
				console.log(paint('    Rode `npm run sdk -- generate`.', 'dim'));

				if (config.failOnStale) failed = true;
			}
		}

		if (specification.limitations.length > 0) {
			console.log('');
			console.log(paint('  O que a especificação não permitiu representar', 'bold'));
			for (const limitation of specification.limitations) console.log(paint(`    · ${limitation}`, 'dim'));
		}
	}

	console.log('');
	console.log(
		command === 'generate'
			? paint('  Geração local. Nada foi publicado — publicar é um comando à parte, e nunca implícito.', 'dim')
			: failed
				? paint('  ❌ Reprovado', 'red')
				: paint('  ✓ Aprovado', 'green')
	);
	console.log('');

	return failed ? 1 : 0;
}

main()
	.then((code) => {
		process.exitCode = code;
	})
	.catch((error) => {
		console.error('Falha no SDK:', error instanceof Error ? error.message : error);
		process.exitCode = 3;
	});
