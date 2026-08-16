import { describe, expect, it } from 'vitest';
import {
	hiddenReasonFor,
	isConditionMet,
	isKnownVariable,
	isPageHidden,
	isTruthy,
	isValidVariableName,
	normalizeVariables,
	type VariableMap,
} from '../src/lib/content/variables';

const vars: VariableMap = {
	beta: { value: true },
	interno: { value: false },
	plano: { value: 'enterprise' },
	vazio: { value: '' },
};

describe('normalizeVariables', () => {
	it('aceita a forma completa', () => {
		expect(normalizeVariables({ beta: { value: true, description: 'x' } })).toEqual({
			beta: { value: true, description: 'x' },
		});
	});

	it('aceita o atalho sem objeto — escrever o JSON à mão é caso de uso', () => {
		expect(normalizeVariables({ beta: true, plano: 'pro' })).toEqual({
			beta: { value: true },
			plano: { value: 'pro' },
		});
	});

	it('descarta entradas com valor inutilizável em vez de quebrar', () => {
		expect(normalizeVariables({ ok: true, ruim: { value: { a: 1 } }, pior: [1, 2] })).toEqual({
			ok: { value: true },
		});
	});

	it('devolve mapa vazio para entrada não-objeto', () => {
		expect(normalizeVariables(null)).toEqual({});
		expect(normalizeVariables([1, 2])).toEqual({});
		expect(normalizeVariables('texto')).toEqual({});
	});
});

describe('isTruthy', () => {
	it('booleana segue o próprio valor', () => {
		expect(isTruthy(vars, 'beta')).toBe(true);
		expect(isTruthy(vars, 'interno')).toBe(false);
	});

	it('string não vazia é verdadeira; string vazia é falsa', () => {
		expect(isTruthy(vars, 'plano')).toBe(true);
		expect(isTruthy(vars, 'vazio')).toBe(false);
	});

	it('variável inexistente é falsa', () => {
		expect(isTruthy(vars, 'nao-existe')).toBe(false);
	});
});

describe('isConditionMet', () => {
	it('mostra o trecho quando a flag está ligada', () => {
		expect(isConditionMet(vars, { flag: 'beta' })).toBe(true);
		expect(isConditionMet(vars, { flag: 'interno' })).toBe(false);
	});

	it('`not` inverte', () => {
		expect(isConditionMet(vars, { flag: 'beta', not: true })).toBe(false);
		expect(isConditionMet(vars, { flag: 'interno', not: true })).toBe(true);
	});

	it('`equals` compara o valor', () => {
		expect(isConditionMet(vars, { flag: 'plano', equals: 'enterprise' })).toBe(true);
		expect(isConditionMet(vars, { flag: 'plano', equals: 'starter' })).toBe(false);
	});

	it('`equals` combinado com `not`', () => {
		expect(isConditionMet(vars, { flag: 'plano', equals: 'starter', not: true })).toBe(true);
	});

	it('`equals` funciona sobre variável booleana', () => {
		expect(isConditionMet(vars, { flag: 'beta', equals: 'true' })).toBe(true);
		expect(isConditionMet(vars, { flag: 'beta', equals: 'false' })).toBe(false);
	});

	/**
	 * Regra de segurança: o padrão de uma variável desconhecida é ESCONDER.
	 * Um trecho marcado como interno não pode vazar porque alguém errou o nome
	 * da variável ou apagou a definição.
	 */
	it('variável inexistente esconde o trecho', () => {
		expect(isConditionMet(vars, { flag: 'digitei-errado' })).toBe(false);
	});

	it('mas com `not` a variável inexistente mostra — a negação continua coerente', () => {
		expect(isConditionMet(vars, { flag: 'digitei-errado', not: true })).toBe(true);
	});

	it('isKnownVariable distingue "desligada" de "inexistente"', () => {
		expect(isKnownVariable(vars, 'interno')).toBe(true);
		expect(isKnownVariable(vars, 'digitei-errado')).toBe(false);
	});
});

describe('isValidVariableName', () => {
	it('aceita nomes usáveis em atributos JSX', () => {
		expect(isValidVariableName('beta')).toBe(true);
		expect(isValidVariableName('plano-do-cliente')).toBe(true);
		expect(isValidVariableName('feature_2')).toBe(true);
	});

	it('recusa o que quebraria a tag ou o YAML', () => {
		expect(isValidVariableName('')).toBe(false);
		expect(isValidVariableName('2fatores')).toBe(false);
		expect(isValidVariableName('com espaço')).toBe(false);
		expect(isValidVariableName('aspas"aqui')).toBe(false);
	});
});

describe('visibilidade de página', () => {
	it('sem campo nenhum, a página é visível', () => {
		expect(hiddenReasonFor({}, vars)).toBeNull();
		expect(isPageHidden({}, vars)).toBe(false);
	});

	it('visible: false esconde', () => {
		expect(hiddenReasonFor({ visible: false }, vars)).toBe('visible-false');
	});

	it('visible: true é explicitamente visível', () => {
		expect(hiddenReasonFor({ visible: true }, vars)).toBeNull();
	});

	it('showIf com variável ligada mantém visível', () => {
		expect(hiddenReasonFor({ showIf: 'beta' }, vars)).toBeNull();
	});

	it('showIf com variável desligada esconde', () => {
		expect(hiddenReasonFor({ showIf: 'interno' }, vars)).toBe('condition-off');
	});

	it('showIf com "!" inverte', () => {
		expect(hiddenReasonFor({ showIf: '!interno' }, vars)).toBeNull();
		expect(hiddenReasonFor({ showIf: '!beta' }, vars)).toBe('condition-off');
	});

	it('showIf apontando para variável inexistente esconde', () => {
		expect(hiddenReasonFor({ showIf: 'nunca-definida' }, vars)).toBe('condition-off');
	});

	it('visible: false vence showIf ligado', () => {
		expect(hiddenReasonFor({ visible: false, showIf: 'beta' }, vars)).toBe('visible-false');
	});

	it('showIf vazio ou não-string é ignorado', () => {
		expect(hiddenReasonFor({ showIf: '   ' }, vars)).toBeNull();
		expect(hiddenReasonFor({ showIf: 42 }, vars)).toBeNull();
	});
});
