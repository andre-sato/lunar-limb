/**
 * CLI de Enterprise / Multi-repository (P3.5 — § CLI).
 *
 *   npm run org -- status
 *   npm run org -- repositories
 *   npm run org -- health
 *   npm run org -- gaps
 *   npm run org -- search "payments"
 *
 * Códigos de saída: 0 ok · 2 uso inválido · 3 erro.
 *
 * O portal **não busca repositório da rede**. Um repositório registrado por URL
 * é listado e não é lido: clonar e ler conteúdo arbitrário a cada coleta é
 * decisão de quem opera, não do portal.
 */

import { collectOrganization, searchOrganization } from '../src/lib/org/service';
import { loadOrganization } from '../src/lib/org/config';
import { SCAN_DEPTH_LABEL } from '../src/lib/org/types';

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

function bar(percentage: number | null, width = 16): string {
	if (percentage === null) return paint('—'.repeat(width), 'dim');
	const filled = Math.round((percentage / 100) * width);
	const color = percentage >= 90 ? 'green' : percentage >= 75 ? 'yellow' : 'red';
	return paint('█'.repeat(filled), color) + paint('░'.repeat(width - filled), 'dim');
}

function limitations(notes: readonly string[]): void {
	if (notes.length === 0) return;
	console.log('');
	console.log(paint('  O que este relatório não sustenta:', 'bold'));
	for (const note of notes) console.log(paint(`    · ${note}`, 'dim'));
}

async function main(): Promise<number> {
	const argv = process.argv.slice(2);
	const json = argv.includes('--json');

	const positional = argv.filter((argument) => !argument.startsWith('--'));
	const command = positional[0] ?? 'status';

	if (command === 'search') {
		const term = positional[1];
		if (!term) {
			console.error('Informe o termo: npm run org -- search "payments"');
			return 2;
		}

		const hits = await searchOrganization(term);

		if (json) {
			console.log(JSON.stringify(hits, null, 2));
			return 0;
		}

		console.log('');
		console.log(`${paint(`${hits.length} ocorrência(s)`, 'bold')}  ${paint(`para "${term}"`, 'dim')}`);
		console.log(paint('Busca literal nos arquivos, não a busca do portal: sem índice, sem ranqueamento.', 'dim'));
		console.log('');

		for (const hit of hits) {
			console.log(`  ${paint(hit.repository.padEnd(18), 'dim')} ${hit.title}`);
			console.log(paint(`      ${hit.path}`, 'dim'));
			console.log(paint(`      …${hit.excerpt}…`, 'dim'));
		}

		console.log('');
		return 0;
	}

	if (command === 'repositories') {
		const config = await loadOrganization();

		if (json) {
			console.log(JSON.stringify(config, null, 2));
			return 0;
		}

		console.log('');
		console.log(`${paint(config.label, 'bold')}  ${paint(`${config.repositories.length} repositório(s) registrado(s)`, 'dim')}`);
		console.log('');

		for (const repository of config.repositories) {
			console.log(`  ${repository.id.padEnd(24)} ${paint(repository.product ?? '—', 'dim')}`);
			console.log(paint(`      ${repository.path ?? repository.url ?? 'sem caminho nem URL'}`, 'dim'));
			if (repository.visibleTo?.length) console.log(paint(`      visível para: ${repository.visibleTo.join(', ')}`, 'dim'));
		}

		if (config.repositories.length === 0) {
			console.log(paint('  Nenhum. Crie `organization.yml` para registrar repositórios.', 'dim'));
		}

		console.log('');
		return 0;
	}

	if (!['status', 'health', 'gaps'].includes(command)) {
		console.error(`Subcomando desconhecido: ${command}`);
		console.error('Use: status, repositories, health, gaps, search <termo>.');
		return 2;
	}

	const report = await collectOrganization();

	if (json) {
		console.log(JSON.stringify(report, null, 2));
		return 0;
	}

	console.log('');
	console.log(`${paint(report.organization, 'bold')}  ${paint(`${report.totals.repositories} repositório(s) · ${report.totals.pages} página(s)`, 'dim')}`);
	console.log('');

	for (const repository of report.repositories) {
		const health = repository.health === null ? paint('  — ', 'dim') : `${String(repository.health).padStart(3)} `;
		console.log(`  ${repository.id.padEnd(22)} ${bar(repository.health)} ${health} ${paint(SCAN_DEPTH_LABEL[repository.depth], 'dim')}`);

		if (command === 'status') {
			console.log(
				paint(
					`      ${repository.pages} página(s) · ${repository.owned} com dono${repository.brokenLinks > 0 ? ` · ${repository.brokenLinks} link(s) quebrado(s)` : ''}${repository.gaps !== null ? ` · ${repository.gaps} lacuna(s)` : ''}`,
					'dim'
				)
			);
			if (repository.reason) console.log(paint(`      ${repository.reason}`, 'dim'));
		}
	}

	if (report.products.length > 0) {
		console.log('');
		console.log(paint('  Por produto', 'bold'));
		for (const product of report.products) {
			const health = product.health === null ? paint('  — ', 'dim') : `${String(product.health).padStart(3)} `;
			console.log(`    ${product.label.padEnd(20)} ${bar(product.health)} ${health} ${paint(`${product.repositories.length} repo(s)`, 'dim')}`);
		}
	}

	console.log('');
	console.log(
		`  ${paint('Organização', 'bold').padEnd(22)} ${bar(report.health)} ${report.health === null ? paint('  — não medido', 'dim') : report.health}`
	);
	console.log(`  Cobertura de dono      ${report.totals.ownership === null ? '—' : `${report.totals.ownership}%`}`);

	if (command === 'gaps') {
		const cross = report.repositories.flatMap((repository) =>
			repository.crossReferences.filter((reference) => !reference.resolved)
		);

		if (cross.length > 0) {
			console.log('');
			console.log(paint(`  ${cross.length} referência(s) cruzada(s) sem repositório registrado`, 'bold'));
			for (const reference of cross.slice(0, 15)) {
				console.log(paint(`    ${reference.from} → repo://${reference.repository}/${reference.to}`, 'dim'));
			}
		}
	}

	limitations(report.limitations);

	console.log('');
	console.log(
		paint(
			'  Repositório lido só pelos arquivos fica fora da média: contá-lo como zero faria registrar um repositório baixar a nota da organização.',
			'dim'
		)
	);
	console.log('');

	return 0;
}

main()
	.then((code) => {
		process.exitCode = code;
	})
	.catch((error) => {
		console.error('Falha ao montar o relatório da organização:', error);
		process.exitCode = 3;
	});
