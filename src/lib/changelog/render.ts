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

function renderEntry(entry: ChangelogEntry): string {
	const parts: string[] = [];
	const scope = entry.scope ? `**${entry.scope}** — ` : '';

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

	for (const section of changelog.sections) {
		if (section.entries.length === 0) continue;
		lines.push(`## ${CATEGORY_LABEL[section.category]}`, '');
		for (const entry of section.entries) lines.push(renderEntry(entry), '');
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
