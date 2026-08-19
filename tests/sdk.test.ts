import { describe, expect, it } from 'vitest';
import { parseOpenApi } from '../src/lib/api-explorer/model';
import { buildSdkSpecification, camelCase, operationName, pascalCase, resourceOf, toSdkType } from '../src/lib/sdk/build';
import { renderExample, renderType, typescriptRenderer } from '../src/lib/sdk/typescript';
import { checkConsistency, diffSpecifications, directionsOf, requiredChangeKind, signatureOf } from '../src/lib/sdk/check';
import { impactItemsFor } from '../src/lib/sdk/integration';
import type { SdkSpecification, SdkType } from '../src/lib/sdk/types';

/** Uma especificação pequena e completa, escrita como YAML de verdade. */
const SPEC = `
openapi: 3.1.0
info:
  title: Exemplo
  version: '2.4.0'
servers:
  - url: /api
paths:
  /users:
    get:
      operationId: listUsers
      tags: [users]
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/User'
    post:
      operationId: createUser
      tags: [users]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/UserInput'
      responses:
        '201':
          description: criado
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/User'
        '400':
          description: inválido
  /users/{id}:
    get:
      operationId: getUser
      tags: [users]
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string }
        - name: include_deleted
          in: query
          schema: { type: boolean }
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/User'
        '404':
          description: não encontrado
components:
  securitySchemes:
    bearer:
      type: http
      scheme: bearer
  schemas:
    User:
      type: object
      required: [id, email]
      properties:
        id: { type: string }
        email: { type: string }
        role: { type: string, enum: [viewer, admin] }
        tags: { type: array, items: { type: string } }
    UserInput:
      type: object
      required: [email]
      properties:
        email: { type: string }
security:
  - bearer: []
`;

const model = parseOpenApi(SPEC);
const specification = buildSdkSpecification(model, { packageName: '@acme/client', version: '2.4.0' });
const files = typescriptRenderer.render(specification);

function file(path: string): string {
	return files.find((entry) => entry.path === path)?.contents ?? '';
}

// ---------------------------------------------------------------------------
// Um só parser
// ---------------------------------------------------------------------------

describe('reuso do parser existente', () => {
	it('o modelo do SDK sai do mesmo `parseOpenApi` do Explorer', () => {
		// A spec proíbe um segundo parser; o teste amarra a proibição.
		expect(model.operations).toHaveLength(3);
		expect(model.schemas.map((schema) => schema.name)).toEqual(['User', 'UserInput']);
	});

	it('o `$ref` da resposta chega ao modelo sem ser expandido', () => {
		const operation = model.operations.find((entry) => entry.id === 'getUser')!;
		const success = operation.responses.find((response) => response.status === '200')!;

		expect(success.schema).toEqual({ $ref: '#/components/schemas/User' });
	});
});

// ---------------------------------------------------------------------------
// Nomes
// ---------------------------------------------------------------------------

describe('nomes', () => {
	it('dobra acento antes de mudar a caixa', () => {
		// `autenticação` virava o recurso `autenticaO`, que ninguém consegue digitar.
		expect(camelCase('autenticação')).toBe('autenticacao');
		expect(pascalCase('documentação')).toBe('Documentacao');
	});

	it('a tag decide o recurso, não o caminho', () => {
		const operation = model.operations.find((entry) => entry.id === 'getUser')!;
		expect(resourceOf(operation).name).toBe('users');
	});

	it('o `operationId` perde o prefixo do recurso', () => {
		const operation = model.operations.find((entry) => entry.id === 'createUser')!;
		expect(operationName(operation, 'users')).toBe('create');
	});

	it('sem `operationId`, o caminho distingue listar de buscar um', () => {
		const bare = parseOpenApi(`
openapi: 3.1.0
info: { title: X, version: '1' }
paths:
  /items:
    get:
      responses: { '200': { description: ok } }
  /items/{id}:
    get:
      responses: { '200': { description: ok } }
`);

		expect(operationName(bare.operations[0], 'items')).toBe('list');
		expect(operationName(bare.operations[1], 'items')).toBe('get');
	});
});

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

describe('toSdkType', () => {
	it('preserva `$ref` como referência em vez de expandir', () => {
		expect(toSdkType({ $ref: '#/components/schemas/User' })).toEqual({ kind: 'ref', ref: 'User' });
	});

	it('lê enum, array e nullable', () => {
		expect(toSdkType({ type: 'string', enum: ['a', 'b'] }).kind).toBe('enum');
		expect(toSdkType({ type: 'array', items: { type: 'string' } }).items?.kind).toBe('string');
		expect(toSdkType({ type: 'string', nullable: true }).nullable).toBe(true);
	});

	it('objeto sem propriedades declaradas não vira objeto vazio', () => {
		// Fingir `{}` faria o compilador recusar toda chave real.
		expect(toSdkType({ type: 'object' }).additional).toBe(true);
	});

	it('composição fora do MVP vira `unknown`, não um palpite', () => {
		expect(toSdkType({ oneOf: [{ type: 'string' }, { type: 'number' }] }).kind).toBe('unknown');
	});

	it('`allOf` de um item só é o próprio tipo', () => {
		expect(toSdkType({ allOf: [{ type: 'string' }] }).kind).toBe('string');
	});
});

describe('renderType', () => {
	it('imprime união de enum', () => {
		expect(renderType({ kind: 'enum', values: ['viewer', 'admin'] })).toBe('"viewer" | "admin"');
	});

	it('imprime `unknown` para o que a especificação não disse', () => {
		expect(renderType({ kind: 'unknown' })).toBe('unknown');
	});

	it('nullable vira união com null', () => {
		expect(renderType({ kind: 'string', nullable: true })).toBe('string | null');
	});

	it('objeto sem propriedades e aberto vira Record', () => {
		expect(renderType({ kind: 'object', properties: [], additional: true })).toBe('Record<string, unknown>');
	});
});

// ---------------------------------------------------------------------------
// Geração
// ---------------------------------------------------------------------------

describe('buildSdkSpecification', () => {
	it('agrupa operações por recurso', () => {
		expect(specification.resources).toHaveLength(1);
		expect(specification.resources[0].operations.map((operation) => operation.name).sort()).toEqual(['create', 'get', 'list']);
	});

	it('tipa a resposta a partir do `$ref`', () => {
		const get = specification.resources[0].operations.find((operation) => operation.name === 'get')!;
		expect(get.responseType).toEqual({ kind: 'ref', ref: 'User' });
	});

	it('registra os códigos de erro declarados', () => {
		const get = specification.resources[0].operations.find((operation) => operation.name === 'get')!;
		expect(get.errorStatuses).toEqual(['404']);
	});

	it('a versão da API vem da especificação', () => {
		expect(specification.apiVersion).toBe('2.4.0');
	});

	it('declara o que a especificação não permitiu representar', () => {
		const semSchema = buildSdkSpecification(
			parseOpenApi(`
openapi: 3.1.0
info: { title: X, version: '1' }
paths:
  /x:
    get:
      responses: { '200': { description: ok } }
`),
			{ packageName: 'x', version: '1' }
		);

		expect(semSchema.limitations.join(' ')).toContain('components/schemas');
	});
});

describe('typescriptRenderer', () => {
	it('gera a estrutura que a spec descreve', () => {
		const paths = files.map((entry) => entry.path);

		for (const expected of [
			'src/client.ts',
			'src/errors.ts',
			'src/index.ts',
			'src/models/index.ts',
			'src/runtime/auth.ts',
			'src/runtime/http.ts',
			'src/runtime/serialization.ts',
			'package.json',
			'tsconfig.json',
			'README.md',
		]) {
			expect(paths).toContain(expected);
		}
	});

	it('o barril de modelos é módulo mesmo sem nenhum modelo', () => {
		// `export * from` sobre um arquivo sem export não compila.
		const vazio = typescriptRenderer.render({ ...specification, models: [] });
		expect(vazio.find((entry) => entry.path === 'src/models/index.ts')?.contents).toContain('export {}');
	});

	it('o exemplo não fecha o bloco de comentário que o contém', () => {
		// O exemplo de um corpo obrigatório continha um comentário de bloco, que
		// terminava o JSDoc no meio e fazia o resto virar código.
		const resource = file('src/resources/users.ts');
		const jsdocBlocks = resource.split('/**').length - 1;
		const closings = resource.split('*/').length - 1;

		expect(closings).toBe(jsdocBlocks);
	});

	it('o exemplo de corpo obrigatório não contém comentário de bloco', () => {
		const create = specification.resources[0].operations.find((operation) => operation.name === 'create')!;
		expect(renderExample('users', create)).not.toContain('/*');
	});

	it('importa só os modelos que o recurso usa', () => {
		expect(file('src/resources/users.ts')).toContain("import type { User, UserInput } from '../models/index.js';");
	});

	it('o pacote não tem dependência de execução', () => {
		expect(JSON.parse(file('package.json')).dependencies).toEqual({});
	});

	it('a autenticação sai dos `securitySchemes`, sem credencial embutida', () => {
		const auth = file('src/runtime/auth.ts');

		expect(auth).toContain('token?: string');
		expect(auth).toContain('Bearer');
		expect(auth).not.toMatch(/sk-|secret\s*=|password\s*=\s*['"]/);
	});

	it('o README traz versão do SDK e da API', () => {
		const readme = file('README.md');

		expect(readme).toContain('2.4.0');
		expect(readme).toContain('@acme/client');
	});
});

// ---------------------------------------------------------------------------
// Consistência
// ---------------------------------------------------------------------------

describe('checkConsistency', () => {
	it('o SDK gerado corresponde à especificação', () => {
		expect(checkConsistency(specification, files)).toEqual([]);
	});

	it('acusa parâmetro de caminho ausente', () => {
		// É o caso que a spec dá como exemplo: `client.users.get()` sem `id`.
		const mutilado = files.map((entry) =>
			entry.path === 'src/resources/users.ts'
				? { ...entry, contents: entry.contents.replace(/input\.id/g, 'undefined') }
				: entry
		);

		const problems = checkConsistency(specification, mutilado);
		expect(problems.some((problem) => problem.message.includes('Parâmetro de caminho ausente'))).toBe(true);
	});

	it('acusa recurso sem arquivo gerado', () => {
		const problems = checkConsistency(specification, files.filter((entry) => entry.path !== 'src/resources/users.ts'));
		expect(problems[0].severity).toBe('error');
	});

	it('acusa modelo sem tipo gerado', () => {
		const semUser = files.map((entry) =>
			entry.path === 'src/models/index.ts' ? { ...entry, contents: '// vazio\nexport {};\n' } : entry
		);

		const problems = checkConsistency(specification, semUser);
		expect(problems.some((problem) => problem.subject === 'User')).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

describe('signatureOf', () => {
	const models = new Map<string, SdkType>([
		['User', { kind: 'object', properties: [{ name: 'id', type: { kind: 'string' }, required: true }] }],
	]);

	it('resolve a referência contra os modelos', () => {
		// Extrair um schema inline para `components/schemas` não muda forma nenhuma,
		// e aparecia como ruptura em toda operação afetada.
		const inline: SdkType = { kind: 'object', properties: [{ name: 'id', type: { kind: 'string' }, required: true }] };

		expect(signatureOf({ kind: 'ref', ref: 'User' }, models)).toBe(signatureOf(inline, models));
	});

	it('sem os modelos em mãos, usa o nome', () => {
		expect(signatureOf({ kind: 'ref', ref: 'User' })).toBe('ref:User');
	});

	it('modelo recursivo não trava a assinatura', () => {
		const recursive = new Map<string, SdkType>([
			['Node', { kind: 'object', properties: [{ name: 'child', type: { kind: 'ref', ref: 'Node' }, required: false }] }],
		]);

		expect(signatureOf({ kind: 'ref', ref: 'Node' }, recursive)).toContain('Node');
	});

	it('a ordem das propriedades não muda a assinatura', () => {
		const a: SdkType = {
			kind: 'object',
			properties: [
				{ name: 'a', type: { kind: 'string' }, required: true },
				{ name: 'b', type: { kind: 'string' }, required: true },
			],
		};
		const b: SdkType = { ...a, properties: [...a.properties!].reverse() };

		expect(signatureOf(a)).toBe(signatureOf(b));
	});
});

describe('requiredChangeKind', () => {
	it('numa resposta, campo virar obrigatório é ganho', () => {
		// Declarar `required` num corpo de resposta apareceu como ruptura em quatro
		// operações da API real, quando é uma garantia a mais para quem consome.
		expect(requiredChangeKind(false, true, 'response')).toBe('additive');
	});

	it('numa resposta, campo virar opcional quebra quem lia', () => {
		expect(requiredChangeKind(true, false, 'response')).toBe('breaking');
	});

	it('numa requisição, exigir algo novo quebra quem chama', () => {
		expect(requiredChangeKind(false, true, 'request')).toBe('breaking');
	});

	it('uso nos dois sentidos é tratado como requisição', () => {
		expect(requiredChangeKind(false, true, 'both')).toBe('breaking');
	});

	it('sem mudança, não há o que classificar', () => {
		expect(requiredChangeKind(true, true, 'response')).toBeNull();
	});
});

describe('directionsOf', () => {
	it('reconhece modelo de resposta e de requisição', () => {
		const directions = directionsOf(specification);

		expect(directions.get('UserInput')).toBe('request');
		expect(directions.get('User')).toBe('response');
	});
});

describe('diffSpecifications', () => {
	function withoutEmail(): SdkSpecification {
		return {
			...specification,
			models: specification.models.map((model) =>
				model.name === 'User'
					? {
							...model,
							type: {
								...model.type,
								properties: (model.type.properties ?? []).filter((property) => property.name !== 'email'),
							},
						}
					: model
			),
		};
	}

	it('campo removido é ruptura', () => {
		// O exemplo da própria spec: `User.email removed`.
		const diff = diffSpecifications(specification, withoutEmail());

		expect(diff.breaking).toBeGreaterThan(0);
		expect(diff.changes.some((change) => change.subject === 'User.email' && change.kind === 'breaking')).toBe(true);
	});

	it('aponta os arquivos a regerar', () => {
		expect(diffSpecifications(specification, withoutEmail()).regenerate).toContain('src/models/index.ts');
	});

	it('operação removida é ruptura', () => {
		const semGet: SdkSpecification = {
			...specification,
			resources: specification.resources.map((resource) => ({
				...resource,
				operations: resource.operations.filter((operation) => operation.name !== 'get'),
			})),
		};

		expect(diffSpecifications(specification, semGet).changes.some((change) => change.subject === 'client.users.get')).toBe(true);
	});

	it('modelo novo é aditivo', () => {
		const comExtra: SdkSpecification = {
			...specification,
			models: [...specification.models, { name: 'Team', schemaName: 'Team', type: { kind: 'object', properties: [] }, deprecated: false }],
		};

		const diff = diffSpecifications(specification, comExtra);
		expect(diff.changes.find((change) => change.subject === 'Team')?.kind).toBe('additive');
	});

	it('contrato idêntico não produz mudança nenhuma', () => {
		expect(diffSpecifications(specification, specification).changes).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Integração com o Impact Engine
// ---------------------------------------------------------------------------

describe('impactItemsFor', () => {
	it('ruptura vira item crítico do engine existente', () => {
		const items = impactItemsFor(
			[{ kind: 'breaking', subject: 'User.email', detail: 'Campo removido.', files: ['src/models/index.ts'] }],
			'src/schemas/api.yaml'
		);

		expect(items[0].severity).toBe('critical');
		expect(items[0].node.type).toBe('sdk');
	});

	it('mudança aditiva não é crítica', () => {
		const items = impactItemsFor(
			[{ kind: 'additive', subject: 'User.createdAt', detail: 'Campo novo.', files: ['src/models/index.ts'] }],
			'spec'
		);

		expect(items[0].severity).toBe('medium');
	});

	it('o item é marcado como invisível no diff', () => {
		// O SDK gerado é outro artefato: a mudança não aparece no diff do PR, e é
		// por isso que ela precisa ser anunciada.
		const items = impactItemsFor([{ kind: 'breaking', subject: 'x', detail: 'y', files: ['a.ts'] }], 'spec');
		expect(items[0].hidden).toBe(true);
	});
});
