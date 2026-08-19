/**
 * CLI do Documentation Time Machine (P2.1).
 *
 *   npm run history -- payments.md
 *   npm run history -- payments.md --at 2026-05-15
 *   npm run history -- payments.md --compare 2026-05-15 2026-08-18
 *   npm run history -- impact <commit>
 *   npm run history -- restore payments.md --at 2026-05-15
 *   npm run history -- snapshot --at 2026-05-15
 *
 * Códigos de saída: 0 ok · 2 uso inválido · 3 erro de execução.
 *
 * `restore` **não** altera a branch: ele escreve no workspace isolado e imprime o
 * diff. O caminho até a documentação publicada continua sendo validação e pull
 * request.
 */

import { documentationHistory, compare, diffPage, getImpact, getSnapshot, resolveSnapshotRef, restore } from '../src/lib/history/service';
import { releases } from '../src/lib/history/git';
import { SEMANTIC_LABEL } from '../src/lib/history/types';

const EXIT_OK = 0;
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

const CHANGE_MARK: Record<string, string> = {
	added: '+',
	modified: '~',
	deleted: '-',
	renamed: '→',
};

function printSemantic(changes: ReturnType<typeof import('../src/lib/history/semantic').semanticDiff>): void {
	if (changes.length === 0) {
		console.log(paint('  Nenhuma mudança de comportamento reconhecida.', 'dim'));
		console.log(
			paint(
				'  (o diff semântico lê valores, campos obrigatórios, endpoints, autenticação e status —\n   uma reescrita em prosa passa por ele sem ser vista)',
				'dim'
			)
		);
		return;
	}

	for (const change of changes) {
		console.log(`  ${paint(SEMANTIC_LABEL[change.kind], 'bold')} — ${change.subject}`);
		if (change.before || change.after) {
			console.log(`      ${paint(change.before ?? '—', 'red')} → ${paint(change.after ?? '—', 'green')}`);
		}
		console.log(paint(`      confiança ${Math.round(change.confidence * 100)}%`, 'dim'));
	}
}

async function main(): Promise<number> {
	const argv = process.argv.slice(2);
	const json = argv.includes('--json');

	if (!(await documentationHistory.available())) {
		console.error('Este diretório não é um repositório Git; não há histórico a consultar.');
		return EXIT_BAD_USAGE;
	}

	const first = argv.find((argument) => !argument.startsWith('--'));

	// --- releases ------------------------------------------------------------
	if (first === 'releases') {
		const tags = await releases();
		if (json) {
			console.log(JSON.stringify(tags, null, 2));
			return EXIT_OK;
		}

		console.log('');
		if (tags.length === 0) console.log(paint('  Nenhuma tag no repositório.', 'dim'));
		for (const tag of tags) console.log(`  ${tag.tag.padEnd(16)} ${tag.date.slice(0, 10)}  ${paint(tag.commit.slice(0, 8), 'dim')}`);
		console.log('');
		return EXIT_OK;
	}

	// --- impacto de um commit ------------------------------------------------
	if (first === 'impact') {
		const commit = argv[argv.indexOf('impact') + 1];
		if (!commit || commit.startsWith('--')) {
			console.error('Informe o commit: npm run history -- impact <commit>');
			return EXIT_BAD_USAGE;
		}

		const impact = await getImpact(commit);
		if (!impact) {
			console.error(`Commit não encontrado: ${commit}`);
			return EXIT_BAD_USAGE;
		}

		if (json) {
			console.log(JSON.stringify(impact, null, 2));
			return EXIT_OK;
		}

		console.log('');
		console.log(`${paint(impact.subject, 'bold')}`);
		console.log(paint(`  ${impact.commit.slice(0, 8)} · ${impact.date.slice(0, 10)} · ${impact.author}`, 'dim'));
		console.log('');

		if (impact.pages.length > 0) {
			console.log(paint('  Páginas alteradas', 'bold'));
			for (const page of impact.pages) console.log(`    ${page}`);
		}

		if (impact.product.length > 0) {
			console.log('');
			console.log(paint('  Produto tocado no mesmo commit', 'bold'));
			for (const file of impact.product.slice(0, 10)) console.log(paint(`    ${file}`, 'dim'));
		}

		if (impact.indirect.length > 0) {
			console.log('');
			console.log(paint('  Páginas que mudaram sem aparecer no commit', 'bold'));
			for (const page of impact.indirect) console.log(`    ${page}`);
		}

		console.log('');
		console.log(paint('  Mudanças de comportamento', 'bold'));
		printSemantic(impact.semantic);
		console.log('');
		return EXIT_OK;
	}

	// --- snapshot ------------------------------------------------------------
	if (first === 'snapshot') {
		const at = value(argv, '--at') ?? 'HEAD';
		const ref = await resolveSnapshotRef(at);
		if (!ref) {
			console.error(`Não consegui resolver "${at}" para um commit.`);
			return EXIT_BAD_USAGE;
		}

		const snapshot = await getSnapshot(ref, { maxPages: 500, withLint: argv.includes('--lint') });

		if (json) {
			console.log(JSON.stringify({ ...snapshot, pages: snapshot.pages.map((page) => page.path) }, null, 2));
			return EXIT_OK;
		}

		console.log('');
		console.log(`${paint('Snapshot', 'bold')} ${ref.ref.slice(0, 8)} ${paint(ref.date?.slice(0, 10) ?? '', 'dim')}`);
		console.log(paint(`  resolvido a partir de ${ref.resolvedFrom}`, 'dim'));
		console.log('');
		console.log(`  Páginas             ${snapshot.metrics?.pages ?? '—'}`);
		console.log(`  Palavras            ${snapshot.metrics?.words ?? '—'}`);
		console.log(`  Termos de glossário ${snapshot.metrics?.glossaryTerms ?? '—'}`);
		console.log(`  Endpoints           ${snapshot.metrics?.endpoints ?? '—'}`);
		if (snapshot.metrics?.lintScore !== undefined) console.log(`  Nota do linter      ${snapshot.metrics.lintScore}`);
		console.log(
			`  Health Score        ${snapshot.metrics?.health ?? paint('sem medição desta época', 'dim')}`
		);
		console.log('');
		return EXIT_OK;
	}

	// --- restore -------------------------------------------------------------
	if (first === 'restore') {
		const page = argv[argv.indexOf('restore') + 1];
		const at = value(argv, '--at');

		if (!page || page.startsWith('--') || !at) {
			console.error('Use: npm run history -- restore <página> --at <data|commit>');
			return EXIT_BAD_USAGE;
		}

		const ref = await resolveSnapshotRef(at);
		if (!ref) {
			console.error(`Não consegui resolver "${at}".`);
			return EXIT_BAD_USAGE;
		}

		const result = await restore(page, ref);
		if (!result) {
			console.error(`\`${page}\` não existia em ${at}.`);
			return EXIT_BAD_USAGE;
		}

		if (json) {
			console.log(JSON.stringify(result, null, 2));
			return EXIT_OK;
		}

		console.log('');
		console.log(`${paint('Restauração preparada no workspace', 'bold')} ${paint(result.runId, 'dim')}`);
		console.log('');

		for (const line of result.diff.split('\n')) {
			if (line.startsWith('+')) console.log(paint(line, 'green'));
			else if (line.startsWith('-')) console.log(paint(line, 'red'));
			else console.log(paint(line, 'dim'));
		}

		console.log('');
		console.log(paint('  O que isto muda de comportamento', 'bold'));
		printSemantic(result.semantic);

		console.log('');
		for (const step of result.nextSteps) console.log(paint(`  · ${step}`, 'yellow'));
		console.log('');
		return EXIT_OK;
	}

	// --- página --------------------------------------------------------------
	if (!first) {
		console.error('Informe a página: npm run history -- <página> [--at data] [--compare de até]');
		console.error('Ou use: snapshot, impact <commit>, restore <página> --at <data>, releases.');
		return EXIT_BAD_USAGE;
	}

	const compareIndex = argv.indexOf('--compare');

	if (compareIndex >= 0) {
		const [fromInput, toInput] = [argv[compareIndex + 1], argv[compareIndex + 2]];
		if (!fromInput || !toInput) {
			console.error('Use: --compare <de> <até>');
			return EXIT_BAD_USAGE;
		}

		const [from, to] = await Promise.all([resolveSnapshotRef(fromInput), resolveSnapshotRef(toInput)]);
		if (!from || !to) {
			console.error('Não consegui resolver uma das referências.');
			return EXIT_BAD_USAGE;
		}

		const [comparison, pageDiff] = await Promise.all([
			compare(from, to, { maxPages: 400 }),
			diffPage(first, from, to),
		]);

		if (json) {
			console.log(JSON.stringify({ comparison, page: pageDiff }, null, 2));
			return EXIT_OK;
		}

		console.log('');
		console.log(`${paint('Comparação', 'bold')}  ${from.date?.slice(0, 10)} → ${to.date?.slice(0, 10)}`);
		console.log(paint(`  ${comparison.commits} commit(s) entre os dois pontos`, 'dim'));
		console.log('');

		for (const metric of comparison.metrics) {
			const before = metric.before ?? '—';
			const after = metric.after ?? '—';
			const delta =
				metric.delta === null ? '' : paint(` (${metric.delta > 0 ? '+' : ''}${metric.delta})`, metric.delta < 0 ? 'red' : 'green');
			console.log(`  ${metric.name.padEnd(22)} ${String(before).padStart(6)} → ${String(after).padStart(6)}${delta}`);
		}

		console.log('');
		console.log(
			paint(
				`  ${comparison.pages.added.length} página(s) criada(s) · ${comparison.pages.modified.length} alterada(s) · ${comparison.pages.removed.length} removida(s)`,
				'dim'
			)
		);

		console.log('');
		console.log(`${paint(first, 'bold')} — mudanças de comportamento`);
		printSemantic(pageDiff.semantic);
		console.log('');
		return EXIT_OK;
	}

	const at = value(argv, '--at');

	if (at) {
		const ref = await resolveSnapshotRef(at);
		if (!ref) {
			console.error(`Não consegui resolver "${at}".`);
			return EXIT_BAD_USAGE;
		}

		const { fileAt } = await import('../src/lib/history/git');
		const content = await fileAt(ref.ref, `src/content/docs/${first}`);

		if (content === undefined) {
			console.error(`\`${first}\` não existia em ${at}.`);
			return EXIT_BAD_USAGE;
		}

		if (json) {
			console.log(JSON.stringify({ path: first, ref, content }, null, 2));
			return EXIT_OK;
		}

		console.log(content);
		return EXIT_OK;
	}

	const timeline = await documentationHistory.getTimeline(first);

	if (json) {
		console.log(JSON.stringify(timeline, null, 2));
		return EXIT_OK;
	}

	console.log('');
	console.log(paint(first, 'bold'));
	console.log('');

	if (timeline.length === 0) {
		console.log(paint('  Sem histórico: a página pode ser nova e ainda não commitada.', 'dim'));
		console.log('');
		return EXIT_OK;
	}

	let year = '';
	for (const entry of timeline) {
		const entryYear = entry.date.slice(0, 4);
		if (entryYear !== year) {
			year = entryYear;
			console.log(paint(`  ${year}`, 'bold'));
		}

		const marks = [
			entry.tags.length > 0 ? paint(` [${entry.tags.join(', ')}]`, 'green') : '',
			entry.pullRequest ? paint(` #${entry.pullRequest}`, 'dim') : '',
		].join('');

		console.log(
			`   ${CHANGE_MARK[entry.change] ?? '~'} ${entry.date.slice(5, 10)} — ${entry.subject}${marks}`
		);
		console.log(
			paint(`      ${entry.author} · ${entry.commit.slice(0, 8)} · +${entry.insertions}/-${entry.deletions}`, 'dim')
		);
	}

	console.log('');
	return EXIT_OK;
}

main()
	.then((code) => {
		process.exitCode = code;
	})
	.catch((error) => {
		console.error('Falha ao consultar o histórico:', error);
		process.exitCode = EXIT_RUNTIME_ERROR;
	});
