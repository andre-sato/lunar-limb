/**
 * Montagem do changelog mensal (issue #15).
 *
 * A parte que toca Git e disco. Ela reúne os commits do período, aplica o
 * filtro, resolve os endpoints contra a especificação e chama o renderizador.
 *
 * **Nada aqui publica.** A função devolve o documento; quem grava é a CLI, e
 * quem decide se ele vai para o site é uma pessoa revisando o pull request que
 * a automação abre. Um changelog é o que um cliente lê para decidir se precisa
 * mexer no código dele — e a automação não tem como saber se traduziu bem.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { commitsInRange } from '../history/git';
import { parseOpenApi, type ApiModel } from '../api-explorer/model';
import { classify, orderEntries } from './classify';
import { loadProducts } from '../products/registry';
import { findEndpoints, linkEndpoints } from './endpoints';
import { fileNameFor } from './render';
import {
	DEFAULT_CONFIG,
	type Category,
	type ChangelogConfig,
	type ChangelogEntry,
	type MonthlyChangelog,
} from './types';

const ROOT = process.cwd();
const ORDER: Category[] = ['feature', 'fix', 'docs'];

/** Primeiro instante do mês, e primeiro do mês seguinte. */
export function monthWindow(period: string): { from: string; to: string } {
	const [year, month] = period.split('-').map(Number);
	const from = new Date(Date.UTC(year, month - 1, 1));
	const to = new Date(Date.UTC(year, month, 1));
	return { from: from.toISOString(), to: to.toISOString() };
}

/** O mês anterior ao de referência: o que a execução do dia 1º precisa. */
export function previousMonth(reference = new Date()): string {
	const date = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() - 1, 1));
	return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function loadModel(config: ChangelogConfig): Promise<ApiModel | null> {
	try {
		return parseOpenApi(await readFile(path.resolve(ROOT, config.specification), 'utf-8'));
	} catch {
		// Sem especificação legível o gerador continua: os endpoints saem como
		// código em vez de link, e a geração avisa. Interromper por causa disso
		// trocaria um changelog com links a menos por nenhum changelog.
		return null;
	}
}

export async function nextOrder(config: ChangelogConfig): Promise<number> {
	try {
		const files = await readdir(path.resolve(ROOT, config.outputDir));
		return files.filter((file) => /\.mdx?$/.test(file)).length + 1;
	} catch {
		return 1;
	}
}

export async function generateChangelog(
	period: string,
	overrides: Partial<ChangelogConfig> = {}
): Promise<MonthlyChangelog> {
	const config = { ...DEFAULT_CONFIG, ...overrides };
	const { from, to } = monthWindow(period);

	// Os produtos vêm do registro, e não de configuração própria do changelog: é
	// o mesmo `organization.yml` que a navegação lê, e duas listas de produto que
	// divergem produziriam um changelog agrupado por produtos que o portal não
	// reconhece. Quem passa `products` no override manda — é o que os testes usam.
	if (overrides.products === undefined) {
		config.products = (await loadProducts()).products.map((product) => product.id);
	}

	const [commits, model] = await Promise.all([commitsInRange(from, to), loadModel(config)]);

	const warnings: string[] = [];
	const entries: ChangelogEntry[] = [];
	let filtered = 0;
	let unconventional = 0;

	if (!model) warnings.push('Especificação não pôde ser lida: endpoints saem como texto, sem link.');

	for (const commit of commits) {
		const result = classify(commit, config);
		warnings.push(...result.warnings);

		if (!result.entry) {
			filtered += 1;
			if (result.filteredBecause?.includes('convenção')) unconventional += 1;
			continue;
		}

		// Os endpoints são procurados no texto **e** na nota de quebra: é comum a
		// citação estar só na explicação do que quebrou.
		const haystack = [result.entry.text, result.entry.breakingNote ?? '', result.entry.deprecation?.subject ?? ''].join(' ');
		const links = findEndpoints(haystack, model, config.apiReferenceBase);

		for (const link of links.filter((candidate) => !candidate.resolved)) {
			warnings.push(
				`${commit.commit.slice(0, 7)}: \`${link.method} ${link.path}\` não existe na especificação — saiu sem link.`
			);
		}

		result.entry.endpoints = links.filter((link) => link.resolved).map((link) => `${link.method} ${link.path}`);
		result.entry.text = linkEndpoints(result.entry.text, links);
		if (result.entry.breakingNote) result.entry.breakingNote = linkEndpoints(result.entry.breakingNote, links);

		entries.push(result.entry);
	}

	// Um repositório que não usa Conventional Commits produz changelog vazio, e
	// vazio por falta de convenção é indistinguível de vazio por mês parado. O
	// relatório precisa separar as duas coisas — senão alguém conclui que a
	// automação está quebrada, ou pior, que o mês não teve mudanças.
	if (commits.length > 0 && unconventional / commits.length > 0.5) {
		warnings.push(
			`${unconventional} de ${commits.length} commits não seguem Conventional Commits e ficaram de fora. ` +
				'O changelog só consegue separar o que interessa ao leitor quando a mensagem declara o tipo.'
		);
	}

	const sections = ORDER.map((category) => ({
		category,
		entries: orderEntries(entries.filter((entry) => entry.category === category)),
	}));

	return {
		period,
		from,
		to,
		sections,
		considered: commits.length,
		filtered,
		warnings: [...new Set(warnings)],
		// Mês sem nada de interesse não vira página. Um changelog com "nenhuma
		// mudança relevante" publicado todo mês ensina o leitor a não abrir o
		// changelog — e aí ele não abre no mês em que algo quebra.
		empty: entries.length === 0,
	};
}

/** O caminho onde a página deste período seria escrita. */
export function outputPathFor(period: string, config: ChangelogConfig = DEFAULT_CONFIG): string {
	return path.join(config.outputDir, fileNameFor(period));
}
