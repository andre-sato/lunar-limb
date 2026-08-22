/**
 * CLI do changelog automático (issue #15).
 *
 *   npm run changelog                      o mês anterior, só mostra
 *   npm run changelog -- --period 2026-08
 *   npm run changelog -- --write           grava a página
 *   npm run changelog -- --json
 *
 * Códigos de saída: 0 ok · 1 nada a publicar · 2 uso inválido · 3 erro.
 *
 * O padrão é **mostrar, não gravar**. Um changelog é o que um cliente lê para
 * decidir se precisa mexer no código dele, e a automação não tem como saber se
 * traduziu bem — quem grava pede explicitamente, e quem publica é a pessoa que
 * revisa o pull request.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { generateChangelog, nextOrder, outputPathFor, previousMonth } from '../src/lib/changelog/service';
import { periodLabel, renderChangelog } from '../src/lib/changelog/render';
import { loadProducts } from '../src/lib/products/registry';
import { CATEGORY_LABEL, DEFAULT_CONFIG } from '../src/lib/changelog/types';

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

async function main(): Promise<number> {
	const argv = process.argv.slice(2);
	const json = argv.includes('--json');
	const write = argv.includes('--write');
	const period = value(argv, '--period') ?? previousMonth();

	if (!/^\d{4}-\d{2}$/.test(period)) {
		console.error(`Período inválido: \`${period}\`. Use o formato AAAA-MM.`);
		return 2;
	}

	const changelog = await generateChangelog(period, {
		enrich: argv.includes('--enrich') || DEFAULT_CONFIG.enrich,
	});

	if (json) {
		console.log(JSON.stringify(changelog, null, 2));
		return changelog.empty ? 1 : 0;
	}

	console.log('');
	console.log(`${paint('Changelog', 'bold')}  ${periodLabel(period)}`);
	console.log(
		paint(
			`${changelog.considered} commit(s) no período · ${changelog.filtered} filtrado(s) como manutenção`,
			'dim'
		)
	);
	console.log('');

	if (changelog.empty) {
		console.log(paint('  Nenhuma mudança de interesse de quem integra neste mês.', 'dim'));
		// As pendências aparecem justamente aqui: mês vazio por falta de convenção
		// e mês vazio por nada ter acontecido são a mesma tela sem elas.
		for (const warning of changelog.warnings) console.log(paint(`  ${warning}`, 'yellow'));
		console.log(
			paint(
				'  Nada é gravado: publicar "nenhuma mudança relevante" todo mês ensina o leitor a não abrir o changelog.',
				'dim'
			)
		);
		console.log('');
		return 1;
	}

	for (const section of changelog.sections) {
		if (section.entries.length === 0) continue;
		console.log(`  ${paint(CATEGORY_LABEL[section.category], 'bold')}`);

		for (const entry of section.entries) {
			const mark = entry.breaking ? paint('✗', 'red') : entry.deprecation ? paint('⚠', 'yellow') : paint('•', 'green');
			console.log(`    ${mark} ${entry.text.replace(/\[`([^`]+)`\]\([^)]+\)/g, '$1')}`);
			if (entry.endpoints.length > 0) console.log(paint(`        ${entry.endpoints.join(' · ')}`, 'dim'));
		}
		console.log('');
	}

	if (changelog.warnings.length > 0) {
		console.log(paint(`  ${changelog.warnings.length} pendência(s) antes de publicar`, 'yellow'));
		for (const warning of changelog.warnings) console.log(paint(`      ${warning}`, 'dim'));
		console.log('');
	}

	if (!write) {
		console.log(paint('  Nada gravado. Use `--write` para gerar a página.', 'dim'));
		console.log('');
		return 0;
	}

	const output = outputPathFor(period);
	const target = path.resolve(process.cwd(), output);
	await mkdir(path.dirname(target), { recursive: true });
	// Os rótulos vêm do registro para o subtítulo dizer "Portal de documentação"
	// e não `portal`: o id serve à máquina, o rótulo é o que a pessoa lê.
	const registry = await loadProducts();
	const productLabels = Object.fromEntries(
		registry.products.map((product) => [product.id, product.label])
	);

	await writeFile(
		target,
		renderChangelog(changelog, { order: await nextOrder(DEFAULT_CONFIG), productLabels }),
		'utf-8'
	);

	console.log(`  ${paint('✓', 'green')} ${output}`);
	console.log(paint('    Revise antes de publicar — o texto vem de mensagens de commit.', 'dim'));
	console.log('');
	return 0;
}

main()
	.then((code) => {
		process.exitCode = code;
	})
	.catch((error) => {
		console.error('Falha ao gerar o changelog:', error);
		process.exitCode = 3;
	});
