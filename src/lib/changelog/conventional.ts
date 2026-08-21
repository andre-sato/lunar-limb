/**
 * Leitura de Conventional Commits (issue #15).
 *
 * A convenção é `tipo(escopo)!: descrição`, com rodapés opcionais no corpo. Ela
 * é o que permite separar o que interessa ao leitor do que é manutenção — sem
 * ela, o gerador teria de adivinhar pela prosa, e adivinhar sobre o que anunciar
 * a clientes é o tipo de erro que só aparece depois de publicado.
 *
 * Mensagem fora da convenção **não é descartada aqui**. Ela volta marcada como
 * `unconventional`, e quem decide é o classificador: um repositório que ainda
 * não adotou a convenção geraria um changelog vazio, e um changelog vazio por
 * defeito de ferramenta é indistinguível de um mês sem mudanças.
 */

import type { ConventionalCommit } from './types';

/** `feat(pagamentos)!: aceita Pix` → tipo, escopo, `!`, descrição. */
const HEADER = /^([a-zA-Z]+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/;

/**
 * Os tipos que a convenção define, mais os apelidos que aparecem na prática.
 *
 * A lista existe porque o formato `Palavra: texto` é comum em mensagem de commit
 * comum. Sem ela, `README: comprime as seções` era lido como tipo `README` e
 * entrava no changelog como correção — o gerador produzia itens com convicção a
 * partir de commits que não seguem convenção nenhuma.
 *
 * Rodar contra este repositório expôs exatamente isso: de 97 commits, os 2 que
 * "passaram" eram os dois com dois-pontos no assunto.
 */
const KNOWN_TYPES = new Set([
	'feat', 'feature',
	'fix', 'bugfix', 'hotfix',
	'docs', 'doc',
	'chore', 'refactor', 'test', 'tests', 'ci', 'build', 'style', 'perf', 'revert',
]);

/**
 * Rodapé de quebra. A convenção aceita as duas grafias, e `!` no cabeçalho é a
 * terceira forma — as três significam a mesma coisa.
 */
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE:\s*([\s\S]+?)(?=\n[A-Z][\w-]*:|\n*$)/m;

export function parseConventional(subject: string, body = ''): ConventionalCommit {
	const match = subject.trim().match(HEADER);
	const footer = body.match(BREAKING_FOOTER);
	const breakingNote = footer?.[1]?.trim() || undefined;

	if (!match) {
		return {
			type: '',
			description: subject.trim(),
			body: body.trim(),
			breaking: Boolean(breakingNote),
			breakingNote,
			unconventional: true,
		};
	}

	const [, type, scope, bang, description] = match;

	// Casou a forma, mas o tipo não é um tipo. Trata como prosa comum, que é o
	// que ela é — e deixa a decisão de aproveitar ou não para o classificador.
	if (!KNOWN_TYPES.has(type.toLowerCase())) {
		return {
			type: '',
			description: subject.trim(),
			body: body.trim(),
			breaking: Boolean(breakingNote),
			breakingNote,
			unconventional: true,
		};
	}

	return {
		type: type.toLowerCase(),
		scope: scope?.trim() || undefined,
		description: description.trim(),
		body: body.trim(),
		breaking: Boolean(bang) || Boolean(breakingNote),
		breakingNote,
		unconventional: false,
	};
}

// ---------------------------------------------------------------------------
// Depreciação
// ---------------------------------------------------------------------------

/**
 * Uma depreciação declarada no corpo do commit.
 *
 *     DEPRECATED: GET /v1/cobrancas/lista
 *     END-OF-LIFE: 2027-05-01
 *     MIGRATION: /guides/migracao-v2/
 *
 * A data de fim de vida é o campo que a spec da issue exige em todo aviso, e é
 * também o que ninguém lembra de escrever. Quando falta, o item sai com a
 * pendência registrada em vez de sair sem o aviso — um aviso de depreciação sem
 * prazo não permite planejar, mas a sua ausência não permite nem saber.
 */
export interface DeprecationNote {
	subject: string;
	endOfLife?: string;
	migration?: string;
}

const DEPRECATED = /^DEPRECAT(?:ED|ION):\s*(.+)$/im;
const END_OF_LIFE = /^(?:END[- ]OF[- ]LIFE|EOL|FIM[- ]DE[- ]VIDA):\s*(.+)$/im;
const MIGRATION = /^(?:MIGRATION|MIGRA[CÇ][AÃ]O):\s*(.+)$/im;

export function parseDeprecation(body: string): DeprecationNote | undefined {
	const subject = body.match(DEPRECATED)?.[1]?.trim();
	if (!subject) return undefined;

	const endOfLife = body.match(END_OF_LIFE)?.[1]?.trim();

	return {
		subject,
		// Data só é aceita se for uma data. `END-OF-LIFE: em breve` é o mesmo que
		// não ter prazo, e registrá-lo como se fosse um daria falsa precisão.
		endOfLife: endOfLife && !Number.isNaN(Date.parse(endOfLife)) ? endOfLife : undefined,
		migration: body.match(MIGRATION)?.[1]?.trim() || undefined,
	};
}
