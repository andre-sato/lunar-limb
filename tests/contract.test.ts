/**
 * Testes de Documentation Contract Testing.
 *
 * A pergunta desta camada é diferente da do Documentation Test Suite:
 *
 *     Documentation Test  →  "este exemplo funciona?"
 *     Contract Test       →  "este exemplo representa o contrato de verdade?"
 *
 * O exemplo da spec resume tudo: uma API exige `amount` e `currency`, a
 * documentação mostra só `amount`. O exemplo até roda; está incompleto em relação
 * ao contrato. Nenhum teste de execução pega isso.
 */

import { describe, it, expect } from 'vitest';
import {
	authMechanismOf,
	checkAuthentication,
	checkCliExample,
	checkCodeExample,
	checkMethodAndPath,
	checkParameters,
	checkRequestExample,
	checkResponseExample,
	checkStatusCodes,
	compareWithSchema,
	couldCarryCredential,
	extractObjectKeys,
	type SchemaLike,
} from '../src/lib/contract/assertions';
import {
	extractCodeBlocks,
	extractCommands,
	extractCurlRequests,
	extractHttpRequests,
	extractJsonBlocks,
	extractParameterMentions,
	extractStatusMentions,
	parseDeclaredContract,
} from '../src/lib/contract/extract';
import { scoreContracts } from '../src/lib/contract/engine';
import { worstContractStatus, type DocumentationContract } from '../src/lib/contract/types';
import type { ApiOperation } from '../src/lib/api-explorer/model';

function operation(partial: Partial<ApiOperation> = {}): ApiOperation {
	return {
		id: 'createPayment',
		method: 'post',
		path: '/payments',
		tags: [],
		parameters: [],
		responses: [{ status: '201', description: 'criado' }],
		security: [],
		deprecated: false,
		...partial,
	};
}

const PAYMENT_SCHEMA: SchemaLike = {
	type: 'object',
	required: ['amount', 'currency'],
	properties: { amount: { type: 'number' }, currency: { type: 'string' } },
};

// ---------------------------------------------------------------------------
// Comparação com o schema (§10, §11)
// ---------------------------------------------------------------------------

describe('comparação com o schema', () => {
	it('o exemplo da spec: falta `currency`', () => {
		const violations = compareWithSchema({ amount: 100 }, PAYMENT_SCHEMA);
		expect(violations).toHaveLength(1);
		expect(violations[0]).toMatchObject({ kind: 'missing-required' });
		expect(violations[0].message).toContain('currency');
	});

	it('campo que o contrato não tem é acusado — é assim que a documentação envelhece', () => {
		// O sentido que um teste de execução nunca cobre: o exemplo continua
		// mostrando um campo que a API removeu, e tudo continua "passando".
		const violations = compareWithSchema({ amount: 100, currency: 'BRL', taxa: 3 }, PAYMENT_SCHEMA);
		expect(violations[0]).toMatchObject({ kind: 'unknown-property' });
	});

	it('tipo errado é acusado', () => {
		expect(compareWithSchema({ amount: '100', currency: 'BRL' }, PAYMENT_SCHEMA)[0].kind).toBe('wrong-type');
	});

	it('inteiro exigido rejeita fracionário', () => {
		expect(compareWithSchema(1.5, { type: 'integer' })[0].kind).toBe('wrong-type');
	});

	it('enum inválido é acusado', () => {
		expect(compareWithSchema('pix', { type: 'string', enum: ['card', 'boleto'] })[0].kind).toBe('bad-enum');
	});

	it('schema sem `properties` não reclama de campo extra', () => {
		// Objeto livre é comum em resposta genérica; acusar tudo viraria ruído.
		expect(compareWithSchema({ qualquer: 1 }, { type: 'object' })).toEqual([]);
	});

	it('exemplo correto não gera violação', () => {
		expect(compareWithSchema({ amount: 100, currency: 'BRL' }, PAYMENT_SCHEMA)).toEqual([]);
	});
});

describe('requisição e resposta', () => {
	it('campo obrigatório ausente quebra o contrato', () => {
		const assertions = checkRequestExample({ value: { amount: 100 } }, PAYMENT_SCHEMA);
		expect(assertions[0]).toMatchObject({ id: 'CONTRACT-REQ-001', status: 'invalid' });
	});

	it('campo a mais na requisição é aviso, não quebra', () => {
		// Pode ser extensão aceita pelo servidor; reprovar travaria documentação
		// legítima.
		const assertions = checkRequestExample({ value: { amount: 1, currency: 'BRL', extra: true } }, PAYMENT_SCHEMA);
		expect(assertions[0].status).toBe('warning');
	});

	it('campo a mais na resposta quebra: promete ao leitor um dado que não vem', () => {
		const assertions = checkResponseExample({ value: { id: '1', extra: true } }, { type: 'object', properties: { id: { type: 'string' } } }, '200');
		expect(assertions[0]).toMatchObject({ id: 'CONTRACT-RES-002', status: 'invalid' });
	});

	it('sem schema, o resultado é desconhecido — não válido', () => {
		expect(checkRequestExample({ value: {} }, undefined)[0].status).toBe('unknown');
		expect(checkResponseExample({ value: {} }, undefined, '200')[0].status).toBe('unknown');
	});
});

// ---------------------------------------------------------------------------
// Método, caminho, parâmetros, status (§8)
// ---------------------------------------------------------------------------

describe('método e caminho', () => {
	it('confere os dois contra o contrato, com o prefixo do servidor', () => {
		const assertions = checkMethodAndPath({ method: 'POST', path: '/api/payments' }, operation(), '/api');
		expect(assertions.every((assertion) => assertion.status === 'valid')).toBe(true);
	});

	it('método divergente quebra', () => {
		const assertions = checkMethodAndPath({ method: 'PUT', path: '/api/payments' }, operation(), '/api');
		expect(assertions[0]).toMatchObject({ id: 'CONTRACT-MET-001', status: 'invalid', expected: 'POST' });
	});
});

describe('parâmetros', () => {
	const parameters = [
		{ name: 'limit', location: 'query' as const, required: true, type: 'integer' },
		{ name: 'cursor', location: 'query' as const, required: false, type: 'string' },
	];

	it('parâmetro inexistente no contrato quebra', () => {
		const assertions = checkParameters(['pagina'], parameters);
		expect(assertions[0]).toMatchObject({ id: 'CONTRACT-PAR-001', status: 'invalid' });
	});

	it('obrigatório ausente na página é aviso: um guia não é a referência', () => {
		const assertions = checkParameters(['cursor'], parameters);
		expect(assertions.some((assertion) => assertion.status === 'warning')).toBe(true);
		expect(assertions.some((assertion) => assertion.status === 'invalid')).toBe(false);
	});

	it('tudo certo devolve uma asserção válida', () => {
		expect(checkParameters(['limit', 'cursor'], parameters)[0].status).toBe('valid');
	});
});

describe('códigos de status', () => {
	it('status não declarado vira aviso', () => {
		const assertions = checkStatusCodes(['201', '418'], operation());
		expect(assertions[0]).toMatchObject({ status: 'warning', actual: '418' });
	});

	it('página sem status citado fica desconhecida', () => {
		expect(checkStatusCodes([], operation())[0].status).toBe('unknown');
	});
});

// ---------------------------------------------------------------------------
// Autenticação (§12)
// ---------------------------------------------------------------------------

describe('autenticação', () => {
	const index = new Map([['sessionCookie', { kind: 'apiKey', name: 'portal_session', in: 'cookie' }]]);
	const secured = operation({ security: [{ id: 'sessionCookie', kind: 'apiKey', in: 'cookie', name: 'portal_session' }] });

	it('reconhece o cookie pelo nome, não pela palavra "Cookie"', () => {
		// O caso que a primeira execução contra o portal expôs: o esquema declara
		// `in: cookie, name: portal_session`, e a página mostra `Cookie: …`.
		expect(authMechanismOf('Cookie', 'portal_session=abc')).toEqual(['apiKey:portal_session']);
	});

	it('reconhece bearer e basic', () => {
		expect(authMechanismOf('Authorization', 'Bearer abc')).toEqual(['http-bearer']);
		expect(authMechanismOf('Authorization', 'Basic abc')).toEqual(['http-basic']);
	});

	it('mecanismo divergente quebra', () => {
		const assertions = checkAuthentication([{ header: 'X-API-Key', value: 'abc' }], secured, index);
		expect(assertions[0]).toMatchObject({ id: 'CONTRACT-AUTH-001', status: 'invalid' });
	});

	it('mecanismo correto passa', () => {
		const assertions = checkAuthentication([{ header: 'Cookie', value: 'portal_session=abc' }], secured, index);
		expect(assertions[0].status).toBe('valid');
	});

	it('operação sem autenticação declarada fica desconhecida', () => {
		expect(checkAuthentication([], operation(), index)[0].status).toBe('unknown');
	});

	it('cabeçalho que não carrega credencial não entra na comparação', () => {
		// `Content-Type` num relatório de autenticação é ruído, e ruído dentro de
		// uma linha de erro é o que faz alguém parar de ler a linha.
		expect(couldCarryCredential('Content-Type', index)).toBe(false);
		expect(couldCarryCredential('Authorization', index)).toBe(true);
		expect(couldCarryCredential('portal_session', index)).toBe(true);
		expect(couldCarryCredential('X-Api-Key', index)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Exemplos de código e CLI (§13, §14)
// ---------------------------------------------------------------------------

describe('exemplo de código', () => {
	it('detecta o campo renomeado pelo SDK', () => {
		const assertions = checkCodeExample('client.payments.create({ value: 100, currency: "BRL" });', PAYMENT_SCHEMA);
		expect(assertions[0]).toMatchObject({ status: 'invalid', actual: 'value', expected: 'amount' });
	});

	it('exemplo alinhado passa', () => {
		expect(checkCodeExample('client.payments.create({ amount: 100, currency: "BRL" });', PAYMENT_SCHEMA)[0].status).toBe('valid');
	});

	it('sem schema não há o que comparar', () => {
		expect(checkCodeExample('qualquer()', undefined)[0].status).toBe('unknown');
	});

	it('extrai as chaves de um literal de objeto', () => {
		expect(extractObjectKeys('{ amount: 1, "currency": "BRL" }').sort()).toEqual(['amount', 'currency']);
	});
});

describe('exemplo de CLI', () => {
	it('opção inexistente quebra', () => {
		const assertions = checkCliExample(['--environment'], ['--env', '--verbose']);
		expect(assertions[0]).toMatchObject({ id: 'CONTRACT-CLI-001', status: 'invalid' });
	});

	it('sem saber as opções do comando, o resultado é desconhecido', () => {
		expect(checkCliExample(['--x'], [])[0].status).toBe('unknown');
	});
});

// ---------------------------------------------------------------------------
// Extração (§7, §15)
// ---------------------------------------------------------------------------

describe('extração da documentação', () => {
	const page = [
		'---',
		'title: Pagamentos',
		'contract:',
		'  type: openapi',
		'  ref: "#/paths/~1payments/post"',
		'---',
		'',
		'```http',
		'POST /api/payments',
		'Content-Type: application/json',
		'Authorization: Bearer abc',
		'',
		'{ "amount": 100, "currency": "BRL" }',
		'```',
		'',
		'```json',
		'{ "id": "1" }',
		'```',
		'',
		'```bash',
		'curl -X POST https://api.exemplo.com/api/payments \\',
		"  -H 'Authorization: Bearer abc' \\",
		"  -d '{\"amount\": 100}'",
		'```',
	].join('\n');

	it('lê o contrato declarado no frontmatter', () => {
		expect(parseDeclaredContract(page)).toMatchObject({ type: 'openapi', ref: '#/paths/~1payments/post' });
	});

	it('página sem declaração devolve nulo', () => {
		expect(parseDeclaredContract('---\ntitle: X\n---\n')).toBeNull();
	});

	it('extrai a requisição HTTP com cabeçalhos e corpo', () => {
		const requests = extractHttpRequests(extractCodeBlocks(page));
		expect(requests[0]).toMatchObject({ method: 'POST', path: '/api/payments' });
		expect(requests[0].headers.map((header) => header.header)).toContain('Authorization');
		expect(requests[0].body).toEqual({ amount: 100, currency: 'BRL' });
	});

	it('cabeçalho sobrevive a CRLF', () => {
		// Em JavaScript, `$` não casa antes de `\r` e `.` não consome `\r`. Sem
		// normalizar, a extração de cabeçalhos devolvia lista vazia em **todo**
		// arquivo de um checkout no Windows — que é como este repositório está.
		const crlf = ['```http', 'POST /api/payments', 'Authorization: Bearer abc', '', '{}', '```'].join('\r\n');
		const requests = extractHttpRequests(extractCodeBlocks(crlf));
		expect(requests[0].headers).toHaveLength(1);
	});

	it('extrai a requisição em cURL', () => {
		const requests = extractCurlRequests(extractCodeBlocks(page));
		expect(requests[0]).toMatchObject({ method: 'POST', path: '/api/payments' });
		expect(requests[0].body).toEqual({ amount: 100 });
	});

	it('o host do exemplo não entra na comparação', () => {
		// `api.exemplo.com` é host de exemplo; comparar hosts transformaria toda
		// documentação neutra em contrato quebrado.
		expect(extractCurlRequests(extractCodeBlocks(page))[0].path).toBe('/api/payments');
	});

	it('extrai blocos JSON, parâmetros e status', () => {
		expect(extractJsonBlocks(extractCodeBlocks(page))[0].value).toEqual({ id: '1' });
		expect(extractParameterMentions('Use `?limit=10` e `{id}`.').sort()).toEqual(['id', 'limit']);
		expect(extractStatusMentions('Devolve 200 ou 404.').sort()).toEqual(['200', '404']);
	});

	it('extrai comandos com opções longas', () => {
		const blocks = extractCodeBlocks('```bash\nlunar deploy --environment production\n```');
		expect(extractCommands(blocks, 'lunar')[0].options).toEqual(['--environment']);
	});

	it('bloco JSON inválido é ignorado em vez de derrubar a leitura', () => {
		expect(extractJsonBlocks(extractCodeBlocks('```json\n{ "a": ... }\n```'))).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Score e status (§16, §18)
// ---------------------------------------------------------------------------

describe('score de contrato', () => {
	const contract = (assertions: DocumentationContract['assertions']): DocumentationContract => ({
		id: 'POST /payments',
		source: { type: 'openapi', path: 'a.yaml', pointer: '#/x' },
		documentation: [],
		assertions,
		status: worstContractStatus(assertions.map((assertion) => assertion.status)),
	});

	it('só conta o que foi verificado', () => {
		// `unknown` fora da conta: contá-lo como erro puniria a ausência de
		// contrato, e como acerto premiaria a mesma ausência.
		const score = scoreContracts([
			contract([
				{ id: 'A', dimension: 'method', status: 'valid', message: '' },
				{ id: 'B', dimension: 'request', status: 'unknown', message: '' },
			]),
		]);

		expect(score.value).toBe(100);
		expect(score.byDimension.map((entry) => entry.dimension)).toEqual(['method']);
	});

	it('aviso conta como verificado e não como bom', () => {
		const score = scoreContracts([
			contract([
				{ id: 'A', dimension: 'method', status: 'valid', message: '' },
				{ id: 'B', dimension: 'request', status: 'warning', message: '' },
			]),
		]);
		expect(score.value).toBe(50);
	});

	it('nada verificado resulta em zero', () => {
		expect(scoreContracts([]).value).toBe(0);
	});

	it('o pior status decide o do contrato', () => {
		expect(worstContractStatus(['valid', 'warning'])).toBe('warning');
		expect(worstContractStatus(['valid', 'warning', 'invalid'])).toBe('invalid');
		expect(worstContractStatus(['valid', 'unknown'])).toBe('unknown');
		expect(worstContractStatus([])).toBe('unknown');
	});
});
