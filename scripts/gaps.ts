/**
 * CLI do Gap Mining (§28).
 *
 *   npm run gaps -- analyze          descobre e prioriza
 *   npm run gaps -- list --p0        filtra por prioridade, status ou categoria
 *   npm run gaps -- show <id>        o dossiê de um gap
 *   npm run gaps -- start <id>       marca em andamento e registra a linha de base
 *   npm run gaps -- resolve <id>     só resolve se o sinal tiver caído
 *
 * Códigos de saída: 0 ok · 1 há gap P0 · 2 uso inválido · 3 erro de execução.
 *
 * `resolve` pode **recusar**. Publicar uma página não é evidência de que o gap
 * sumiu — a evidência é o sinal cair, e é isso que o comando confere.
 */

import { analyzeDocumentationGaps, documentationGaps } from '../src/lib/gaps/service';
import { ACTION_LABEL, CATEGORY_LABEL, STATUS_LABEL, type GapPriority } from '../src/lib/gaps/types';

const EXIT_OK = 0;
const EXIT_P0 = 1;
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

const PRIORITY_COLOR: Record<GapPriority, keyof typeof COLORS> = {
	P0: 'red',
	P1: 'yellow',
	P2: 'dim',
	P3: 'dim',
};

async function main(): Promise<number> {
	const argv = process.argv.slice(2);
	const command = argv[0] ?? 'analyze';
	const json = argv.includes('--json');
	const actor = process.env.USER ?? process.env.USERNAME ?? 'cli';

	if (['analyze', 'list'].includes(command)) {
		const report = await analyzeDocumentationGaps();

		const priority = (['P0', 'P1', 'P2', 'P3'] as const).find((level) => argv.includes(`--${level.toLowerCase()}`));
		const gaps = priority ? report.gaps.filter((gap) => gap.priority === priority) : report.gaps;

		if (json) {
			console.log(JSON.stringify({ ...report, gaps }, null, 2));
			return report.counts.P0 > 0 ? EXIT_P0 : EXIT_OK;
		}

		console.log('');
		console.log(paint('Documentation Gaps', 'bold'));

		if (report.limited) {
			console.log(
				paint(
					'O texto das perguntas não está sendo guardado, então a análise usa só os sinais estruturais\n(endpoint sem página, contrato quebrado, voto negativo). Ligue\n`documentation.analytics.storeUnansweredQuestions` em `health.yml` para incluir as perguntas.',
					'dim'
				)
			);
		}

		console.log('');
		console.log(
			(['P0', 'P1', 'P2', 'P3'] as const)
				.map((level) => paint(`${level} ${report.counts[level]}`, PRIORITY_COLOR[level]))
				.join('   ')
		);
		console.log('');

		for (const gap of gaps.slice(0, 25)) {
			console.log(
				`${paint(gap.priority, PRIORITY_COLOR[gap.priority])} ${paint(String(gap.score.value).padStart(3), 'bold')}  ${gap.query}`
			);
			console.log(
				paint(
					`      ${CATEGORY_LABEL[gap.category]} · cobertura ${gap.coverage}% · ${gap.frequency} consulta(s) · ${STATUS_LABEL[gap.status]}`,
					'dim'
				)
			);
			console.log(paint(`      → ${ACTION_LABEL[gap.recommendation.action]}${gap.recommendation.target ? `: ${gap.recommendation.target}` : ''}`, 'dim'));
		}

		console.log('');
		return report.counts.P0 > 0 ? EXIT_P0 : EXIT_OK;
	}

	const id = argv[1];
	if (!id || id.startsWith('--')) {
		console.error(`Informe o id: npm run gaps -- ${command} <id>`);
		return EXIT_BAD_USAGE;
	}

	if (command === 'show') {
		const gap = await documentationGaps.get(id);
		if (!gap) {
			console.error(`Gap não encontrado: ${id}`);
			return EXIT_BAD_USAGE;
		}

		if (json) {
			console.log(JSON.stringify(gap, null, 2));
			return EXIT_OK;
		}

		console.log('');
		console.log(`${paint(gap.query, 'bold')}  ${paint(gap.id, 'dim')}`);
		console.log('');
		console.log(`  Prioridade      ${paint(gap.priority, PRIORITY_COLOR[gap.priority])}  (score ${gap.score.value})`);
		console.log(`  Tipo            ${CATEGORY_LABEL[gap.category]}`);
		console.log(`  Estado          ${STATUS_LABEL[gap.status]}`);
		console.log(`  Cobertura       ${gap.coverage}%`);
		console.log('');
		console.log(paint('  Evidência', 'bold'));
		console.log(`    ${gap.evidence.searches} busca(s) · ${gap.evidence.aiQuestions} pergunta(s) ao assistente · ${gap.evidence.aiFailures} sem lastro`);
		console.log(`    ${gap.evidence.mcpQueries} consulta(s) por MCP · ${gap.evidence.negativeFeedback} voto(s) negativo(s) · ${gap.evidence.brokenContracts} contrato(s) quebrado(s)`);
		console.log('');
		console.log(paint('  Como o score foi calculado', 'bold'));
		for (const factor of gap.score.factors) {
			console.log(paint(`    +${String(factor.points).padStart(3)}  ${factor.name} (${factor.detail})`, 'dim'));
		}

		if (gap.variants.length > 1) {
			console.log('');
			console.log(paint('  Perguntas agrupadas', 'bold'));
			for (const variant of gap.variants.slice(0, 8)) console.log(paint(`    ${variant}`, 'dim'));
		}

		if (gap.relatedContent.length > 0) {
			console.log('');
			console.log(paint('  Conteúdo relacionado', 'bold'));
			for (const path of gap.relatedContent) console.log(paint(`    ${path}`, 'dim'));
		}

		console.log('');
		console.log(paint('  Recomendação', 'bold'));
		console.log(`    ${ACTION_LABEL[gap.recommendation.action]}${gap.recommendation.target ? `: ${gap.recommendation.target}` : ''}`);
		console.log(paint(`    ${gap.recommendation.reason}`, 'dim'));
		for (const step of gap.recommendation.outline) console.log(paint(`      ${step}`, 'dim'));
		console.log('');

		return EXIT_OK;
	}

	if (command === 'acknowledge') {
		await documentationGaps.acknowledge(id, actor);
		console.log(`Gap ${id} reconhecido.`);
		return EXIT_OK;
	}

	if (command === 'start') {
		await documentationGaps.start(id, actor);
		console.log(`Gap ${id} em andamento. O sinal atual virou linha de base para medir a resolução.`);
		return EXIT_OK;
	}

	if (command === 'resolve') {
		const result = await documentationGaps.resolve(id, actor);
		console.log(result.resolved ? paint(`Gap ${id} resolvido.`, 'green') : paint(`Gap ${id} **não** foi resolvido.`, 'yellow'));
		console.log(result.reason);
		return EXIT_OK;
	}

	if (command === 'dismiss') {
		await documentationGaps.dismiss(id, actor);
		console.log(`Gap ${id} descartado.`);
		return EXIT_OK;
	}

	console.error(`Subcomando desconhecido: ${command}`);
	console.error('Use: analyze, list, show <id>, acknowledge <id>, start <id>, resolve <id>, dismiss <id>.');
	return EXIT_BAD_USAGE;
}

main()
	.then((code) => {
		process.exitCode = code;
	})
	.catch((error) => {
		console.error('Falha ao analisar as lacunas:', error);
		process.exitCode = EXIT_RUNTIME_ERROR;
	});
