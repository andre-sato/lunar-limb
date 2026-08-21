/**
 * Filtro de ruído e classificação (issue #15).
 *
 * A regra que orienta o arquivo: **na dúvida, fora.** Um item de manutenção que
 * escapa para o changelog custa a atenção de todo leitor daquele mês; um item
 * relevante que é filtrado por engano custa uma linha que alguém acrescenta na
 * revisão. Os custos não são simétricos, e o filtro é calibrado para o menor.
 *
 * É por isso que o relatório sempre diz **quantos** foram descartados. Um filtro
 * silencioso que come metade do mês é indistinguível de um mês parado.
 */

import type { CommitInfo } from '../history/git';
import { parseConventional, parseDeprecation } from './conventional';
import type { Category, ChangelogConfig, ChangelogEntry } from './types';

/** Tipos que mapeiam direto para uma das três seções da spec. */
const CATEGORY_BY_TYPE: Record<string, Category> = {
	feat: 'feature',
	feature: 'feature',
	fix: 'fix',
	bugfix: 'fix',
	hotfix: 'fix',
	docs: 'docs',
	doc: 'docs',
};

export interface Classified {
	entry?: ChangelogEntry;
	/** Preenchido quando o commit foi descartado, com o motivo. */
	filteredBecause?: string;
	warnings: string[];
}

/**
 * Todos os arquivos tocados são ruído?
 *
 * Um commit que só mexe em `package-lock.json` não muda nada para quem integra.
 * A checagem é sobre **todos** os arquivos: um commit que toca o lock e também
 * uma rota é uma mudança de produto que por acaso atualizou dependência.
 */
export function touchesOnlyNoise(files: readonly string[], config: ChangelogConfig): boolean {
	if (files.length === 0) return false;
	return files.every((file) => config.noisePaths.some((prefix) => file.startsWith(prefix)));
}

export function classify(commit: CommitInfo, config: ChangelogConfig): Classified {
	const warnings: string[] = [];
	const parsed = parseConventional(commit.subject, commit.body ?? '');
	const short = commit.commit.slice(0, 7);

	// Uma quebra entra sempre, mesmo com tipo de ruído: `refactor!` que muda um
	// contrato é exatamente o que o leitor precisa saber, e filtrá-lo pelo tipo
	// publicaria um mês silencioso sobre a mudança mais cara do mês.
	if (!parsed.breaking) {
		if (parsed.unconventional) {
			return { filteredBecause: 'mensagem fora da convenção', warnings };
		}
		if (config.noiseTypes.includes(parsed.type)) {
			return { filteredBecause: `tipo \`${parsed.type}\` é manutenção`, warnings };
		}
		if (parsed.scope && config.noiseScopes.includes(parsed.scope)) {
			return { filteredBecause: `escopo \`${parsed.scope}\` é manutenção`, warnings };
		}
		if (touchesOnlyNoise(commit.files, config)) {
			return { filteredBecause: 'só toca arquivos sem efeito para quem integra', warnings };
		}
	}

	const deprecation = parseDeprecation(parsed.body);

	// A spec exige data de fim de vida em todo aviso de depreciação. Sem ela o
	// item sai com a pendência anotada, e não sem o aviso.
	if (deprecation && !deprecation.endOfLife) {
		warnings.push(`${short}: depreciação de \`${deprecation.subject}\` sem data de fim de vida.`);
	}
	if (deprecation && !deprecation.migration) {
		warnings.push(`${short}: depreciação de \`${deprecation.subject}\` sem link de migração.`);
	}
	if (parsed.breaking && !parsed.breakingNote) {
		warnings.push(`${short}: mudança incompatível sem nota explicando o que quebra.`);
	}

	// Depreciação vai para a seção de ciclo de vida, qualquer que seja o tipo:
	// é onde o leitor a procura.
	const category: Category = deprecation
		? 'docs'
		: (CATEGORY_BY_TYPE[parsed.type] ?? (parsed.breaking ? 'feature' : 'fix'));

	return {
		entry: {
			commit: commit.commit,
			date: commit.date,
			category,
			text: parsed.description,
			original: commit.subject,
			scope: parsed.scope,
			breaking: parsed.breaking,
			breakingNote: parsed.breakingNote,
			pullRequest: commit.pullRequest,
			endpoints: [],
			deprecation,
		},
		warnings,
	};
}

/**
 * Ordena dentro de uma seção: primeiro o que quebra, depois o resto por data.
 *
 * Quem abre o changelog procurando risco encontra o risco no topo. Ordenar só
 * por data enterra a quebra no meio de correções de digitação.
 */
export function orderEntries(entries: readonly ChangelogEntry[]): ChangelogEntry[] {
	return [...entries].sort((a, b) => {
		if (a.breaking !== b.breaking) return a.breaking ? -1 : 1;
		if (Boolean(a.deprecation) !== Boolean(b.deprecation)) return a.deprecation ? -1 : 1;
		return a.date.localeCompare(b.date);
	});
}
