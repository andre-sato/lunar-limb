/**
 * As verificações de contrato (§8, §10, §11, §12, §13, §14).
 *
 * Puras: recebem o contrato já interpretado e o que a documentação mostra, e
 * devolvem asserções. Nada de disco, nada de rede — o que permite testar cada
 * regra isolada, que é o único jeito de confiar num portão que bloqueia merge.
 *
 * Os identificadores seguem o formato da spec (`CONTRACT-REQ-001`) porque eles
 * aparecem no PR e em CI, e um código estável é o que permite silenciar uma regra
 * específica sem desligar a camada inteira.
 */

import type { ApiOperation, ApiParameter } from '../api-explorer/model';
import type { ContractAssertion, ContractStatus } from './types';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export interface SchemaLike {
	type?: string;
	required?: string[];
	properties?: Record<string, SchemaLike>;
	items?: SchemaLike;
	enum?: unknown[];
	nullable?: boolean;
}

export interface SchemaViolation {
	pointer: string;
	kind: 'missing-required' | 'unknown-property' | 'wrong-type' | 'bad-enum';
	message: string;
}

function describe(value: unknown): string {
	if (value === null) return 'null';
	if (Array.isArray(value)) return 'array';
	return typeof value;
}

/**
 * Compara um exemplo com um schema, nos dois sentidos.
 *
 * O sentido que a Documentation Test Suite já cobria é "o exemplo satisfaz o
 * schema". O que falta, e é o motivo desta camada existir, é o inverso: **campo
 * que o exemplo mostra e o contrato não tem**. É assim que uma documentação
 * envelhece sem quebrar — ela continua mostrando um campo que a API removeu, e
 * todo teste de execução continua passando.
 */
export function compareWithSchema(value: unknown, schema: SchemaLike | undefined, pointer = ''): SchemaViolation[] {
	if (!schema) return [];
	const violations: SchemaViolation[] = [];
	const at = pointer || '(raiz)';

	if (schema.enum && !schema.enum.includes(value as never)) {
		return [{ pointer: at, kind: 'bad-enum', message: `valor fora do enum: ${JSON.stringify(value)}` }];
	}

	switch (schema.type) {
		case 'object': {
			if (value === null || typeof value !== 'object' || Array.isArray(value)) {
				return [{ pointer: at, kind: 'wrong-type', message: `esperava objeto, veio ${describe(value)}` }];
			}

			const record = value as Record<string, unknown>;

			for (const field of schema.required ?? []) {
				if (!(field in record)) {
					violations.push({
						pointer: `${pointer}/${field}`,
						kind: 'missing-required',
						message: `campo obrigatório ausente: \`${field}\``,
					});
				}
			}

			const properties = schema.properties ?? {};

			for (const [key, child] of Object.entries(record)) {
				const declared = properties[key];
				if (!declared) {
					// Só acusa quando o schema declara propriedades: um schema sem
					// `properties` costuma ser um objeto livre, e reclamar dele
					// encheria o relatório de ruído.
					if (Object.keys(properties).length > 0) {
						violations.push({
							pointer: `${pointer}/${key}`,
							kind: 'unknown-property',
							message: `o exemplo mostra \`${key}\`, que não existe no contrato`,
						});
					}
					continue;
				}
				violations.push(...compareWithSchema(child, declared, `${pointer}/${key}`));
			}
			break;
		}

		case 'array': {
			if (!Array.isArray(value)) {
				return [{ pointer: at, kind: 'wrong-type', message: `esperava array, veio ${describe(value)}` }];
			}
			value.forEach((item, index) => violations.push(...compareWithSchema(item, schema.items, `${pointer}/${index}`)));
			break;
		}

		case 'string':
		case 'number':
		case 'integer':
		case 'boolean': {
			if (value === null && schema.nullable) break;
			const expected = schema.type === 'integer' ? 'number' : schema.type;
			if (describe(value) !== expected) {
				violations.push({ pointer: at, kind: 'wrong-type', message: `esperava ${schema.type}, veio ${describe(value)}` });
			} else if (schema.type === 'integer' && !Number.isInteger(value)) {
				violations.push({ pointer: at, kind: 'wrong-type', message: 'esperava inteiro' });
			}
			break;
		}
	}

	return violations;
}

// ---------------------------------------------------------------------------
// Requisição e resposta (§10, §11)
// ---------------------------------------------------------------------------

export interface ExampleInput {
	/** Onde o exemplo está. */
	location?: { path: string; line?: number };
	value: unknown;
}

export function checkRequestExample(example: ExampleInput, schema: SchemaLike | undefined): ContractAssertion[] {
	if (!schema) {
		return [
			{
				id: 'CONTRACT-REQ-000',
				dimension: 'request',
				status: 'unknown',
				message: 'A operação não declara schema de requisição; não há contrato a comparar.',
				location: example.location,
			},
		];
	}

	const violations = compareWithSchema(example.value, schema);
	if (violations.length === 0) {
		return [
			{
				id: 'CONTRACT-REQ-001',
				dimension: 'request',
				status: 'valid',
				message: 'O exemplo de requisição satisfaz o schema.',
				location: example.location,
			},
		];
	}

	return violations.map((violation) => ({
		// Campo obrigatório ausente quebra o contrato; campo a mais é aviso — ele
		// pode ser extensão aceita pelo servidor, e reprovar por isso travaria
		// documentação legítima.
		id: violation.kind === 'missing-required' ? 'CONTRACT-REQ-001' : 'CONTRACT-REQ-002',
		dimension: 'request' as const,
		status: (violation.kind === 'missing-required' ? 'invalid' : 'warning') as ContractStatus,
		message: violation.message,
		expected: violation.pointer,
		location: example.location,
	}));
}

export function checkResponseExample(
	example: ExampleInput,
	schema: SchemaLike | undefined,
	status: string
): ContractAssertion[] {
	if (!schema) {
		return [
			{
				id: 'CONTRACT-RES-000',
				dimension: 'response',
				status: 'unknown',
				message: `A resposta \`${status}\` não declara schema; não há contrato a comparar.`,
				location: example.location,
			},
		];
	}

	const violations = compareWithSchema(example.value, schema);
	if (violations.length === 0) {
		return [
			{
				id: 'CONTRACT-RES-001',
				dimension: 'response',
				status: 'valid',
				message: `O exemplo de resposta \`${status}\` satisfaz o schema.`,
				location: example.location,
			},
		];
	}

	return violations.map((violation) => ({
		id: violation.kind === 'unknown-property' ? 'CONTRACT-RES-002' : 'CONTRACT-RES-001',
		dimension: 'response' as const,
		// Numa **resposta**, campo a mais é mais grave que numa requisição: a
		// documentação está prometendo ao leitor um dado que a API não devolve.
		status: 'invalid' as ContractStatus,
		message: violation.message,
		expected: violation.pointer,
		location: example.location,
	}));
}

// ---------------------------------------------------------------------------
// Método, caminho, parâmetros, status (§8)
// ---------------------------------------------------------------------------

export function checkMethodAndPath(
	documented: { method: string; path: string; location?: { path: string; line?: number } },
	operation: ApiOperation,
	basePath = ''
): ContractAssertion[] {
	const assertions: ContractAssertion[] = [];
	const expectedPath = `${basePath}${operation.path}`;

	assertions.push({
		id: 'CONTRACT-MET-001',
		dimension: 'method',
		status: documented.method.toUpperCase() === operation.method.toUpperCase() ? 'valid' : 'invalid',
		message:
			documented.method.toUpperCase() === operation.method.toUpperCase()
				? `Método ${operation.method.toUpperCase()} confere.`
				: 'O método documentado difere do contrato.',
		expected: operation.method.toUpperCase(),
		actual: documented.method.toUpperCase(),
		location: documented.location,
	});

	assertions.push({
		id: 'CONTRACT-PAT-001',
		dimension: 'path',
		status: documented.path === expectedPath ? 'valid' : 'invalid',
		message: documented.path === expectedPath ? 'Caminho confere.' : 'O caminho documentado difere do contrato.',
		expected: expectedPath,
		actual: documented.path,
		location: documented.location,
	});

	return assertions;
}

export function checkParameters(
	documented: readonly string[],
	parameters: readonly ApiParameter[],
	location?: { path: string; line?: number }
): ContractAssertion[] {
	const assertions: ContractAssertion[] = [];
	const known = new Set(parameters.map((parameter) => parameter.name));

	for (const name of documented) {
		if (!known.has(name)) {
			assertions.push({
				id: 'CONTRACT-PAR-001',
				dimension: 'parameters',
				status: 'invalid',
				message: `A documentação usa o parâmetro \`${name}\`, que não existe no contrato.`,
				actual: name,
				location,
			});
		}
	}

	for (const parameter of parameters) {
		if (!parameter.required) continue;
		if (documented.includes(parameter.name)) continue;

		assertions.push({
			id: 'CONTRACT-PAR-002',
			dimension: 'parameters',
			// Aviso, não quebra: a página pode legitimamente não listar todos os
			// parâmetros — um guia conceitual não é a referência da API.
			status: 'warning',
			message: `O parâmetro obrigatório \`${parameter.name}\` não aparece na documentação.`,
			expected: parameter.name,
			location,
		});
	}

	if (assertions.length === 0) {
		assertions.push({
			id: 'CONTRACT-PAR-001',
			dimension: 'parameters',
			status: 'valid',
			message: 'Os parâmetros documentados existem no contrato.',
			location,
		});
	}

	return assertions;
}

export function checkStatusCodes(
	documented: readonly string[],
	operation: ApiOperation,
	location?: { path: string; line?: number }
): ContractAssertion[] {
	if (documented.length === 0) {
		return [
			{
				id: 'CONTRACT-STA-000',
				dimension: 'status',
				status: 'unknown',
				message: 'A documentação não cita códigos de status.',
				location,
			},
		];
	}

	const known = new Set(operation.responses.map((response) => response.status));
	const unknown = documented.filter((status) => !known.has(status));

	if (unknown.length === 0) {
		return [
			{
				id: 'CONTRACT-STA-001',
				dimension: 'status',
				status: 'valid',
				message: 'Os códigos de status documentados existem no contrato.',
				location,
			},
		];
	}

	return unknown.map((status) => ({
		id: 'CONTRACT-STA-001',
		dimension: 'status' as const,
		status: 'warning' as ContractStatus,
		message: `A documentação cita o status \`${status}\`, que a especificação não declara.`,
		actual: status,
		location,
	}));
}

// ---------------------------------------------------------------------------
// Autenticação (§12)
// ---------------------------------------------------------------------------

/**
 * O cabeçalho tem cara de credencial?
 *
 * Três fontes: os nomes que os próprios esquemas de segurança declaram, os
 * cabeçalhos padrão de autenticação, e o vocabulário usual (`key`, `token`,
 * `auth`). Um cabeçalho fora disso não é assunto desta verificação.
 */
export function couldCarryCredential(
	header: string,
	securityIndex: ReadonlyMap<string, { kind: string; name?: string; in?: string }>
): boolean {
	const name = header.toLowerCase();
	if (name === 'authorization' || name === 'cookie') return true;

	for (const scheme of securityIndex.values()) {
		if (scheme.name && scheme.name.toLowerCase() === name) return true;
	}

	return /(^|-)(api[-_]?key|key|token|auth)(-|$)/.test(name);
}

/**
 * O mecanismo que um cabeçalho documentado representa.
 *
 * `Cookie:` é o caso que a primeira execução contra o portal expôs: o esquema
 * declara `in: cookie, name: portal_session`, e o cabeçalho que a documentação
 * mostra é `Cookie: portal_session=…`. Comparar o nome do cabeçalho com o nome do
 * esquema acusava divergência onde os dois diziam a mesma coisa — o que importa é
 * o **nome do cookie**, não a palavra "Cookie".
 */
export function authMechanismOf(header: string, value = ''): string[] {
	const name = header.toLowerCase();

	if (name === 'authorization') {
		if (/^basic\b/i.test(value.trim())) return ['http-basic'];
		return ['http-bearer'];
	}

	if (name === 'cookie') {
		const cookies = value
			.split(';')
			.map((entry) => entry.split('=')[0]?.trim())
			.filter((entry): entry is string => Boolean(entry));
		return cookies.map((cookie) => `apiKey:${cookie}`);
	}

	return [`apiKey:${header}`];
}

export function checkAuthentication(
	documented: ReadonlyArray<{ header: string; value?: string }>,
	operation: ApiOperation,
	securityIndex: ReadonlyMap<string, { kind: string; name?: string; in?: string }>,
	location?: { path: string; line?: number }
): ContractAssertion[] {
	if (operation.security.length === 0) {
		return [
			{
				id: 'CONTRACT-AUTH-000',
				dimension: 'authentication',
				status: 'unknown',
				message: 'A operação não declara autenticação no contrato.',
				location,
			},
		];
	}

	const expected = operation.security.map((scheme) => {
		const declared = securityIndex.get(scheme.id) ?? { kind: scheme.kind, name: scheme.name };
		return declared.kind === 'apiKey' ? `apiKey:${declared.name ?? scheme.id}` : declared.kind;
	});

	if (documented.length === 0) {
		return [
			{
				id: 'CONTRACT-AUTH-001',
				dimension: 'authentication',
				// Aviso: a página pode tratar de outro assunto e não repetir o
				// cabeçalho de autenticação em todo exemplo.
				status: 'warning',
				message: `A operação exige autenticação (${expected.join(', ')}) e a documentação não mostra nenhuma.`,
				expected: expected.join(', '),
				location,
			},
		];
	}

	// Só cabeçalhos que podem carregar credencial. `Content-Type` num relatório de
	// autenticação é ruído, e ruído dentro de uma linha de erro é o que faz alguém
	// parar de ler a linha inteira.
	const found = documented
		.filter((entry) => couldCarryCredential(entry.header, securityIndex))
		.flatMap((entry) => authMechanismOf(entry.header, entry.value));
	const matches = found.some((mechanism) =>
		expected.some((target) => target.toLowerCase() === mechanism.toLowerCase())
	);

	return [
		{
			id: 'CONTRACT-AUTH-001',
			dimension: 'authentication',
			status: matches ? 'valid' : 'invalid',
			message: matches
				? 'O mecanismo de autenticação documentado confere com o contrato.'
				: 'O mecanismo de autenticação documentado difere do contrato.',
			expected: expected.join(', '),
			actual: found.join(', '),
			location,
		},
	];
}

// ---------------------------------------------------------------------------
// Exemplos de código e de CLI (§13, §14)
// ---------------------------------------------------------------------------

/**
 * Compara as chaves usadas num exemplo de código com o contrato.
 *
 * Deliberadamente sintático: extrai `chave:` de um literal de objeto e compara
 * com as propriedades do schema. Interpretar SDK de verdade exigiria um
 * analisador por linguagem, e o que se quer pegar aqui — o SDK renomeou `amount`
 * para `value` e a documentação não acompanhou — aparece na comparação de chaves.
 */
export function extractObjectKeys(code: string): string[] {
	const keys = new Set<string>();
	for (const match of code.matchAll(/(?:^|[{,\s])["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*:/g)) {
		keys.add(match[1]);
	}
	return [...keys];
}

export function checkCodeExample(
	code: string,
	schema: SchemaLike | undefined,
	location?: { path: string; line?: number }
): ContractAssertion[] {
	const properties = Object.keys(schema?.properties ?? {});
	if (properties.length === 0) {
		return [
			{
				id: 'CONTRACT-CODE-000',
				dimension: 'code-example',
				status: 'unknown',
				message: 'Sem schema de requisição para comparar com o exemplo de código.',
				location,
			},
		];
	}

	const used = extractObjectKeys(code);
	// Só as chaves que parecem de payload: um exemplo traz `const`, nomes de
	// função e opções do cliente, e acusar tudo o que não está no schema
	// transformaria a regra em ruído.
	const suspicious = used.filter((key) => !properties.includes(key) && properties.some((property) => similar(key, property)));

	if (suspicious.length === 0) {
		return [
			{
				id: 'CONTRACT-CODE-001',
				dimension: 'code-example',
				status: 'valid',
				message: 'O exemplo de código não usa campo divergente do contrato.',
				location,
			},
		];
	}

	return suspicious.map((key) => ({
		id: 'CONTRACT-CODE-001',
		dimension: 'code-example' as const,
		status: 'invalid' as ContractStatus,
		message: `O exemplo usa \`${key}\`, e o contrato declara \`${properties.find((property) => similar(key, property))}\`.`,
		actual: key,
		expected: properties.find((property) => similar(key, property)),
		location,
	}));
}

/** Duas chaves ocupando o mesmo lugar: nomes próximos, valor do mesmo tipo. */
function similar(candidate: string, property: string): boolean {
	if (candidate === property) return false;
	const a = candidate.toLowerCase();
	const b = property.toLowerCase();
	// Sinônimos que aparecem em renomeação de SDK, e prefixo comum.
	const synonyms = [
		['amount', 'value'],
		['id', 'identifier'],
		['name', 'title'],
		['token', 'key'],
	];
	if (synonyms.some(([left, right]) => (a === left && b === right) || (a === right && b === left))) return true;
	return a.length > 3 && b.length > 3 && (a.startsWith(b.slice(0, 4)) || b.startsWith(a.slice(0, 4)));
}

export function checkCliExample(
	documentedOptions: readonly string[],
	availableOptions: readonly string[],
	location?: { path: string; line?: number }
): ContractAssertion[] {
	const known = new Set(availableOptions);
	const unknown = documentedOptions.filter((option) => !known.has(option));

	if (availableOptions.length === 0) {
		return [
			{
				id: 'CONTRACT-CLI-000',
				dimension: 'code-example',
				status: 'unknown',
				message: 'Não foi possível descobrir as opções do comando.',
				location,
			},
		];
	}

	if (unknown.length === 0) {
		return [
			{
				id: 'CONTRACT-CLI-001',
				dimension: 'code-example',
				status: 'valid',
				message: 'As opções documentadas existem no comando.',
				location,
			},
		];
	}

	return unknown.map((option) => ({
		id: 'CONTRACT-CLI-001',
		dimension: 'code-example' as const,
		status: 'invalid' as ContractStatus,
		message: `A documentação usa \`${option}\`, que o comando não oferece.`,
		actual: option,
		location,
	}));
}
