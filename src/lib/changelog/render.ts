/**
 * O documento (issue #15).
 *
 * Saída em Markdown com frontmatter da Starlight. Duas decisões de forma que
 * vale explicar, porque as duas são sobre confiança do leitor:
 *
 * **A quebra vem antes de tudo.** Quem abre um changelog procurando risco não
 * deve precisar ler três seções para descobrir que algo quebrou.
 *
 * **A pendência aparece na página, não só no console.** Uma depreciação sem data
 * de fim de vida sai marcada como tal. Publicar o aviso sem a data e mencionar a
 * falta apenas no log da automação entregaria ao leitor um documento que parece
 * completo e não é.
 */

import { CATEGORY_LABEL, type ChangelogEntry, type MonthlyChangelog } from './types';

const MESES = [
	'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
	'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** `2026-08` → `agosto de 2026`. */
export function periodLabel(period: string): string {
	const [year, month] = period.split('-').map(Number);
	return `${MESES[(month ?? 1) - 1] ?? ''} de ${year}`;
}

/** Escapa o que quebraria o YAML do frontmatter. */
function yamlString(value: string): string {
	return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function renderEntry(entry: ChangelogEntry, underProductHeading = false): string {
	const parts: string[] = [];
	// Sob um subtítulo de produto, repetir o escopo escreveria o nome do produto
	// duas vezes na mesma linha — o escopo *é* o produto quando ele foi o que
	// produziu o agrupamento.
	const redundant = underProductHeading && entry.scope === entry.product;
	const scope = entry.scope && !redundant ? `**${entry.scope}** — ` : '';

	parts.push(`- ${entry.breaking ? '**Mudança incompatível.** ' : ''}${scope}${entry.text}`);

	if (entry.breaking && entry.breakingNote) {
		parts.push(`  ${entry.breakingNote}`);
	} else if (entry.breaking) {
		parts.push('  _O commit não explica o que quebra — confirme antes de publicar._');
	}

	if (entry.deprecation) {
		const { subject, endOfLife, migration } = entry.deprecation;
		parts.push(
			endOfLife
				? `  \`${subject}\` fica disponível até **${endOfLife}**.`
				: `  \`${subject}\` será descontinuado. _Falta a data de fim de vida._`
		);
		if (migration) parts.push(`  Como migrar: [${migration}](${migration})`);
	}

	if (entry.pullRequest) parts.push(`  ([#${entry.pullRequest}](../../pull/${entry.pullRequest}))`);

	return parts.join('\n');
}

export interface RenderOptions {
	/** Quantas páginas de changelog já existem, para a ordem na navegação. */
	order: number;
	/** Rótulos dos produtos, por id, para os subtítulos (issue #18). */
	productLabels?: Record<string, string>;
}

/**
 * Agrupa as entradas de uma seção por produto (issue #18).
 *
 * O que **não** é feito aqui: dividir o changelog em um arquivo por produto. A
 * issue pede explicitamente um arquivo único com os impactos mensais de todos os
 * produtos — quem lê changelog quer saber o que mudou no mês, e ter de abrir
 * cinco páginas para montar essa resposta é pior do que ler uma com cinco
 * subtítulos.
 *
 * As entradas sem produto vêm **primeiro**, sem subtítulo. Elas valem para todo
 * mundo, e enterrá-las depois dos produtos faria quem lê só a sua seção perder o
 * que era justamente transversal.
 */
export function groupByProduct(
	entries: readonly ChangelogEntry[]
): Array<{ product?: string; entries: ChangelogEntry[] }> {
	const shared: ChangelogEntry[] = [];
	const byProduct = new Map<string, ChangelogEntry[]>();

	for (const entry of entries) {
		if (!entry.product) {
			shared.push(entry);
			continue;
		}
		const bucket = byProduct.get(entry.product);
		if (bucket) bucket.push(entry);
		else byProduct.set(entry.product, [entry]);
	}

	const groups: Array<{ product?: string; entries: ChangelogEntry[] }> = [];
	if (shared.length > 0) groups.push({ entries: shared });
	// Ordem alfabética por id: a ordem de aparição no histórico faria o mesmo mês
	// sair diferente conforme a ordem dos commits, e não há razão para isso.
	for (const product of [...byProduct.keys()].sort()) {
		groups.push({ product, entries: byProduct.get(product)! });
	}

	return groups;
}

export function renderChangelog(changelog: MonthlyChangelog, options: RenderOptions): string {
	const label = periodLabel(changelog.period);
	const title = `Mudanças de ${label}`;

	const breaking = changelog.sections
		.flatMap((section) => section.entries)
		.filter((entry) => entry.breaking);

	const description =
		breaking.length > 0
			? `O que mudou na API e na documentação em ${label}, incluindo ${breaking.length} mudança(s) incompatível(is).`
			: `O que mudou na API e na documentação em ${label}.`;

	const lines: string[] = [
		'---',
		`title: ${yamlString(title)}`,
		`description: ${yamlString(description)}`,
		'sidebar:',
		`  order: ${options.order}`,
		'tags: [changelog]',
		'---',
		'',
		`**${label}**`,
		'',
	];

	if (breaking.length > 0) {
		lines.push(
			':::danger[Requer ação]',
			`Este mês traz ${breaking.length} mudança(s) que podem quebrar integrações existentes. Elas estão marcadas abaixo e vêm primeiro em cada seção.`,
			':::',
			''
		);
	}

	const labels = options.productLabels ?? {};

	for (const section of changelog.sections) {
		if (section.entries.length === 0) continue;
		lines.push(`## ${CATEGORY_LABEL[section.category]}`, '');

		const groups = groupByProduct(section.entries);
		// Um grupo só e sem produto é o changelog de sempre: nada de subtítulo,
		// que só existiria para dizer "todos" num portal de um produto só.
		const labelled = groups.length > 1 || groups[0]?.product !== undefined;

		for (const group of groups) {
			if (labelled) {
				lines.push(
					`### ${group.product ? (labels[group.product] ?? group.product) : 'Todos os produtos'}`,
					''
				);
			}
			for (const entry of group.entries) {
				lines.push(renderEntry(entry, labelled && group.product !== undefined), '');
			}
		}
	}

	// O rodapé diz de onde a página veio. Um documento gerado que não se declara
	// gerado recebe correções manuais que a próxima geração apaga.
	lines.push(
		'---',
		'',
		`_Gerado a partir dos commits de ${changelog.from.slice(0, 10)} a ${changelog.to.slice(0, 10)}._`,
		`_${changelog.considered} commits lidos, ${changelog.filtered} filtrados como manutenção._`,
		''
	);

	return lines.join('\n');
}

/** O nome do arquivo de um período: `2026-08.md`. */
export function fileNameFor(period: string): string {
	return `${period}.md`;
}
