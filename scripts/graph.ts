/**
 * CLI do Knowledge Graph (P3.4 — § CLI).
 *
 *   npm run graph -- status
 *   npm run graph -- query "payments"
 *   npm run graph -- impact "endpoint:GET /api/auth/me"
 *   npm run graph -- rebuild
 *
 * Códigos de saída: 0 ok · 2 uso inválido · 3 erro.
 *
 * O grafo é **derivado**. Se ele discordar do repositório, quem está errado é o
 * grafo — nada aqui é editável, e nenhum comando escreve.
 */

import { knowledgeGraph } from '../src/lib/graph/service';
import { FRESHNESS_LABEL, KNOWLEDGE_NODE_LABEL, RELATION_LABEL } from '../src/lib/graph/types';

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

async function main(): Promise<number> {
	const argv = process.argv.slice(2);
	const json = argv.includes('--json');

	const positional = argv.filter((argument, index) => {
		if (argument.startsWith('--')) return false;
		return !argv[index - 1]?.startsWith('--') || argv[index - 1] === '--json';
	});

	const command = positional[0] ?? 'status';
	const argument = positional[1];

	if (command === 'status' || command === 'rebuild') {
		const status = command === 'rebuild' ? await knowledgeGraph.rebuild() : await knowledgeGraph.status();

		if (json) {
			console.log(JSON.stringify(status, null, 2));
			return 0;
		}

		const color = status.freshness === 'fresh' ? 'green' : status.freshness === 'failed' ? 'red' : 'yellow';

		console.log('');
		console.log(
			`${paint('Knowledge Graph', 'bold')}  ${paint(FRESHNESS_LABEL[status.freshness], color)}  ${paint(status.ageSeconds === null ? '' : `${status.ageSeconds}s atrás`, 'dim')}`
		);
		console.log('');
		console.log(`  ${status.counts.total.nodes} nós · ${status.counts.total.edges} arestas`);
		console.log('');

		for (const [type, count] of Object.entries(status.counts.nodes).sort((a, b) => b[1] - a[1])) {
			console.log(`    ${(KNOWLEDGE_NODE_LABEL[type] ?? type).padEnd(20)} ${count}`);
		}

		console.log('');
		console.log(paint('  Relações', 'bold'));
		for (const [relation, count] of Object.entries(status.counts.edges).sort((a, b) => b[1] - a[1])) {
			console.log(`    ${(RELATION_LABEL[relation] ?? relation).padEnd(20)} ${count}`);
		}

		if (status.degraded.length > 0) {
			console.log('');
			console.log(paint(`  Montado sem: ${status.degraded.join(', ')}`, 'yellow'));
			console.log(paint('  As perguntas que dependem dessas camadas não têm resposta confiável nesta construção.', 'dim'));
		}

		console.log('');
		return 0;
	}

	if (command === 'query') {
		if (!argument) {
			console.error('Informe o que procurar: npm run graph -- query "payments"');
			return 2;
		}

		const matches = await knowledgeGraph.query(argument, { type: value(argv, '--type'), limit: 15 });

		if (json) {
			console.log(JSON.stringify(matches, null, 2));
			return 0;
		}

		console.log('');
		console.log(`${paint(`${matches.length} resultado(s)`, 'bold')}  ${paint(`para "${argument}"`, 'dim')}`);
		console.log('');

		for (const match of matches) {
			console.log(
				`  ${paint((KNOWLEDGE_NODE_LABEL[match.node.type] ?? match.node.type).padEnd(18), 'dim')} ${match.node.name}`
			);
			console.log(paint(`      ${match.node.id}  ·  casou por ${match.matchedOn}`, 'dim'));

			for (const related of match.related.slice(0, 6)) {
				const arrow = related.direction === 'out' ? '→' : '←';
				console.log(
					paint(`      ${arrow} ${RELATION_LABEL[related.relation] ?? related.relation}: ${related.node.name}`, 'dim')
				);
			}

			if (match.related.length > 6) console.log(paint(`      … e mais ${match.related.length - 6} relação(ões)`, 'dim'));
		}

		if (matches.length === 0) console.log(paint('  Nada encontrado. O grafo casa por nome, arquivo de origem e id.', 'dim'));

		console.log('');
		return 0;
	}

	if (command === 'impact') {
		if (!argument) {
			console.error('Informe o nó: npm run graph -- impact "endpoint:GET /api/auth/me"');
			return 2;
		}

		const depth = Number(value(argv, '--depth')) || 3;
		const impact = await knowledgeGraph.impact(argument, { maxDepth: depth });

		if (json) {
			console.log(JSON.stringify(impact, null, 2));
			return 0;
		}

		if (!impact.origin) {
			console.log('');
			console.log(paint(`  Nenhum nó com id "${argument}".`, 'yellow'));
			console.log(paint('  Use `npm run graph -- query` para achar o identificador.', 'dim'));
			console.log('');
			return 0;
		}

		console.log('');
		console.log(`${paint('Impacto', 'bold')}  ${impact.origin.name}`);
		console.log('');

		for (const entry of impact.affected) {
			console.log(
				`  ${paint(`${entry.distance}`, 'dim')} ${(KNOWLEDGE_NODE_LABEL[entry.node.type] ?? entry.node.type).padEnd(18)} ${entry.node.name}`
			);
			console.log(paint(`      via ${entry.via.map((relation) => RELATION_LABEL[relation] ?? relation).join(' → ')}`, 'dim'));
		}

		if (impact.affected.length === 0) console.log(paint('  Nada depende deste nó pelas relações que propagam impacto.', 'dim'));

		if (impact.teams.length > 0) {
			console.log('');
			console.log(`  Times a avisar: ${impact.teams.join(', ')}`);
		}

		if (impact.truncated) {
			console.log('');
			console.log(paint(`  A busca parou no limite de ${depth} salto(s); pode haver mais.`, 'yellow'));
		}

		console.log('');
		return 0;
	}

	console.error(`Subcomando desconhecido: ${command}`);
	console.error('Use: status, query <texto>, impact <id>, rebuild.');
	return 2;
}

main()
	.then((code) => {
		process.exitCode = code;
	})
	.catch((error) => {
		console.error('Falha ao consultar o Knowledge Graph:', error);
		process.exitCode = 3;
	});
