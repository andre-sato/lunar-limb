/**
 * CLI do Digital Twin (§20, §21).
 *
 *   npm run twin -- analyze              resumo do grafo derivado
 *   npm run twin -- coverage             cobertura documental
 *   npm run twin -- coverage --min 90    falha quando abaixo do mínimo (CI)
 *   npm run twin -- undocumented         implementação sem documentação
 *   npm run twin -- stale                documentação sem implementação
 *   npm run twin -- impact <nó>          o que muda se este nó mudar
 *   npm run twin -- ask "..."            pergunta em linguagem natural
 *
 * Qualquer subcomando aceita `--json`.
 *
 * Códigos de saída: 0 tudo certo · 1 limite de cobertura violado · 2 uso
 * inválido · 3 erro de execução.
 */

import { computeCoverage, findPotentiallyStale, findUndocumented, findVersionGaps, analyzeTwinImpact } from '../src/lib/twin/analysis';
import { getTwin } from '../src/lib/twin/load';
import { answerTwinQuery, digitalTwin } from '../src/lib/twin/service';
import { TWIN_NODE_LABEL, type CoverageSlice } from '../src/lib/twin/types';

const EXIT_OK = 0;
const EXIT_THRESHOLD = 1;
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

function bar(value: number | null, width = 20): string {
	if (value === null) return paint('—'.repeat(width), 'dim');
	const filled = Math.round((value / 100) * width);
	const color = value >= 90 ? 'green' : value >= 70 ? 'yellow' : 'red';
	return paint('█'.repeat(filled), color) + paint('░'.repeat(width - filled), 'dim');
}

function line(label: string, entry: CoverageSlice): string {
	const value = entry.percentage === null ? ' — ' : `${String(entry.percentage).padStart(3)}%`;
	return `  ${label.padEnd(12)} ${bar(entry.percentage)} ${value}  ${paint(`${entry.documented}/${entry.total}`, 'dim')}`;
}

async function main(): Promise<number> {
	const argv = process.argv.slice(2);
	const command = argv[0] ?? 'analyze';
	const json = argv.includes('--json');

	const minimumIndex = argv.indexOf('--min');
	const minimum = minimumIndex >= 0 ? Number.parseFloat(argv[minimumIndex + 1]) : undefined;

	if (command === 'analyze') {
		const summary = await digitalTwin.getSummary();
		if (json) {
			console.log(JSON.stringify(summary, null, 2));
			return EXIT_OK;
		}

		console.log('');
		console.log(paint('Documentation Digital Twin', 'bold'));
		console.log('');
		for (const [type, count] of Object.entries(summary.nodes).sort((a, b) => b[1] - a[1])) {
			console.log(`  ${String(count).padStart(4)}  ${TWIN_NODE_LABEL[type as keyof typeof TWIN_NODE_LABEL] ?? type}`);
		}
		console.log(paint(`  ${summary.edges} relações`, 'dim'));
		console.log('');
		console.log(line('Endpoints', summary.coverage.endpoints));
		console.log(line('Schemas', summary.coverage.schemas));
		console.log(line('Exemplos', summary.coverage.examples));
		console.log(line('Domínios', summary.coverage.features));
		console.log('');
		console.log(`  ${summary.undocumented.length} sem documentação · ${summary.stale.length} potencialmente obsoleta(s)`);
		console.log('');
		return EXIT_OK;
	}

	if (command === 'coverage') {
		const coverage = computeCoverage((await getTwin()).graph);

		if (json) console.log(JSON.stringify(coverage, null, 2));
		else {
			console.log('');
			console.log(paint('Documentation Coverage', 'bold'));
			console.log('');
			console.log(line('Endpoints', coverage.endpoints));
			console.log(line('Schemas', coverage.schemas));
			console.log(line('Exemplos', coverage.examples));
			console.log(line('Domínios', coverage.features));
			console.log('');
			console.log(`  ${paint('Geral', 'bold')}        ${bar(coverage.overall)} ${coverage.overall ?? '—'}%`);

			if (coverage.byDomain.length > 0) {
				console.log('');
				console.log(paint('Por domínio', 'bold'));
				for (const domain of coverage.byDomain) {
					const mark = domain.percentage < 70 ? paint('🔴', 'red') : domain.percentage < 90 ? '🟡' : '🟢';
					console.log(`  ${mark} ${domain.domain.padEnd(18)} ${String(domain.percentage).padStart(3)}%  ${paint(`${domain.documented}/${domain.total}`, 'dim')}`);
				}
			}
			console.log('');
		}

		// O limite de CI olha a cobertura de endpoints, não a média: a média dilui
		// justamente o número que a §21 quer proteger, e um portal pode passar no
		// agregado com metade dos endpoints sem página.
		if (minimum !== undefined && Number.isFinite(minimum)) {
			const current = coverage.endpoints.percentage;
			if (current === null) {
				console.log(paint('Sem endpoints para medir; limite não aplicado.', 'dim'));
				return EXIT_OK;
			}
			if (current < minimum) {
				console.log(paint(`🔴 Cobertura de endpoints ${current}% abaixo do mínimo de ${minimum}%`, 'red'));
				return EXIT_THRESHOLD;
			}
			console.log(paint(`Cobertura de endpoints ${current}% (mínimo ${minimum}%)`, 'green'));
		}

		return EXIT_OK;
	}

	if (command === 'undocumented') {
		const items = findUndocumented((await getTwin()).graph);
		if (json) console.log(JSON.stringify(items, null, 2));
		else {
			console.log('');
			console.log(paint(`${items.length} endpoint(s) sem documentação`, 'bold'));
			for (const item of items) {
				console.log(`  ${paint('⚠', 'yellow')} ${item.node.name}`);
				console.log(paint(`      ${item.evidence.join(' · ') || 'sem evidência adicional'}`, 'dim'));
			}
			console.log('');
		}
		return EXIT_OK;
	}

	if (command === 'stale') {
		const { graph, references } = await getTwin();
		const items = findPotentiallyStale(graph, references);
		const versionGaps = findVersionGaps(graph);

		if (json) console.log(JSON.stringify({ stale: items, versionGaps }, null, 2));
		else {
			console.log('');
			console.log(paint(`${items.length} referência(s) potencialmente obsoleta(s)`, 'bold'));
			console.log(paint('Potencialmente: a página pode documentar histórico, versão anterior ou algo planejado.', 'dim'));
			console.log('');
			for (const item of items) {
				console.log(`  ${paint('⚠', 'yellow')} ${item.node.source ?? item.node.name}`);
				console.log(paint(`      cita ${item.reference}, que não existe em nenhuma fonte`, 'dim'));
			}
			console.log('');
		}
		return EXIT_OK;
	}

	if (command === 'impact') {
		const target = argv[1];
		if (!target || target.startsWith('--')) {
			console.error('Informe o nó: npm run twin -- impact "endpoint:GET /api/auth/me"');
			return EXIT_BAD_USAGE;
		}

		const impact = analyzeTwinImpact((await getTwin()).graph, target);
		if (!impact) {
			console.error(`Nó não encontrado: ${target}`);
			return EXIT_BAD_USAGE;
		}

		if (json) console.log(JSON.stringify(impact, null, 2));
		else {
			console.log('');
			console.log(`${paint('Impacto de', 'bold')} ${impact.node.name}`);
			console.log('');
			for (const [type, count] of Object.entries(impact.byType)) {
				console.log(`  ${String(count).padStart(3)}  ${TWIN_NODE_LABEL[type as keyof typeof TWIN_NODE_LABEL] ?? type}`);
			}
			console.log('');
			for (const item of impact.affected.slice(0, 20)) {
				console.log(`  ${item.node.source ?? item.node.id} ${paint(`(${item.distance} salto(s))`, 'dim')}`);
			}
			console.log('');
		}
		return EXIT_OK;
	}

	if (command === 'ask') {
		const question = argv.slice(1).filter((argument) => !argument.startsWith('--')).join(' ');
		if (question === '') {
			console.error('Informe a pergunta: npm run twin -- ask "quais APIs não estão documentadas?"');
			return EXIT_BAD_USAGE;
		}

		const answer = await answerTwinQuery(question);
		if (!answer) {
			console.error('Não entendi a pergunta. Sei responder sobre: endpoints não documentados, documentação obsoleta, cobertura, e onde um endpoint está documentado.');
			return EXIT_BAD_USAGE;
		}

		if (json) console.log(JSON.stringify(answer, null, 2));
		else {
			console.log('');
			console.log(paint(answer.summary, 'bold'));
			for (const item of answer.items.slice(0, 20)) {
				console.log(`  ${item.label}${item.detail ? paint(` — ${item.detail}`, 'dim') : ''}`);
			}
			console.log('');
		}
		return EXIT_OK;
	}

	console.error(`Subcomando desconhecido: ${command}`);
	console.error('Use: analyze, coverage, undocumented, stale, impact <nó>, ask "pergunta".');
	return EXIT_BAD_USAGE;
}

main()
	.then((code) => {
		process.exitCode = code;
	})
	.catch((error) => {
		console.error('Falha ao analisar o Digital Twin:', error);
		process.exitCode = EXIT_RUNTIME_ERROR;
	});
