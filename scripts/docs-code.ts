/**
 * CLI do Documentation-to-Code Loop (P2.2 — § CLI).
 *
 *   npm run docs:code -- impact
 *   npm run docs:code -- impact --diff HEAD~1..HEAD
 *   npm run docs:code -- check-coverage
 *   npm run docs:code -- bindings
 *   npm run docs:code -- orphans
 *   npm run docs:code -- undocumented
 *   npm run docs:code -- consistency
 *   npm run docs:code -- release --from v1.0
 *   npm run docs:code -- tasks
 *
 * Códigos de saída: 0 ok · 1 política violada · 2 uso inválido · 3 erro.
 *
 * **Nenhum comando aqui altera código.** Eles leem o repositório e escrevem
 * relatório; o que produz alteração de conteúdo é o Agent Orchestrator, com
 * workspace isolado e aprovação humana.
 */

import { documentationImpact, loadPolicy } from '../src/lib/codeloop/service';
import { ENTITY_LABEL } from '../src/lib/codeloop/types';
import { tasksFromImpact } from '../src/lib/codeloop/tasks';

const EXIT_OK = 0;
const EXIT_BLOCKED = 1;
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

function value(argv: string[], flag: string): string | undefined {
	const index = argv.indexOf(flag);
	return index >= 0 ? argv[index + 1] : undefined;
}

function bar(percentage: number | null, width = 20): string {
	if (percentage === null) return paint('—'.repeat(width), 'dim');
	const filled = Math.round((percentage / 100) * width);
	const color = percentage >= 95 ? 'green' : percentage >= 80 ? 'yellow' : 'red';
	return paint('█'.repeat(filled), color) + paint('░'.repeat(width - filled), 'dim');
}

async function main(): Promise<number> {
	const argv = process.argv.slice(2);
	const command = argv.find((argument) => !argument.startsWith('--')) ?? 'impact';
	const json = argv.includes('--json');

	if (command === 'bindings') {
		const bindings = await documentationImpact.getBindings();

		if (json) {
			console.log(JSON.stringify(bindings, null, 2));
			return EXIT_OK;
		}

		console.log('');
		console.log(paint(`${bindings.length} vínculo(s) declarado(s)`, 'bold'));
		console.log(
			paint('O vínculo vive no frontmatter da documentação, nunca no código: o produto não depende de Markdown.', 'dim')
		);
		console.log('');

		for (const binding of bindings) {
			const mark = binding.resolved ? paint('✓', 'green') : paint('✗', 'red');
			console.log(`  ${mark} ${ENTITY_LABEL[binding.entityType].padEnd(14)} ${binding.entityId}`);
			console.log(paint(`      ${binding.documentationId}${binding.required ? ' · obrigatório' : ''}`, 'dim'));
			if (!binding.resolved) console.log(paint(`      ${binding.reason}`, 'red'));
		}

		if (bindings.length === 0) {
			console.log(paint('  Nenhuma página declara vínculo ainda. Exemplo de frontmatter:', 'dim'));
			console.log(paint('    documentation:\n      bindings:\n        - type: api\n          id: POST /api/payments', 'dim'));
		}

		console.log('');
		return EXIT_OK;
	}

	if (command === 'orphans') {
		const orphans = await documentationImpact.findOrphans();

		if (json) {
			console.log(JSON.stringify(orphans, null, 2));
			return EXIT_OK;
		}

		console.log('');
		console.log(paint(`${orphans.length} vínculo(s) sem entidade correspondente`, 'bold'));
		console.log(paint('Potencialmente órfãos: a página pode documentar histórico, versão anterior ou algo planejado.', 'dim'));
		console.log('');

		for (const orphan of orphans) {
			console.log(`  ${paint('⚠', 'yellow')} ${orphan.documentationId}`);
			console.log(paint(`      aponta para ${orphan.entityId} (${ENTITY_LABEL[orphan.entityType]})`, 'dim'));
		}

		console.log('');
		return EXIT_OK;
	}

	if (command === 'undocumented') {
		const entities = await documentationImpact.findUndocumented();

		if (json) {
			console.log(JSON.stringify(entities, null, 2));
			return EXIT_OK;
		}

		console.log('');
		console.log(paint(`${entities.length} entidade(s) pública(s) sem vínculo declarado`, 'bold'));
		console.log(
			paint(
				'Vínculo declarado, não menção em texto: uma frase citando o endpoint não é documentação dele.',
				'dim'
			)
		);
		console.log('');

		for (const entity of entities) {
			const mark = entity.required ? paint('✗', 'red') : paint('⚠', 'yellow');
			console.log(`  ${mark} ${entity.entityId}${entity.required ? paint(' (obrigatório)', 'red') : ''}`);
			console.log(paint(`      ${entity.evidence.join(' · ')}`, 'dim'));
		}

		console.log('');
		return entities.some((entity) => entity.required) ? EXIT_BLOCKED : EXIT_OK;
	}

	if (command === 'consistency') {
		const report = await documentationImpact.consistency();

		if (json) {
			console.log(JSON.stringify(report, null, 2));
			return EXIT_OK;
		}

		console.log('');
		console.log(paint('Consistência entre código e documentação', 'bold'));
		console.log('');

		for (const slice of report.slices) {
			const label = slice.percentage === null ? ' — ' : `${String(slice.percentage).padStart(3)}%`;
			console.log(
				`  ${slice.name.padEnd(14)} ${bar(slice.percentage)} ${label}  ${paint(`${slice.consistent}/${slice.total}`, 'dim')}`
			);
		}

		console.log('');
		console.log(`  ${paint('Geral', 'bold').padEnd(14)} ${bar(report.overall)} ${report.overall ?? '—'}%`);
		console.log('');
		console.log(paint('  Fatia sem vínculo declarado aparece como "—", não como 0%: ausência de dado não é inconsistência.', 'dim'));
		console.log('');
		return EXIT_OK;
	}

	if (command === 'release') {
		const from = value(argv, '--from');
		if (!from) {
			console.error('Informe a referência inicial: npm run docs:code -- release --from v1.0');
			return EXIT_BAD_USAGE;
		}

		const [coverage, policy] = await Promise.all([
			documentationImpact.releaseCoverage(from, value(argv, '--to') ?? 'HEAD'),
			loadPolicy(),
		]);

		if (json) {
			console.log(JSON.stringify(coverage, null, 2));
			return coverage.overall !== null && coverage.overall < policy.releaseMinimumCoverage ? EXIT_BLOCKED : EXIT_OK;
		}

		console.log('');
		console.log(paint('Cobertura documental da release', 'bold'));
		console.log('');

		for (const slice of coverage.slices) {
			const label = slice.percentage === null ? ' — ' : `${String(slice.percentage).padStart(3)}%`;
			console.log(`  ${slice.name.padEnd(18)} ${bar(slice.percentage)} ${label}  ${paint(`${slice.consistent}/${slice.total}`, 'dim')}`);
		}

		console.log('');
		console.log(`  ${paint('Geral', 'bold').padEnd(18)} ${bar(coverage.overall)} ${coverage.overall ?? '—'}%`);
		console.log(
			paint(
				`  ${coverage.summary.changed} entidade(s) alterada(s) · ${coverage.summary.documented} documentada(s) · ${coverage.summary.missing} sem documentação`,
				'dim'
			)
		);
		console.log('');

		return coverage.overall !== null && coverage.overall < policy.releaseMinimumCoverage ? EXIT_BLOCKED : EXIT_OK;
	}

	if (command === 'tasks') {
		const report = await documentationImpact.analyze(value(argv, '--diff') ?? 'HEAD');
		const proposals = tasksFromImpact(report.impact, report.policy.requiredFor);

		if (json) {
			console.log(JSON.stringify(proposals, null, 2));
			return EXIT_OK;
		}

		console.log('');
		console.log(paint(`${proposals.length} tarefa(s) de documentação propostas`, 'bold'));
		console.log(
			paint('Propostas, não executadas: quem escreve é o Agent Orchestrator, em workspace isolado e com aprovação humana.', 'dim')
		);
		console.log('');

		for (const proposal of proposals) {
			console.log(
				`  ${paint(proposal.priority === 'alta' ? '●' : '○', proposal.priority === 'alta' ? 'red' : 'yellow')} ${proposal.type.padEnd(7)} ${proposal.target ?? proposal.context?.productNodes?.join(', ') ?? ''}`
			);
			console.log(paint(`      ${proposal.rationale}`, 'dim'));
		}

		if (proposals.length > 0) {
			console.log('');
			console.log(paint('  Para executar uma delas: npm run agent -- run --task <id>', 'dim'));
		}

		console.log('');
		return EXIT_OK;
	}

	if (command !== 'impact' && command !== 'check-coverage') {
		console.error(`Subcomando desconhecido: ${command}`);
		console.error('Use: impact, check-coverage, bindings, orphans, undocumented, consistency, tasks, release --from <ref>.');
		return EXIT_BAD_USAGE;
	}

	const range = value(argv, '--diff') ?? 'HEAD';
	const report = await documentationImpact.analyze(range);

	if (json) {
		console.log(JSON.stringify(report, null, 2));
		return report.blocked ? EXIT_BLOCKED : EXIT_OK;
	}

	if (command === 'check-coverage') {
		console.log('');
		console.log(
			`${paint('Cobertura documental da mudança', 'bold')}  ${report.impact.coverage}%  ${paint(`(${report.impact.missingDocumentation.length} sem documentação)`, 'dim')}`
		);
		console.log('');
		console.log(report.blocked ? paint('  ❌ Política violada', 'red') : paint('  ✓ Política atendida', 'green'));
		console.log('');
		return report.blocked ? EXIT_BLOCKED : EXIT_OK;
	}

	console.log('');
	console.log(`${paint('Impacto documental', 'bold')}  ${paint(range, 'dim')}`);
	console.log('');

	if (report.impact.affectedEntities.length === 0) {
		console.log(paint('  Nenhuma entidade do produto foi tocada por esta mudança.', 'dim'));
		console.log('');
		return EXIT_OK;
	}

	console.log(paint('  Entidades alteradas', 'bold'));
	for (const entity of report.impact.affectedEntities) {
		const mark = entity.pages.length === 0 ? paint('✗', 'red') : paint('✓', 'green');
		console.log(`    ${mark} ${entity.entityId}  ${paint(entity.detail, 'dim')}`);
		if (entity.pages.length > 0) console.log(paint(`        ${entity.pages.join(', ')}`, 'dim'));
	}

	if (report.impact.affectedPages.length > 0) {
		console.log('');
		console.log(paint('  Páginas afetadas', 'bold'));
		for (const page of report.impact.affectedPages) {
			console.log(`    ${page.stale ? paint('⚠', 'yellow') : paint('✓', 'green')} ${page.path}`);
			if (page.stale) console.log(paint('        não foi atualizada nesta mudança', 'dim'));
		}
	}

	if (report.violations.length > 0) {
		console.log('');
		console.log(paint('  Política', 'bold'));
		for (const violation of report.violations) {
			const mark = violation.severity === 'error' ? paint('✗', 'red') : paint('⚠', 'yellow');
			console.log(`    ${mark} ${violation.message}`);
			console.log(paint(`        regra: ${violation.rule}`, 'dim'));
		}
	}

	console.log('');
	console.log(
		`  Cobertura da mudança: ${report.impact.coverage}%  ${report.blocked ? paint('— merge bloqueado', 'red') : ''}`
	);
	console.log('');

	return report.blocked ? EXIT_BLOCKED : EXIT_OK;
}

main()
	.then((code) => {
		process.exitCode = code;
	})
	.catch((error) => {
		console.error('Falha ao analisar o impacto documental:', error);
		process.exitCode = EXIT_RUNTIME_ERROR;
	});
