/**
 * O subconjunto de JSONPath que os targets de overlay usam.
 *
 * A Overlay Specification remete a JSONPath sem fixar um dialeto, e a spec desta
 * feature pede em § 10 que a implementação **documente qual subconjunto
 * suporta**. Este arquivo é essa documentação, e o código é a sua única versão.
 *
 * ## Suportado
 *
 *     $                          a raiz
 *     $.paths                    filho por nome
 *     $['paths']                 idem, com aspas — necessário quando o nome tem
 *                                barra, ponto ou espaço
 *     $.paths['/users'].get      composição dos dois
 *     $.servers[0]               índice de array
 *     $.paths.*                  todos os filhos de um nível
 *     $.paths.*.get              todos os `get` de qualquer caminho
 *     $..parameters              descida recursiva
 *
 * ## Deliberadamente não suportado
 *
 *     $.paths[?(@.deprecated)]   filtros
 *     $.paths[(@.length-1)]      expressões de script
 *     $.paths['a','b']           união de chaves
 *     $.servers[0:2]             fatias
 *
 * Filtro e script são o motivo principal desta implementação existir em vez de
 * uma biblioteca: avaliá-los significa executar expressão vinda de um arquivo de
 * configuração, que é exatamente o que a spec § 41 pede para não fazer.
 *
 * ## A decisão que mais importa aqui
 *
 * Uma expressão fora do subconjunto **falha com mensagem**, em vez de encontrar
 * zero nós. As duas situações são visualmente idênticas num relatório — "0 nós
 * encontrados" — e mandam o autor investigar coisas opostas: no primeiro caso a
 * expressão está errada para esta ferramenta, no segundo o documento é que mudou.
 * Confundi-las custaria horas a quem estivesse depurando um overlay.
 */

export type Segment =
	| { kind: 'child'; name: string }
	| { kind: 'index'; index: number }
	| { kind: 'wildcard' }
	| { kind: 'descend' };

export class JsonPathError extends Error {}

/** Um nó encontrado, com o caminho por onde se chegou nele. */
export interface Match {
	/** Chaves desde a raiz: `['paths', '/users', 'get']`. */
	path: (string | number)[];
	value: unknown;
}

const UNSUPPORTED: Array<{ test: RegExp; what: string; hint: string }> = [
	{
		test: /\[\s*\?/,
		what: 'expressão de filtro',
		hint: 'Avaliar filtro significaria executar código vindo de um arquivo de configuração. Enderece os nós explicitamente.',
	},
	{
		test: /\[\s*\(/,
		what: 'expressão de script',
		hint: 'Mesma razão do filtro. Use um alvo literal.',
	},
	{
		test: /\[[^\]]*:[^\]]*\]/,
		what: 'fatia de array',
		hint: 'Use um índice por vez: `$.servers[0]`.',
	},
	{
		test: /\[[^\]]*,[^\]]*\]/,
		what: 'união de chaves',
		hint: 'Escreva uma ação por alvo — o relatório fica legível e a ordem das ações continua explícita.',
	},
];

/**
 * Traduz a expressão em segmentos.
 *
 * Lança em vez de devolver lista vazia: ver a nota sobre zero nós no cabeçalho.
 */
export function parsePath(expression: string): Segment[] {
	const source = expression.trim();

	if (source === '') throw new JsonPathError('Target vazio.');
	if (!source.startsWith('$')) {
		throw new JsonPathError(`Target precisa começar em \`$\`: recebido \`${expression}\`.`);
	}

	for (const { test, what, hint } of UNSUPPORTED) {
		if (test.test(source)) {
			throw new JsonPathError(
				`Target usa ${what}, que não faz parte do subconjunto de JSONPath suportado. ${hint}`
			);
		}
	}

	const segments: Segment[] = [];
	let index = 1;

	while (index < source.length) {
		const char = source[index];

		if (char === '.') {
			// `..` é descida recursiva; `.` sozinho é filho.
			if (source[index + 1] === '.') {
				segments.push({ kind: 'descend' });
				index += 2;
				// `$..['x']` é válido: a descida pode ser seguida de colchete.
				if (source[index] === '[') continue;
			} else {
				index += 1;
			}

			if (source[index] === '*') {
				segments.push({ kind: 'wildcard' });
				index += 1;
				continue;
			}

			const name = source.slice(index).match(/^[^.[]+/)?.[0];
			if (!name) throw new JsonPathError(`Nome de propriedade ausente após \`.\` em \`${expression}\`.`);
			segments.push({ kind: 'child', name });
			index += name.length;
			continue;
		}

		if (char === '[') {
			const close = source.indexOf(']', index);
			if (close === -1) throw new JsonPathError(`Colchete sem fechamento em \`${expression}\`.`);

			const inner = source.slice(index + 1, close).trim();
			index = close + 1;

			if (inner === '*') {
				segments.push({ kind: 'wildcard' });
				continue;
			}

			const quoted = inner.match(/^'(.*)'$/s) ?? inner.match(/^"(.*)"$/s);
			if (quoted) {
				segments.push({ kind: 'child', name: quoted[1] });
				continue;
			}

			if (/^\d+$/.test(inner)) {
				segments.push({ kind: 'index', index: Number(inner) });
				continue;
			}

			throw new JsonPathError(
				`Conteúdo de colchete não reconhecido: \`[${inner}]\`. Use \`['nome']\`, \`[0]\` ou \`[*]\`.`
			);
		}

		throw new JsonPathError(`Caractere inesperado \`${char}\` em \`${expression}\`.`);
	}

	return segments;
}

function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
	return typeof value === 'object' && value !== null;
}

/** Todos os descendentes de um nó, incluindo ele mesmo, em ordem de documento. */
function descendants(value: unknown, path: (string | number)[]): Match[] {
	const found: Match[] = [{ path, value }];
	if (!isContainer(value)) return found;

	const entries: Array<[string | number, unknown]> = Array.isArray(value)
		? value.map((item, position) => [position, item])
		: Object.entries(value);

	for (const [key, child] of entries) found.push(...descendants(child, [...path, key]));

	return found;
}

/**
 * Os nós que a expressão encontra, em ordem de documento.
 *
 * Lista vazia significa que o documento não tem o alvo — e só isso. Expressão
 * inválida lança.
 */
export function query(document: unknown, expression: string): Match[] {
	const segments = parsePath(expression);
	let current: Match[] = [{ path: [], value: document }];

	for (const segment of segments) {
		const next: Match[] = [];

		for (const match of current) {
			switch (segment.kind) {
				case 'child': {
					if (!isContainer(match.value) || Array.isArray(match.value)) break;
					if (!Object.prototype.hasOwnProperty.call(match.value, segment.name)) break;
					next.push({
						path: [...match.path, segment.name],
						value: (match.value as Record<string, unknown>)[segment.name],
					});
					break;
				}

				case 'index': {
					if (!Array.isArray(match.value)) break;
					if (segment.index >= match.value.length) break;
					next.push({ path: [...match.path, segment.index], value: match.value[segment.index] });
					break;
				}

				case 'wildcard': {
					if (!isContainer(match.value)) break;
					if (Array.isArray(match.value)) {
						match.value.forEach((item, position) =>
							next.push({ path: [...match.path, position], value: item })
						);
					} else {
						for (const [key, value] of Object.entries(match.value)) {
							next.push({ path: [...match.path, key], value });
						}
					}
					break;
				}

				case 'descend': {
					next.push(...descendants(match.value, match.path));
					break;
				}
			}
		}

		// Descida recursiva pode repetir um nó quando a expressão passa duas vezes
		// pelo mesmo ponto; deduplicar pelo caminho mantém uma ação por nó.
		const seen = new Set<string>();
		current = next.filter((match) => {
			const key = pointerOf(match.path);
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	}

	return current;
}

/**
 * Caminho como ponteiro JSON (RFC 6901): `/paths/~1users/get`.
 *
 * `~` e `/` são escapados porque caminho de endpoint tem barra — sem isso,
 * `/users` e `users` produziriam o mesmo ponteiro, e a proveniência apontaria
 * para o nó errado.
 */
export function pointerOf(path: (string | number)[]): string {
	if (path.length === 0) return '';
	return path
		.map((segment) => String(segment).replaceAll('~', '~0').replaceAll('/', '~1'))
		.map((segment) => `/${segment}`)
		.join('');
}

/** O contêiner que guarda o nó, e a chave sob a qual ele está. */
export function parentOf(
	document: unknown,
	path: (string | number)[]
): { parent: Record<string, unknown> | unknown[]; key: string | number } | null {
	if (path.length === 0) return null;

	let node: unknown = document;
	for (const segment of path.slice(0, -1)) {
		if (!isContainer(node)) return null;
		node = (node as Record<string, unknown>)[segment as string];
	}

	if (!isContainer(node)) return null;
	return { parent: node, key: path[path.length - 1] };
}
