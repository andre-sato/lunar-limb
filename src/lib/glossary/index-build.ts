/**
 * Índice do glossário e busca de ocorrências (§17, §26, §28).
 *
 * **Uma varredura, não uma por termo.** A abordagem ingênua — para cada termo,
 * procurar na página inteira — custa `termos × tamanho da página`. Aqui o índice
 * é montado uma vez, as formas são ordenadas da mais longa para a mais curta, e
 * cada posição do texto é testada uma única vez. Com 100 termos (§28) isso é
 * imperceptível; um Aho-Corasick só se paga acima disso, e a interface de
 * `findMatches` não muda se um dia ele entrar.
 *
 * **A ordem das formas é a regra de desempate.** `API Gateway` vem antes de
 * `API` porque é mais longa, então a varredura encontra a maior primeira e pula
 * o trecho inteiro — que é exatamente o "longest match" da §17, sem código de
 * decisão à parte.
 */

import type { GlossDef, GlossaryIndex, GlossaryMatch, Matcher, MatcherConflict } from './types';

/** Caracteres que contam como parte de uma palavra, para `matchWholeWord`. */
const WORD_CHAR = /[\p{L}\p{N}_]/u;

function isWordChar(character: string | undefined): boolean {
	return character !== undefined && WORD_CHAR.test(character);
}

function normalize(surface: string, caseSensitive: boolean): string {
	return caseSensitive ? surface : surface.toLowerCase();
}

/**
 * Monta o índice a partir das definições.
 *
 * Definições desativadas entram em `byId` — a página do glossário continua
 * mostrando o termo — mas não geram formas de busca (§7.5).
 */
export function buildGlossaryIndex(definitions: readonly GlossDef[]): GlossaryIndex {
	const byId = new Map<string, GlossDef>();
	const claims = new Map<string, string[]>();
	const matchers: Matcher[] = [];

	for (const definition of definitions) {
		byId.set(definition.id, definition);
		if (!definition.enabled) continue;

		const forms: Array<{ surface: string; kind: Matcher['kind'] }> = [
			{ surface: definition.term, kind: 'term' },
			...definition.aliases.map((alias) => ({ surface: alias, kind: 'alias' as const })),
		];

		for (const { surface, kind } of forms) {
			const trimmed = surface.trim();
			if (trimmed === '') continue;

			const normalized = normalize(trimmed, definition.caseSensitive);

			// A chave de conflito ignora a caixa mesmo quando o termo é sensível
			// a ela: dois termos que só diferem em maiúsculas confundem o leitor
			// tanto quanto dois idênticos.
			const key = trimmed.toLowerCase();
			const owners = claims.get(key) ?? [];
			if (!owners.includes(definition.id)) owners.push(definition.id);
			claims.set(key, owners);

			matchers.push({
				surface: trimmed,
				normalized,
				definitionId: definition.id,
				caseSensitive: definition.caseSensitive,
				matchWholeWord: definition.matchWholeWord,
				kind,
			});
		}
	}

	// Mais longa primeiro; em empate, ordem alfabética para o índice ser estável
	// entre builds — um índice que muda de ordem sem o conteúdo mudar produziria
	// diferenças fantasma em qualquer coisa derivada dele.
	matchers.sort((left, right) => right.surface.length - left.surface.length || left.surface.localeCompare(right.surface));

	const conflicts: MatcherConflict[] = [];
	for (const [surface, definitionIds] of claims) {
		if (definitionIds.length > 1) conflicts.push({ surface, definitionIds: [...definitionIds].sort() });
	}
	conflicts.sort((left, right) => left.surface.localeCompare(right.surface));

	return { byId, matchers, conflicts };
}

/**
 * Encontra as ocorrências de termos em um texto simples.
 *
 * Recebe texto, não Markdown: quem chama já isolou o que pode ser destacado —
 * o transformer trabalha sobre nós de texto do AST, e o linter sobre a prosa
 * já extraída. Isso é o que mantém code, link e heading fora (§14) sem esta
 * função precisar saber o que é um bloco de código.
 */
export function findMatches(text: string, index: GlossaryIndex): GlossaryMatch[] {
	if (text === '' || index.matchers.length === 0) return [];

	const lowered = text.toLowerCase();
	const matches: GlossaryMatch[] = [];
	let position = 0;

	while (position < text.length) {
		let found: GlossaryMatch | null = null;

		for (const matcher of index.matchers) {
			const haystack = matcher.caseSensitive ? text : lowered;
			const needle = matcher.normalized;
			const end = position + needle.length;

			if (end > text.length) continue;
			if (haystack.slice(position, end) !== needle) continue;

			if (matcher.matchWholeWord) {
				const before = position > 0 ? text[position - 1] : undefined;
				const after = end < text.length ? text[end] : undefined;
				if (isWordChar(before) || isWordChar(after)) continue;
			}

			found = {
				definitionId: matcher.definitionId,
				text: text.slice(position, end),
				start: position,
				end,
				kind: matcher.kind,
			};
			break; // a primeira que casa é a mais longa: as formas vêm ordenadas
		}

		if (found) {
			matches.push(found);
			position = found.end;
			continue;
		}

		position++;
	}

	return matches;
}

/**
 * Mensagem de conflito (§18), pronta para o build e para a interface.
 *
 * Falhar em silêncio aqui seria pior que o conflito: duas definições disputando
 * `API` fazem uma delas nunca aparecer, e ninguém descobre olhando a página.
 */
export function describeConflicts(index: GlossaryIndex): string[] {
	return index.conflicts.map((conflict) => {
		const owners = conflict.definitionIds
			.map((id) => `  - ${index.byId.get(id)?.term ?? id} (${id})`)
			.join('\n');
		return `Forma de glossário duplicada: "${conflict.surface}"\nUsada por:\n${owners}`;
	});
}
