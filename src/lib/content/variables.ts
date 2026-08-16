/**
 * Fase 5 — variáveis de conteúdo (condicionais).
 *
 * Módulo puro, compartilhado por três consumidores:
 *  - `src/components/content/If.astro`, no build do site publicado;
 *  - o resolver do preview do editor (`remark-resolve-conditionals.ts`);
 *  - a UI do editor (modal de variáveis, validação).
 *
 * A definição das variáveis mora em `src/config/content-variables.json`, que é
 * um arquivo versionado em Git como qualquer outro — o editor sabe escrevê-lo,
 * mas ele continua editável à mão.
 */

export type VariableValue = boolean | string;

export interface VariableDefinition {
	value: VariableValue;
	description?: string;
}

export type VariableMap = Record<string, VariableDefinition>;

export interface Condition {
	/** Nome da variável consultada. */
	flag: string;
	/** Quando presente, compara o valor da variável com esta string. */
	equals?: string;
	/** Inverte o resultado. */
	not?: boolean;
}

/**
 * Aceita tanto a forma completa (`{ value, description }`) quanto o atalho
 * (`"beta": true`), porque escrever o JSON à mão é um caso de uso de primeira
 * classe — o editor não é dono do arquivo.
 */
export function normalizeVariables(raw: unknown): VariableMap {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

	const result: VariableMap = {};
	for (const [name, entry] of Object.entries(raw as Record<string, unknown>)) {
		if (typeof entry === 'boolean' || typeof entry === 'string') {
			result[name] = { value: entry };
			continue;
		}
		if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
			const candidate = entry as { value?: unknown; description?: unknown };
			const value = candidate.value;
			if (typeof value === 'boolean' || typeof value === 'string') {
				result[name] = {
					value,
					description: typeof candidate.description === 'string' ? candidate.description : undefined,
				};
			}
		}
	}
	return result;
}

/** `true` quando a variável existe e está "ligada". */
export function isTruthy(variables: VariableMap, flag: string): boolean {
	const definition = variables[flag];
	if (!definition) return false;
	if (typeof definition.value === 'boolean') return definition.value;
	return definition.value.trim() !== '';
}

/**
 * Avalia uma condição.
 *
 * Uma variável **inexistente** avalia como falso: um trecho condicionado a algo
 * que ninguém definiu fica oculto, em vez de vazar por acidente. O editor
 * reporta isso separadamente como problema, para o erro não passar silencioso.
 */
export function isConditionMet(variables: VariableMap, condition: Condition): boolean {
	const { flag, equals, not = false } = condition;

	let met: boolean;
	if (equals !== undefined) {
		const definition = variables[flag];
		met = definition !== undefined && String(definition.value) === equals;
	} else {
		met = isTruthy(variables, flag);
	}

	return not ? !met : met;
}

export function isKnownVariable(variables: VariableMap, flag: string): boolean {
	return Object.prototype.hasOwnProperty.call(variables, flag);
}

/**
 * Nomes de variável são usados em atributos JSX e em frontmatter, então vale
 * manter o conjunto de caracteres estreito e previsível.
 */
export const VARIABLE_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

export function isValidVariableName(name: string): boolean {
	return VARIABLE_NAME_RE.test(name);
}

// ---------------------------------------------------------------------------
// Visibilidade de página
// ---------------------------------------------------------------------------

export interface PageVisibilityFields {
	/** `false` publica a página mas a esconde do leitor. */
	visible?: unknown;
	/** Nome de variável: a página só fica visível quando ela estiver ligada. */
	showIf?: unknown;
}

export type HiddenReason = 'visible-false' | 'condition-off' | null;

/**
 * Decide se uma página deve ficar escondida do leitor, e por quê.
 *
 * "Escondida" aqui quer dizer: fora da navegação e fora da busca, mas ainda
 * publicada e acessível por URL direta — é o comportamento pedido para
 * `visible: false`, e `showIf` reaproveita exatamente a mesma máquina.
 */
export function hiddenReasonFor(frontmatter: PageVisibilityFields, variables: VariableMap): HiddenReason {
	if (frontmatter.visible === false) return 'visible-false';

	const showIf = frontmatter.showIf;
	if (typeof showIf === 'string' && showIf.trim() !== '') {
		const negated = showIf.startsWith('!');
		const flag = negated ? showIf.slice(1).trim() : showIf.trim();
		if (!isConditionMet(variables, { flag, not: negated })) return 'condition-off';
	}

	return null;
}

export function isPageHidden(frontmatter: PageVisibilityFields, variables: VariableMap): boolean {
	return hiddenReasonFor(frontmatter, variables) !== null;
}
