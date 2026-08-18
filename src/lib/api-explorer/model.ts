/**
 * Modelo do API Explorer, derivado do OpenAPI (§2).
 *
 * A regra que organiza tudo: **a especificação é a fonte**. Endpoint, parâmetro,
 * schema, resposta e autenticação são lidos dela, nunca redigidos de novo num
 * componente. Duplicar significaria duas verdades, e a segunda envelhece na
 * primeira vez que alguém mexer na API sem lembrar do Explorer.
 *
 * Este módulo é puro: recebe o documento e devolve operações. Ele não faz
 * requisição, não conhece o navegador e não sabe o que é um token — o que o
 * torna testável sem rede e sem interface.
 */

import yaml from 'js-yaml';

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options';

const METHODS: HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

export type ParameterLocation = 'path' | 'query' | 'header' | 'cookie';

export interface ApiParameter {
	name: string;
	location: ParameterLocation;
	required: boolean;
	description?: string;
	/** Tipo declarado no schema, para o formulário escolher o campo. */
	type: string;
	/** Valores aceitos, quando o schema os restringe. */
	enum?: string[];
	example?: string;
}

export interface ApiRequestBody {
	contentType: string;
	required: boolean;
	/** Corpo de exemplo, já serializado — o formulário começa a partir dele. */
	example: string;
	schema?: unknown;
}

export interface ApiResponse {
	status: string;
	description: string;
	contentType?: string;
}

export type SecurityKind = 'apiKey' | 'http-bearer' | 'http-basic' | 'oauth2' | 'openIdConnect' | 'unknown';

export interface SecurityScheme {
	id: string;
	kind: SecurityKind;
	description?: string;
	/** Para `apiKey`: onde a credencial vai. */
	in?: 'header' | 'query' | 'cookie';
	/** Para `apiKey`: o nome do cabeçalho ou parâmetro. */
	name?: string;
}

export interface ApiOperation {
	/** `operationId` do documento, ou um derivado estável de método + caminho. */
	id: string;
	method: HttpMethod;
	/** Caminho com os marcadores originais: `/users/{id}`. */
	path: string;
	summary?: string;
	description?: string;
	tags: string[];
	parameters: ApiParameter[];
	requestBody?: ApiRequestBody;
	responses: ApiResponse[];
	/** Esquemas aceitos por esta operação; vazio significa "sem autenticação". */
	security: SecurityScheme[];
	deprecated: boolean;
}

export interface ApiModel {
	title: string;
	version: string;
	description?: string;
	/** URLs base declaradas. A primeira é o padrão do Explorer. */
	servers: string[];
	operations: ApiOperation[];
	securitySchemes: SecurityScheme[];
}

export class OpenApiError extends Error {}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

type Json = Record<string, any>;

/** Resolve `$ref` interno. Referência externa fica como está — ver `resolveRef`. */
function resolve<T>(document: Json, value: T | { $ref: string }, depth = 0): T {
	if (!value || typeof value !== 'object' || !('$ref' in value)) return value as T;
	if (depth > 10) return value as T;

	const pointer = (value as { $ref: string }).$ref;
	if (!pointer.startsWith('#/')) return value as T;

	let current: any = document;
	for (const segment of pointer.slice(2).split('/')) {
		const key = segment.replace(/~1/g, '/').replace(/~0/g, '~');
		current = current?.[key];
		if (current === undefined) return value as T;
	}

	return resolve(document, current, depth + 1);
}

function schemaType(schema: Json | undefined): string {
	if (!schema) return 'string';
	if (schema.type) return String(schema.type);
	if (schema.oneOf || schema.anyOf) return 'string';
	return 'string';
}

/**
 * Corpo de exemplo a partir do schema.
 *
 * Prefere o `example` declarado; sem ele, monta um objeto com os campos
 * obrigatórios e um valor por tipo. O objetivo não é gerar dados válidos — é
 * dar um ponto de partida que a pessoa edita, em vez de uma caixa vazia.
 */
export function exampleFromSchema(document: Json, schema: Json | undefined, depth = 0): unknown {
	if (!schema || depth > 5) return null;
	const resolved = resolve<Json>(document, schema, 0);

	if (resolved.example !== undefined) return resolved.example;
	if (resolved.default !== undefined) return resolved.default;
	if (Array.isArray(resolved.enum) && resolved.enum.length > 0) return resolved.enum[0];

	switch (resolved.type) {
		case 'object': {
			const properties = resolved.properties ?? {};
			const required: string[] = resolved.required ?? Object.keys(properties);
			const output: Json = {};
			for (const key of Object.keys(properties)) {
				// Sem `required` declarado, todos entram; com ele, só os obrigatórios,
				// para o exemplo ser o menor corpo que a API aceita.
				if (required.length > 0 && !required.includes(key)) continue;
				output[key] = exampleFromSchema(document, properties[key], depth + 1);
			}
			return output;
		}
		case 'array':
			return [exampleFromSchema(document, resolved.items, depth + 1)].filter((item) => item !== null);
		case 'integer':
		case 'number':
			return 0;
		case 'boolean':
			return false;
		case 'string':
			if (resolved.format === 'date-time') return new Date(0).toISOString();
			if (resolved.format === 'email') return 'pessoa@exemplo.com';
			return '';
		default:
			return null;
	}
}

function readSecuritySchemes(document: Json): SecurityScheme[] {
	const raw = document.components?.securitySchemes ?? {};
	const schemes: SecurityScheme[] = [];

	for (const [id, value] of Object.entries<Json>(raw)) {
		const scheme = resolve<Json>(document, value);
		let kind: SecurityKind = 'unknown';

		if (scheme.type === 'apiKey') kind = 'apiKey';
		else if (scheme.type === 'http') {
			kind = String(scheme.scheme).toLowerCase() === 'basic' ? 'http-basic' : 'http-bearer';
		} else if (scheme.type === 'oauth2') kind = 'oauth2';
		else if (scheme.type === 'openIdConnect') kind = 'openIdConnect';

		schemes.push({
			id,
			kind,
			description: scheme.description,
			in: scheme.in,
			name: scheme.name,
		});
	}

	return schemes;
}

function readParameters(document: Json, list: unknown): ApiParameter[] {
	if (!Array.isArray(list)) return [];

	return list.map((entry) => {
		const parameter = resolve<Json>(document, entry);
		const schema = resolve<Json>(document, parameter.schema ?? {});

		return {
			name: String(parameter.name ?? ''),
			location: (parameter.in ?? 'query') as ParameterLocation,
			required: parameter.required === true || parameter.in === 'path',
			description: parameter.description,
			type: schemaType(schema),
			enum: Array.isArray(schema.enum) ? schema.enum.map(String) : undefined,
			example:
				parameter.example !== undefined
					? String(parameter.example)
					: schema.example !== undefined
						? String(schema.example)
						: undefined,
		};
	});
}

/** Identificador estável quando o documento não declara `operationId`. */
export function fallbackOperationId(method: string, path: string): string {
	const slug = path
		.replace(/[{}]/g, '')
		.split('/')
		.filter(Boolean)
		.join('-')
		.replace(/[^A-Za-z0-9-]/g, '-');
	return `${method.toLowerCase()}-${slug || 'root'}`;
}

export function parseOpenApi(raw: string): ApiModel {
	let document: Json;
	try {
		document = yaml.load(raw) as Json;
	} catch (error) {
		throw new OpenApiError(`Documento inválido: ${error instanceof Error ? error.message : error}`);
	}

	if (!document || typeof document !== 'object') throw new OpenApiError('Documento vazio.');
	if (!document.openapi && !document.swagger) {
		throw new OpenApiError('Documento sem `openapi` nem `swagger`: não é uma especificação OpenAPI.');
	}

	const securitySchemes = readSecuritySchemes(document);
	const byId = new Map(securitySchemes.map((scheme) => [scheme.id, scheme]));

	/** Segurança do documento, herdada por operação que não declare a sua. */
	const documentSecurity: string[] = Array.isArray(document.security)
		? document.security.flatMap((entry: Json) => Object.keys(entry))
		: [];

	const operations: ApiOperation[] = [];

	for (const [path, item] of Object.entries<Json>(document.paths ?? {})) {
		const pathItem = resolve<Json>(document, item);
		const sharedParameters = readParameters(document, pathItem.parameters);

		for (const method of METHODS) {
			const operation = pathItem[method];
			if (!operation) continue;

			const own: string[] | null = Array.isArray(operation.security)
				? operation.security.flatMap((entry: Json) => Object.keys(entry))
				: null;
			// `security: []` na operação significa "esta é pública", e é diferente
			// de não declarar nada — que herda do documento.
			const securityIds: string[] = own ?? documentSecurity;

			const bodySpec = resolve<Json>(document, operation.requestBody ?? {});
			const content = bodySpec.content ?? {};
			const contentType = Object.keys(content)[0];

			let requestBody: ApiRequestBody | undefined;
			if (contentType) {
				const media = resolve<Json>(document, content[contentType]);
				const example = media.example ?? exampleFromSchema(document, media.schema);
				requestBody = {
					contentType,
					required: bodySpec.required === true,
					example:
						typeof example === 'string' ? example : JSON.stringify(example ?? {}, null, 2),
					schema: media.schema,
				};
			}

			const responses: ApiResponse[] = Object.entries<Json>(operation.responses ?? {}).map(
				([status, value]) => {
					const response = resolve<Json>(document, value);
					return {
						status,
						description: String(response.description ?? ''),
						contentType: Object.keys(response.content ?? {})[0],
					};
				}
			);

			operations.push({
				id: String(operation.operationId ?? fallbackOperationId(method, path)),
				method,
				path,
				summary: operation.summary,
				description: operation.description,
				tags: Array.isArray(operation.tags) ? operation.tags.map(String) : [],
				parameters: [...sharedParameters, ...readParameters(document, operation.parameters)],
				requestBody,
				responses,
				security: securityIds
					.map((id) => byId.get(id))
					.filter((scheme): scheme is SecurityScheme => Boolean(scheme)),
				deprecated: operation.deprecated === true,
			});
		}
	}

	const servers: string[] = Array.isArray(document.servers)
		? document.servers.map((server: Json) => String(server.url ?? '')).filter(Boolean)
		: [];

	return {
		title: String(document.info?.title ?? 'API'),
		version: String(document.info?.version ?? ''),
		description: document.info?.description,
		servers,
		operations,
		securitySchemes,
	};
}

/** Substitui `{parametro}` pelos valores informados. */
export function buildPath(template: string, values: Record<string, string>): string {
	return template.replace(/\{([^}]+)\}/g, (whole, name: string) => {
		const value = values[name];
		// Sem valor, o marcador fica: é mais honesto que uma URL silenciosamente
		// errada, e a interface consegue apontar o campo que falta.
		return value ? encodeURIComponent(value) : whole;
	});
}
