/**
 * Auditoria do glossário, para a tela de administração (issue #4).
 *
 * O glossário sempre foi acessível: os termos são Markdown em
 * `src/content/glossary/`, e quem tem o editor os abre e edita. O que faltava é
 * a pergunta que só aparece olhando o conjunto — **este glossário está
 * saudável?** — e essa não se responde abrindo arquivo por arquivo.
 *
 * Por isso este módulo **lê e não escreve**. Editar um termo continua sendo
 * editar o arquivo, no editor, com diff e revisão. Uma segunda porta de escrita
 * para o mesmo conteúdo criaria dois caminhos com regras diferentes, e a mais
 * fraca é a que valeria (ADR-0002).
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { getGlossaryIndex } from './loader';
import type { GlossDef, GlossaryIndex } from './types';

const DOCS_ROOT = path.resolve(process.cwd(), 'src/content/docs');

export type GlossaryProblemCode =
	/** Duas entradas disputam a mesma forma escrita. */
	| 'GLO-ALIAS-COLLISION'
	/** Um apelido de um termo é o termo canônico de outro. */
	| 'GLO-ALIAS-IS-TERM'
	/** Definição vazia ou curta demais para explicar algo numa bolha. */
	| 'GLO-EMPTY-DEFINITION'
	/** Nenhuma página usa o termo. */
	| 'GLO-UNUSED'
	/** O termo está desligado, então não é destacado em lugar nenhum. */
	| 'GLO-DISABLED';

export interface GlossaryProblem {
	code: GlossaryProblemCode;
	/** `id` do termo a que o problema pertence. */
	id: string;
	message: string;
	severity: 'error' | 'warning' | 'info';
}

export interface TermUsage {
	id: string;
	term: string;
	aliases: string[];
	enabled: boolean;
	/** Quantas páginas mencionam o termo ou algum apelido dele. */
	pages: number;
	/** Caminhos das páginas, até um teto — a lista serve para navegar, não para contar. */
	samples: string[];
	definitionChars: number;
}

export interface GlossaryAudit {
	terms: TermUsage[];
	problems: GlossaryProblem[];
	totals: {
		terms: number;
		enabled: number;
		unused: number;
		pagesScanned: number;
	};
	generatedAt: number;
}

/** Definição curta demais para caber a função de uma bolha de glossário. */
const MIN_DEFINITION_CHARS = 20;
const MAX_SAMPLES = 8;

async function walk(dir: string, base = ''): Promise<string[]> {
	const found: string[] = [];
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return found;
	}
	for (const entry of entries) {
		const relative = base ? `${base}/${entry.name}` : entry.name;
		if (entry.isDirectory()) found.push(...(await walk(path.join(dir, entry.name), relative)));
		else if (/\.mdx?$/.test(entry.name)) found.push(relative);
	}
	return found;
}

/** Sem acento e sem caixa, para comparar formas escritas de jeitos diferentes. */
export function fold(value: string): string {
	return value
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.trim();
}

/**
 * As formas que apontam para um termo: o canônico mais os apelidos.
 *
 * Duplicatas dentro do mesmo termo são removidas — escrever `API` como apelido
 * de `API` é redundante, não um conflito.
 */
export function formsOf(term: GlossDef): string[] {
	return [...new Set([term.term, ...term.aliases].map((form) => form.trim()).filter(Boolean))];
}

/**
 * Traduz os conflitos que o índice **já detecta** em problemas da tela.
 *
 * O índice resolve colisão de forma por maior correspondência e guarda a lista
 * em `index.conflicts` — recontar aqui daria uma segunda resposta para a mesma
 * pergunta, e as duas divergiriam na primeira correção de caso de borda
 * (ADR-0004). Este módulo só acrescenta o que o índice não tem: qual conserto a
 * colisão pede.
 */
export function conflictProblems(index: GlossaryIndex): GlossaryProblem[] {
	const canonical = new Map<string, GlossDef>();
	for (const term of index.byId.values()) canonical.set(fold(term.term), term);

	return index.conflicts.map((conflict) => {
		const owners = conflict.definitionIds;
		const owner = canonical.get(fold(conflict.surface));

		// Quando a forma disputada é o nome canônico de um dos lados, o conserto
		// não é renomear o apelido — é decidir se os dois são o mesmo conceito.
		if (owner && owners.length === 2 && owners.includes(owner.id)) {
			const other = owners.find((id) => id !== owner.id)!;
			return {
				code: 'GLO-ALIAS-IS-TERM' as const,
				id: other,
				severity: 'error' as const,
				message: `\`${other}\` usa "${conflict.surface}" como apelido, mas essa é a forma canônica de \`${owner.id}\`. Provavelmente são o mesmo conceito.`,
			};
		}

		return {
			code: 'GLO-ALIAS-COLLISION' as const,
			id: owners[0],
			severity: 'error' as const,
			message: `A forma "${conflict.surface}" pertence a mais de um termo (${owners.map((id) => `\`${id}\``).join(', ')}). O índice resolve por maior correspondência, então uma das definições nunca aparece.`,
		};
	});
}

/**
 * Conta em quantas páginas cada termo aparece.
 *
 * A contagem é por **página**, não por ocorrência: um termo citado quinze vezes
 * numa página só não é mais usado que um citado uma vez em cinco. O que a tela
 * responde é "vale manter este termo?", e a resposta vem do alcance.
 */
export function countUsage(
	terms: readonly GlossDef[],
	pages: ReadonlyArray<{ path: string; body: string }>
): Map<string, { pages: number; samples: string[] }> {
	const usage = new Map<string, { pages: number; samples: string[] }>();

	const matchers = terms.map((term) => ({
		id: term.id,
		forms: formsOf(term).map((form) => fold(form)),
	}));

	for (const { id } of matchers) usage.set(id, { pages: 0, samples: [] });

	for (const page of pages) {
		const folded = fold(page.body);

		for (const { id, forms } of matchers) {
			// `includes` e não limite de palavra: um termo de glossário costuma ser
			// uma expressão, e exigir fronteira exata perderia "chaves de API" dentro
			// de "rotação de chaves de API".
			if (!forms.some((form) => form !== '' && folded.includes(form))) continue;

			const entry = usage.get(id)!;
			entry.pages += 1;
			if (entry.samples.length < MAX_SAMPLES) entry.samples.push(page.path);
		}
	}

	return usage;
}

export async function auditGlossary(): Promise<GlossaryAudit> {
	const index = await getGlossaryIndex({ fresh: true });
	const terms = [...index.byId.values()];

	const files = await walk(DOCS_ROOT);
	const pages: Array<{ path: string; body: string }> = [];
	for (const relative of files) {
		pages.push({ path: relative, body: await readFile(path.join(DOCS_ROOT, relative), 'utf-8').catch(() => '') });
	}

	const usage = countUsage(terms, pages);
	const problems = conflictProblems(index);

	const rows: TermUsage[] = terms.map((term) => {
		const found = usage.get(term.id) ?? { pages: 0, samples: [] };

		if (term.definition.trim().length < MIN_DEFINITION_CHARS) {
			problems.push({
				code: 'GLO-EMPTY-DEFINITION',
				id: term.id,
				severity: 'error',
				message: `A definição de \`${term.id}\` tem menos de ${MIN_DEFINITION_CHARS} caracteres. Ela aparece numa bolha e precisa se sustentar sozinha.`,
			});
		}

		// Termo desligado não é destacado em lugar nenhum — informação, não
		// defeito: desligar é o jeito de manter a definição sem o realce.
		if (!term.enabled) {
			problems.push({
				code: 'GLO-DISABLED',
				id: term.id,
				severity: 'info',
				message: `\`${term.id}\` está desligado: continua listado em /glossary, e não é destacado nas páginas.`,
			});
		} else if (found.pages === 0) {
			problems.push({
				code: 'GLO-UNUSED',
				id: term.id,
				severity: 'warning',
				message: `Nenhuma página menciona \`${term.id}\`. Ou o termo saiu de uso, ou a documentação que o usaria ainda não existe.`,
			});
		}

		return {
			id: term.id,
			term: term.term,
			aliases: term.aliases,
			enabled: term.enabled,
			pages: found.pages,
			samples: found.samples,
			definitionChars: term.definition.trim().length,
		};
	});

	return {
		terms: rows.sort((a, b) => b.pages - a.pages || a.term.localeCompare(b.term, 'pt-BR')),
		problems,
		totals: {
			terms: terms.length,
			enabled: terms.filter((term) => term.enabled).length,
			unused: rows.filter((row) => row.enabled && row.pages === 0).length,
			pagesScanned: pages.length,
		},
		generatedAt: Date.now(),
	};
}
