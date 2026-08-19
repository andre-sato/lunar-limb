/**
 * Testes do Documentation Time Machine (P2.1).
 *
 * A parte com valor real aqui é o **semantic diff** e a honestidade da
 * reconstrução. O que a spec pede — "identificar mudanças de comportamento" — é
 * fácil de implementar mal: basta declarar que qualquer linha alterada é uma
 * mudança de comportamento, e o relatório fica cheio e inútil.
 *
 * Por isso quase todo teste abaixo tem um par: um caso que **deve** ser detectado
 * e um que **não** deve.
 */

import { describe, it, expect } from 'vitest';
import {
	extractAuthMechanisms,
	extractEndpoints,
	extractRequiredFields,
	extractStatusCodes,
	extractValues,
	semanticDiff,
} from '../src/lib/history/semantic';
import { pullRequestOf } from '../src/lib/history/git';

// ---------------------------------------------------------------------------
// Extração
// ---------------------------------------------------------------------------

describe('extração de valores', () => {
	it('reconhece número com unidade e o assunto ao lado', () => {
		const values = extractValues('A chave de API expira após 90 dias.');
		expect(values).toHaveLength(1);
		expect(values[0]).toMatchObject({ value: '90', unit: 'dias' });
		expect(values[0].subject).toContain('expira');
	});

	it('normaliza a unidade entre idiomas', () => {
		expect(extractValues('expires after 90 days')[0].unit).toBe('dias');
		expect(extractValues('expira após 90 dias')[0].unit).toBe('dias');
	});

	it('ignora número solto sem unidade', () => {
		// Sem unidade não há como saber se aquilo é um prazo, uma porta ou um
		// exemplo de id — e adivinhar encheria o relatório de ruído.
		expect(extractValues('O identificador é 12345.')).toEqual([]);
	});
});

describe('extração de campos obrigatórios', () => {
	it('lê a lista em bloco YAML', () => {
		expect(extractRequiredFields('required:\n  - amount\n  - currency\n')).toEqual(['amount', 'currency']);
	});

	it('lê a lista em linha', () => {
		expect(extractRequiredFields('required: [client_id, client_secret]')).toEqual(['client_id', 'client_secret']);
	});

	it('texto sem declaração não produz campo', () => {
		expect(extractRequiredFields('O campo amount é necessário.')).toEqual([]);
	});
});

describe('extração de endpoint, status e autenticação', () => {
	it('reconhece endpoints', () => {
		expect(extractEndpoints('Chame POST /payments e GET /payments/{id}.')).toEqual([
			'GET /payments/{id}',
			'POST /payments',
		]);
	});

	it('reconhece códigos de status', () => {
		expect(extractStatusCodes('Devolve 200, 401 ou 404.')).toEqual(['200', '401', '404']);
	});

	it('reconhece o mecanismo de autenticação pelo cabeçalho', () => {
		expect(extractAuthMechanisms('Authorization: Bearer abc')).toEqual(['Bearer']);
		expect(extractAuthMechanisms('Cookie: portal_session=abc')).toEqual(['Cookie: portal_session']);
	});
});

// ---------------------------------------------------------------------------
// Semantic diff
// ---------------------------------------------------------------------------

describe('semantic diff', () => {
	it('detecta o caso da spec: 30 dias vira 90 dias', () => {
		const changes = semanticDiff('A chave de API expira após 30 dias.', 'A chave de API expira após 90 dias.');

		expect(changes).toHaveLength(1);
		expect(changes[0]).toMatchObject({ kind: 'value', before: '30 dias', after: '90 dias' });
	});

	it('detecta campo obrigatório acrescentado', () => {
		const changes = semanticDiff('required:\n  - client_id\n', 'required:\n  - client_id\n  - client_secret\n');

		expect(changes[0]).toMatchObject({ kind: 'required-field' });
		expect(changes[0].after).toContain('client_secret');
	});

	it('campo obrigatório tem confiança maior que valor inferido', () => {
		// Lista `required:` é estrutura declarada; o assunto de um número vem das
		// palavras vizinhas, que é heurística.
		const required = semanticDiff('required: [a]', 'required: [a, b]')[0];
		const value = semanticDiff('espera 30 dias', 'espera 90 dias')[0];

		expect(required.confidence).toBeGreaterThan(value.confidence);
	});

	it('detecta endpoint que passou a ser documentado', () => {
		const changes = semanticDiff('Nada aqui.', 'Chame POST /refunds para estornar.');
		expect(changes.some((change) => change.kind === 'endpoint' && change.subject === 'POST /refunds')).toBe(true);
	});

	it('detecta endpoint que deixou de ser documentado', () => {
		const changes = semanticDiff('Chame POST /refunds.', 'Nada aqui.');
		expect(changes.find((change) => change.kind === 'endpoint')?.before).toBe('era documentado');
	});

	it('detecta troca de mecanismo de autenticação', () => {
		const changes = semanticDiff('Authorization: Bearer abc', 'X-API-Key: abc');
		expect(changes.some((change) => change.kind === 'authentication')).toBe(true);
	});

	it('reescrita em prosa sem mudança de comportamento não vira achado', () => {
		// É o teste que impede a implementação preguiçosa: declarar toda linha
		// alterada como mudança de comportamento encheria o relatório e o tornaria
		// inútil.
		const before = 'Use o cabeçalho para enviar a credencial em cada chamada.';
		const after = 'Envie a credencial pelo cabeçalho, em toda requisição.';
		expect(semanticDiff(before, after)).toEqual([]);
	});

	it('texto idêntico não produz mudança', () => {
		expect(semanticDiff('A chave expira após 90 dias.', 'A chave expira após 90 dias.')).toEqual([]);
	});

	it('valor com assunto diferente não é confundido com o mesmo', () => {
		// Duas frases com "30 dias" e "90 dias" sobre coisas diferentes: nenhuma
		// mudou, e o diff não pode inventar uma.
		const text = 'A chave expira após 30 dias. O log é retido por 90 dias.';
		expect(semanticDiff(text, text)).toEqual([]);
	});

	it('ordena por confiança, do mais seguro para o menos', () => {
		const changes = semanticDiff(
			'required: [a]\nespera 30 dias\nDevolve 200.',
			'required: [a, b]\nespera 90 dias\nDevolve 200, 404.'
		);

		for (let index = 1; index < changes.length; index++) {
			expect(changes[index - 1].confidence).toBeGreaterThanOrEqual(changes[index].confidence);
		}
	});

	it('todo achado declara a confiança', () => {
		const changes = semanticDiff('required: [a]\nespera 30 dias', 'required: [a, b]\nespera 90 dias');
		expect(changes.every((change) => change.confidence > 0 && change.confidence <= 1)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Correlação
// ---------------------------------------------------------------------------

describe('correlação com pull request', () => {
	it('reconhece a convenção do provedor', () => {
		expect(pullRequestOf('Corrige a autenticação (#842)')).toBe(842);
		expect(pullRequestOf('Merge pull request 123 from feature/x')).toBe(123);
	});

	it('assunto sem referência não inventa número', () => {
		expect(pullRequestOf('Atualiza a documentação de pagamentos')).toBeUndefined();
	});
});
