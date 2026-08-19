/**
 * `ApiModel` → `SdkSpecification` (§5, §6, §7).
 *
 * Puro, e sem YAML: recebe o modelo que `parseOpenApi()` já produziu e devolve a
 * forma que um renderer consegue imprimir. É aqui que moram as decisões de
 * nomeação e agrupamento — as mesmas para toda linguagem, porque um SDK de
 * Python com nomes diferentes do de TypeScript obrigaria quem lê a documentação
 * a aprender duas APIs.
 */

import { fallbackOperationId, type ApiModel, type ApiOperation, type ApiParameter, type ApiSchema } from '../api-explorer/model';
import type {
	SdkModel,
	SdkOperation,
	SdkParameter,
	SdkProperty,
	SdkResource,
	SdkSpecification,
	SdkType,
} from './types';

type Json = Record<string, any>;

// ---------------------------------------------------------------------------
// Nomes
// ---------------------------------------------------------------------------

/**
 * Dobra acentos para ASCII antes de qualquer conversão de caixa.
 *
 * Sem isto, a tag `autenticação` virava o recurso `autenticaO`: o `ç` e o `ã`
 * caíam como separadores e o `o` final virava uma palavra própria. Nome de
 * recurso é o que quem usa o SDK digita, e `client.autenticaO` não é digitável.
 */
function fold(text: string): string {
	return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function pascalCase(text: string): string {
	return fold(text)
		.replace(/[^A-Za-z0-9]+/g, ' ')
		.trim()
		.split(/\s+|(?<=[a-z0-9])(?=[A-Z])/)
		.filter(Boolean)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join('');
}

export function camelCase(text: string): string {
	const pascal = pascalCase(text);
	return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/**
 * O nome do método de uma operação (§7).
 *
 * A prioridade da spec é `operationId` antes de qualquer derivação do caminho. E
 * o `operationId` costuma repetir o recurso — `createUser` dentro de
 * `client.users` viraria `client.users.createUser()`, que se lê mal. O prefixo
 * ou sufixo com o nome do recurso é removido, e `createUser` vira `create`.
 *
 * Quando não há `operationId`, o método HTTP decide, com uma distinção que o
 * caminho carrega: `GET /users` lista, `GET /users/{id}` busca um.
 */
export function operationName(operation: ApiOperation, resource: string): string {
	const declared = operation.id.trim();
	const derived = declared === '' || isDerived(operation);

	if (!derived) {
		const singular = resource.replace(/s$/, '');
		const stripped = camelCase(
			declared
				.replace(new RegExp(`^(${resource}|${singular})`, 'i'), '')
				.replace(new RegExp(`(${resource}|${singular})$`, 'i'), '')
		);

		if (stripped !== '') return stripped;
		return camelCase(declared);
	}

	const hasPathParameter = /\{[^}]+\}$/.test(operation.path);

	switch (operation.method) {
		case 'get':
			return hasPathParameter ? 'get' : 'list';
		case 'post':
			return 'create';
		case 'put':
		case 'patch':
			return 'update';
		case 'delete':
			return 'delete';
		default:
			return camelCase(`${operation.method} ${lastSegment(operation.path)}`);
	}
}

/**
 * O id foi derivado pelo parser, ou declarado no documento?
 *
 * A regra de derivação é **importada** do parser, não reescrita aqui. A primeira
 * versão a duplicava e errava: `get-items-id` nunca casava com a cópia local, e
 * toda operação sem `operationId` era tratada como se tivesse um — `GET
 * /items/{id}` virava o método `getItemsId` em vez de `get`.
 */
function isDerived(operation: ApiOperation): boolean {
	return operation.id === fallbackOperationId(operation.method, operation.path);
}

function lastSegment(path: string): string {
	return (
		path
			.split('/')
			.filter((segment) => segment !== '' && !segment.startsWith('{'))
			.at(-1) ?? 'root'
	);
}

/**
 * O recurso ao qual uma operação pertence (§6).
 *
 * A tag vence o caminho. Ela é a intenção declarada por quem escreveu a
 * especificação; o caminho é uma consequência de roteamento, e agrupar por ele
 * espalharia `/v2/users` e `/users` em dois recursos que são o mesmo.
 */
export function resourceOf(operation: ApiOperation): { name: string; origin: string } {
	const tag = operation.tags[0];
	if (tag) return { name: camelCase(tag), origin: `tag \`${tag}\`` };

	const segment = operation.path
		.split('/')
		.filter((entry) => entry !== '' && !entry.startsWith('{'))
		.find((entry) => !/^(v\d+|api)$/i.test(entry));

	return segment ? { name: camelCase(segment), origin: `caminho \`/${segment}\`` } : { name: 'api', origin: 'raiz' };
}

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/** `#/components/schemas/User` → `User`. */
export function refName(pointer: string): string | undefined {
	const match = pointer.match(/#\/components\/schemas\/(.+)$/);
	return match ? match[1] : undefined;
}

/**
 * Um nó de schema OpenAPI vira um `SdkType`.
 *
 * `$ref` é **preservado como referência**, não expandido: o SDK precisa dizer que
 * a resposta é `User`, e não repetir a forma de `User` em cada operação. Um
 * gerador que expande produz vinte cópias do mesmo tipo e nenhuma delas com nome.
 */
export function toSdkType(schema: unknown, depth = 0): SdkType {
	if (!schema || typeof schema !== 'object') return { kind: 'unknown' };
	if (depth > 12) return { kind: 'unknown' };

	const node = schema as Json;

	if (typeof node.$ref === 'string') {
		const name = refName(node.$ref);
		return name ? { kind: 'ref', ref: pascalCase(name) } : { kind: 'unknown' };
	}

	// `allOf` de um item só é o padrão para "este tipo, com descrição própria".
	// Composição de verdade fica fora do MVP e é registrada como limitação.
	if (Array.isArray(node.allOf) && node.allOf.length === 1) return toSdkType(node.allOf[0], depth + 1);
	if (Array.isArray(node.oneOf) || Array.isArray(node.anyOf) || Array.isArray(node.allOf)) return { kind: 'unknown' };

	const nullable = node.nullable === true || (Array.isArray(node.type) && node.type.includes('null'));
	const declared = Array.isArray(node.type) ? node.type.find((entry: string) => entry !== 'null') : node.type;

	if (Array.isArray(node.enum) && node.enum.length > 0) {
		return {
			kind: 'enum',
			values: node.enum.filter((value: unknown) => typeof value === 'string').map(String),
			nullable,
		};
	}

	switch (declared) {
		case 'array':
			return { kind: 'array', items: toSdkType(node.items, depth + 1), nullable };

		case 'object':
		case undefined: {
			if (!node.properties) {
				// Objeto sem propriedades declaradas: `unknown` é honesto. Fingir um
				// objeto vazio faria o compilador recusar toda chave real.
				return declared === 'object' ? { kind: 'object', properties: [], additional: true, nullable } : { kind: 'unknown' };
			}

			const required: string[] = Array.isArray(node.required) ? node.required.map(String) : [];

			const properties: SdkProperty[] = Object.entries<Json>(node.properties).map(([name, value]) => ({
				name,
				type: toSdkType(value, depth + 1),
				required: required.includes(name),
				description: typeof value?.description === 'string' ? value.description : undefined,
				deprecated: value?.deprecated === true,
			}));

			return {
				kind: 'object',
				properties,
				additional: node.additionalProperties !== false,
				nullable,
			};
		}

		case 'string':
		case 'number':
		case 'integer':
		case 'boolean':
			return { kind: declared, nullable, format: typeof node.format === 'string' ? node.format : undefined };

		default:
			return { kind: 'unknown', nullable };
	}
}

function parameterType(parameter: ApiParameter): SdkType {
	if (parameter.enum && parameter.enum.length > 0) return { kind: 'enum', values: parameter.enum };

	switch (parameter.type) {
		case 'number':
		case 'integer':
		case 'boolean':
			return { kind: parameter.type };
		case 'array':
			return { kind: 'array', items: { kind: 'string' } };
		default:
			return { kind: 'string' };
	}
}

// ---------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------

function modelFrom(schema: ApiSchema): SdkModel {
	return {
		name: pascalCase(schema.name),
		schemaName: schema.name,
		type: toSdkType(schema.schema),
		description: schema.description,
		deprecated: schema.deprecated,
	};
}

/** A resposta de sucesso: o menor 2xx que a operação declara. */
export function successResponse(operation: ApiOperation) {
	return operation.responses
		.filter((response) => /^2\d\d$/.test(response.status))
		.sort((a, b) => Number(a.status) - Number(b.status))[0];
}

export interface BuildOptions {
	packageName: string;
	version: string;
	baseUrl?: string;
}

export function buildSdkSpecification(model: ApiModel, options: BuildOptions): SdkSpecification {
	const limitations: string[] = [];
	const byResource = new Map<string, SdkResource>();

	for (const operation of model.operations) {
		const { name, origin } = resourceOf(operation);
		const resource = byResource.get(name) ?? { name, origin, operations: [] };

		const parameters: SdkParameter[] = operation.parameters.map((parameter) => ({
			name: camelCase(parameter.name),
			wireName: parameter.name,
			location: parameter.location,
			type: parameterType(parameter),
			required: parameter.required,
			description: parameter.description,
		}));

		const success = successResponse(operation);
		const responseType = success?.schema ? toSdkType(success.schema) : undefined;

		const method: SdkOperation = {
			name: operationName(operation, name),
			operationId: operation.id,
			method: operation.method,
			path: operation.path,
			summary: operation.summary,
			description: operation.description,
			parameters,
			requestBody: operation.requestBody
				? {
						type: toSdkType(operation.requestBody.schema),
						contentType: operation.requestBody.contentType,
						required: operation.requestBody.required,
					}
				: undefined,
			responseType,
			errorStatuses: operation.responses
				.filter((response) => /^[45]\d\d$/.test(response.status))
				.map((response) => response.status),
			security: operation.security,
			deprecated: operation.deprecated,
		};

		// Dois métodos com o mesmo nome no mesmo recurso é colisão, e resolvê-la em
		// silêncio produziria um SDK em que uma das operações some. O nome ganha o
		// método HTTP como desambiguador, e a limitação fica registrada.
		if (resource.operations.some((existing) => existing.name === method.name)) {
			const disambiguated = camelCase(`${method.name} ${lastSegment(operation.path)}`);
			limitations.push(
				`\`${name}.${method.name}\` colidiu com outra operação; \`${operation.method.toUpperCase()} ${operation.path}\` virou \`${disambiguated}\`. Declare \`operationId\` para escolher o nome.`
			);
			method.name = disambiguated;
		}

		resource.operations.push(method);
		byResource.set(name, resource);
	}

	const models = model.schemas.map(modelFrom);

	if (model.schemas.length === 0) {
		limitations.push(
			'A especificação não declara `components/schemas`: os corpos e respostas ficam com tipos anônimos ou `unknown`.'
		);
	}

	const unknownResponses = [...byResource.values()]
		.flatMap((resource) => resource.operations)
		.filter((operation) => operation.responseType === undefined).length;

	if (unknownResponses > 0) {
		limitations.push(
			`${unknownResponses} operação(ões) não declaram schema de resposta 2xx; o método devolve \`unknown\` em vez de um tipo inventado.`
		);
	}

	return {
		packageName: options.packageName,
		version: options.version,
		apiVersion: model.version,
		title: model.title,
		description: model.description,
		baseUrl: options.baseUrl ?? model.servers[0] ?? '/',
		models,
		resources: [...byResource.values()].sort((a, b) => a.name.localeCompare(b.name)),
		securitySchemes: model.securitySchemes,
		limitations,
	};
}
