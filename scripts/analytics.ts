/**
 * CLI de Documentation Observability (P3.2 — § CLI).
 *
 *   npm run analytics -- overview
 *   npm run analytics -- search
 *   npm run analytics -- agents
 *   npm run analytics -- journeys
 *   npm run analytics -- gaps
 *   npm run analytics -- forget
 *
 * Códigos de saída: 0 ok · 2 uso inválido · 3 erro.
 *
 * Toda saída daqui é agregada. Uma linha só aparece quando tem sessões
 * suficientes — abaixo do limiar, "quem leu esta página" pode ser uma pessoa
 * identificável para quem conhece a equipe.
 */

import { collectObservability } from '../src/lib/observe/service';
import { loadObservabilityConfig } from '../src/lib/observe/config';
import { forgetObservations } from '../src/lib/observe/store';
import { userSuccessScore } from '../src/lib/observe/analyze';

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

function percent(value: number | null): string {
	return value === null ? paint(' — ', 'dim') : `${String(value).padStart(3)}%`;
}

function limitations(report: { limited: boolean; limitations: string[] }): void {
	if (!report.limited) return;
	console.log('');
	console.log(paint('  O que este relatório não sustenta:', 'bold'));
	for (const note of report.limitations) console.log(paint(`    · ${note}`, 'dim'));
}

async function main(): Promise<number> {
	const argv = process.argv.slice(2);
	const command = argv.find((argument) => !argument.startsWith('--')) ?? 'overview';
	const json = argv.includes('--json');

	const windowIndex = argv.indexOf('--days');
	const windowDays = windowIndex >= 0 ? Number(argv[windowIndex + 1]) || undefined : undefined;

	if (command === 'forget') {
		if (!argv.includes('--yes')) {
			console.error('Isto apaga todos os eventos observados. Repita com --yes para confirmar.');
			return 2;
		}
		await forgetObservations();
		console.log('Eventos apagados.');
		return 0;
	}

	if (!['overview', 'search', 'journeys', 'gaps', 'agents'].includes(command)) {
		console.error(`Subcomando desconhecido: ${command}`);
		console.error('Use: overview, search, journeys, gaps, agents, forget --yes.');
		return 2;
	}

	const [report, config] = await Promise.all([collectObservability(windowDays), loadObservabilityConfig()]);

	if (json) {
		console.log(JSON.stringify(report, null, 2));
		return 0;
	}

	if (command === 'agents') {
		const { agents } = report;

		console.log('');
		console.log(`${paint('Leitura por agentes', 'bold')}  ${paint(`últimos ${report.windowDays} dias`, 'dim')}`);
		console.log(
			paint(
				'Contada no servidor, pelas próprias rotas: agentes não executam JavaScript, então nenhum beacon dispara para eles.',
				'dim'
			)
		);
		console.log('');
		console.log(`  Leituras               ${agents.reads}`);
		console.log(
			`  Fatia da leitura       ${agents.share === null ? paint('—', 'dim') : `${Math.round(agents.share * 100)}%`}`
		);

		if (agents.bySurface.length > 0) {
			console.log('');
			console.log(paint('  Por superfície', 'bold'));
			for (const entry of agents.bySurface) {
				console.log(`    ${entry.label.padEnd(18)} ${entry.reads}`);
			}
		}

		if (agents.topPaths.length > 0) {
			console.log('');
			console.log(paint('  Páginas mais buscadas em Markdown bruto', 'bold'));
			for (const entry of agents.topPaths) {
				console.log(`    ${String(entry.reads).padStart(4)}  ${entry.path}`);
			}
		}

		if (agents.reads === 0) {
			console.log('');
			console.log(paint('  Nenhuma leitura por agente na janela.', 'dim'));
		}

		console.log('');
		console.log(
			paint(
				'  A fatia é aproximada: uma pessoa abre uma página por vez, um agente pode levar o corpus inteiro numa requisição.',
				'dim'
			)
		);
		console.log('');
		console.log(
			paint(
				'  O servidor MCP fica de fora — ele lê o repositório direto, sem passar pelo portal.',
				'dim'
			)
		);

		limitations(report);
		console.log('');
		return 0;
	}

	if (command === 'search') {
		const { search } = report;

		console.log('');
		console.log(`${paint('Busca na documentação', 'bold')}  ${paint(`últimos ${report.windowDays} dias`, 'dim')}`);
		console.log('');
		console.log(`  Buscas                 ${search.searches}`);
		console.log(`  Clique em resultado    ${percent(search.clickThroughRate)}  ${paint(`${search.clicked}`, 'dim')}`);
		console.log(`  Sem resultado          ${percent(search.zeroResultRate)}  ${paint(`${search.zeroResult}`, 'dim')}`);
		console.log(`  Refinou a busca        ${percent(search.refinementRate)}  ${paint(`${search.refined}`, 'dim')}`);
		console.log(`  Abandonou              ${percent(search.abandonmentRate)}  ${paint(`${search.abandoned}`, 'dim')}`);
		console.log('');
		console.log(
			paint(
				'  "Clique em resultado" não é sucesso: clicar é o mais longe que a instrumentação enxerga.',
				'dim'
			)
		);

		limitations(report);
		console.log('');
		return 0;
	}

	if (command === 'journeys') {
		console.log('');
		console.log(`${paint('Jornadas', 'bold')}  ${paint(`${report.journeys.length} caminho(s) com volume suficiente`, 'dim')}`);
		console.log('');

		for (const journey of report.journeys.slice(0, 15)) {
			const color = journey.abandonmentRate >= 70 ? 'red' : journey.abandonmentRate >= 40 ? 'yellow' : 'green';
			console.log(`  ${paint(`${String(journey.sessions).padStart(4)}×`, 'dim')} ${journey.steps.join(' → ')}`);
			console.log(paint(`         ${paint(`${journey.abandonmentRate}% sem sinal de conclusão`, color)}`, 'dim'));
		}

		if (report.journeys.length === 0) {
			console.log(paint(`  Nenhuma jornada atingiu ${config.minimumSessions} sessões distintas.`, 'dim'));
		}

		limitations(report);
		console.log('');
		return 0;
	}

	if (command === 'gaps') {
		console.log('');
		console.log(paint(`${report.gaps.length} lacuna(s) sugerida(s) pelo comportamento`, 'bold'));
		console.log(
			paint('Sugeridas, não confirmadas: comportamento é evidência de atrito, não prova de conteúdo faltando.', 'dim')
		);
		console.log('');

		for (const gap of report.gaps) {
			const mark = gap.confidence >= 0.7 ? paint('●', 'red') : gap.confidence >= 0.4 ? paint('●', 'yellow') : paint('○', 'dim');
			console.log(`  ${mark} ${gap.topic}  ${paint(`${Math.round(gap.confidence * 100)}%`, 'dim')}`);
			for (const evidence of gap.evidence) console.log(paint(`      ${evidence}`, 'dim'));
		}

		if (report.gaps.length === 0) console.log(paint('  Nenhuma. Nenhum sinal comportamental atingiu o limiar.', 'dim'));

		limitations(report);
		console.log('');
		return 0;
	}

	const success = userSuccessScore(report);

	console.log('');
	console.log(`${paint('Observabilidade da documentação', 'bold')}  ${paint(`últimos ${report.windowDays} dias`, 'dim')}`);
	console.log('');
	console.log(`  Sessões                ${report.sessions}`);
	console.log(`  Buscas                 ${report.search.searches}`);
	console.log(`  Páginas com volume     ${report.pages.length}`);
	console.log(
		`  Sucesso do leitor      ${success === null ? paint('— sem volume para medir', 'dim') : `${success}/100`}`
	);

	if (report.pages.length > 0) {
		console.log('');
		console.log(paint('  Mais lidas', 'bold'));
		for (const page of report.pages.slice(0, 10)) {
			const dwell = page.medianDwellSeconds === null ? '—' : `${page.medianDwellSeconds}s`;
			console.log(`    ${String(page.views).padStart(5)}  ${page.path}`);
			console.log(paint(`           ${page.readers} sessões · mediana ${dwell} · ${page.up}↑ ${page.down}↓`, 'dim'));
		}
	}

	if (report.gaps.length > 0) {
		console.log('');
		console.log(paint(`  ${report.gaps.length} lacuna(s) sugerida(s) pelo comportamento`, 'bold'));
		for (const gap of report.gaps.slice(0, 5)) {
			console.log(`    ${gap.topic}  ${paint(`${Math.round(gap.confidence * 100)}%`, 'dim')}`);
		}
	}

	limitations(report);

	console.log('');
	console.log(
		paint(
			`  Nada aqui identifica uma pessoa: sem IP, sem id de usuário, sem cookie. Linha só aparece com ${config.minimumSessions}+ sessões.`,
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
		console.error('Falha ao montar o relatório de observabilidade:', error);
		process.exitCode = 3;
	});
