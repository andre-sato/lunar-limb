/**
 * Renderer TypeScript (§4, §9, §10, §11, §12).
 *
 * Ele consome `SdkSpecification` e devolve arquivos. Não lê disco, não conhece o
 * OpenAPI e não sabe onde o SDK será escrito — o que o torna testável sem
 * sistema de arquivos e substituível por um renderer de outra linguagem.
 *
 * O runtime gerado é deliberadamente pequeno (§9): `fetch`, montagem de URL,
 * cabeçalhos, tempo limite e erros. Sem dependências. Um SDK gerado que arrasta
 * uma biblioteca HTTP transfere para quem instala um problema de versão que ele
 * não escolheu ter.
 */

import type { GeneratedFile, SdkModel, SdkOperation, SdkRenderer, SdkSpecification, SdkType } from './types';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/** Um `SdkType` impresso como tipo TypeScript. */
export function renderType(type: SdkType, indent = 0): string {
	const base = renderBase(type, indent);
	return type.nullable ? `${base} | null` : base;
}

function renderBase(type: SdkType, indent: number): string {
	switch (type.kind) {
		case 'ref':
			return type.ref ?? 'unknown';
		case 'array':
			return `Array<${renderType(type.items ?? { kind: 'unknown' }, indent)}>`;
		case 'enum':
			return (type.values ?? []).map((value) => JSON.stringify(value)).join(' | ') || 'string';
		case 'integer':
		case 'number':
			return 'number';
		case 'boolean':
			return 'boolean';
		case 'string':
			return 'string';
		case 'object': {
			const properties = type.properties ?? [];
			if (properties.length === 0) return type.additional ? 'Record<string, unknown>' : '{}';

			const pad = '\t'.repeat(indent + 1);
			const lines = properties.map((property) => {
				const comment = property.description ? `${pad}/** ${property.description.replace(/\*\//g, '* /')} */\n` : '';
				const optional = property.required ? '' : '?';
				return `${comment}${pad}${safeKey(property.name)}${optional}: ${renderType(property.type, indent + 1)};`;
			});

			return `{\n${lines.join('\n')}\n${'\t'.repeat(indent)}}`;
		}
		default:
			// `unknown`, e não `any`: o compilador obriga quem chama a estreitar o
			// tipo, em vez de aprovar em silêncio um acesso que a especificação nunca
			// prometeu.
			return 'unknown';
	}
}

function safeKey(name: string): string {
	return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

/**
 * Um bloco JSDoc.
 *
 * Toda linha tem o terminador de comentário escapado, e não só as descrições. O
 * exemplo gerado de uma operação com corpo continha um comentário de bloco
 * dentro do JSDoc, que fechava o bloco no meio: o resto virava código e o SDK
 * não compilava. Escapar num lugar só deixaria o próximo emissor de linha
 * reintroduzir o defeito.
 */
function docComment(lines: readonly (string | undefined)[], indent = ''): string {
	const kept = lines
		.filter((line): line is string => Boolean(line && line.trim() !== ''))
		.map((line) => line.replace(/\*\//g, '*\\/'));

	if (kept.length === 0) return '';

	return [`${indent}/**`, ...kept.flatMap((line) => line.split('\n').map((entry) => `${indent} * ${entry}`)), `${indent} */`, ''].join(
		'\n'
	);
}

function renderModel(model: SdkModel): string {
	const header = docComment([
		model.description,
		model.deprecated ? '@deprecated Declarado como obsoleto na especificação.' : undefined,
		`Derivado de \`components/schemas/${model.schemaName}\`.`,
	]);

	// `interface` para objeto, `type` para o resto: um alias de união não pode ser
	// interface, e uma interface é mais fácil de estender do lado de quem usa.
	return model.type.kind === 'object' && (model.type.properties?.length ?? 0) > 0
		? `${header}export interface ${model.name} ${renderType(model.type)}\n`
		: `${header}export type ${model.name} = ${renderType(model.type)};\n`;
}

// ---------------------------------------------------------------------------
// Operações
// ---------------------------------------------------------------------------

/** O tipo do argumento de um método, ou `undefined` quando não há argumento. */
function argumentType(operation: SdkOperation): string | undefined {
	const parts: string[] = [];

	for (const parameter of operation.parameters) {
		const comment = parameter.description ? `\t\t/** ${parameter.description.replace(/\*\//g, '* /')} */\n` : '';
		parts.push(`${comment}\t\t${safeKey(parameter.name)}${parameter.required ? '' : '?'}: ${renderType(parameter.type, 2)};`);
	}

	if (operation.requestBody) {
		parts.push(`\t\tbody${operation.requestBody.required ? '' : '?'}: ${renderType(operation.requestBody.type, 2)};`);
	}

	return parts.length === 0 ? undefined : `{\n${parts.join('\n')}\n\t}`;
}

/** Exemplo idiomático de chamada (§11). */
export function renderExample(resource: string, operation: SdkOperation): string {
	const required = operation.parameters.filter((parameter) => parameter.required);
	const parts = required.map((parameter) => `  ${parameter.name}: ${sampleFor(parameter.type)}`);

	// Reticências soltas, sem comentário de bloco: o exemplo vive dentro de um
	// JSDoc, e um comentário de bloco ali dentro fecharia o bloco.
	if (operation.requestBody?.required) parts.push('  body: { … }');

	const argument = parts.length === 0 ? '' : `{\n${parts.join(',\n')}\n}`;
	return `await client.${resource}.${operation.name}(${argument});`;
}

function sampleFor(type: SdkType): string {
	switch (type.kind) {
		case 'integer':
		case 'number':
			return '1';
		case 'boolean':
			return 'true';
		case 'enum':
			return JSON.stringify(type.values?.[0] ?? 'valor');
		case 'array':
			return '[]';
		default:
			return '"…"';
	}
}

function renderOperation(resource: string, operation: SdkOperation): string {
	const argument = argumentType(operation);
	const responseType = operation.responseType ? renderType(operation.responseType, 1) : 'unknown';

	const header = docComment(
		[
			operation.summary,
			operation.description !== operation.summary ? operation.description : undefined,
			`\`${operation.method.toUpperCase()} ${operation.path}\``,
			operation.deprecated ? '@deprecated Declarada como obsoleta na especificação.' : undefined,
			'',
			'@example',
			renderExample(resource, operation),
		],
		'\t'
	);

	const pathParameters = operation.parameters.filter((parameter) => parameter.location === 'path');
	const queryParameters = operation.parameters.filter((parameter) => parameter.location === 'query');
	const headerParameters = operation.parameters.filter((parameter) => parameter.location === 'header');

	const lines = [
		`${header}\t${operation.name}(${argument ? `input: ${argument}` : ''}): Promise<${responseType}> {`,
		`\t\treturn this.transport.request({`,
		`\t\t\tmethod: ${JSON.stringify(operation.method.toUpperCase())},`,
		`\t\t\tpath: ${JSON.stringify(operation.path)},`,
	];

	if (pathParameters.length > 0) {
		lines.push(
			`\t\t\tpathParams: { ${pathParameters.map((parameter) => `${JSON.stringify(parameter.wireName)}: input.${parameter.name}`).join(', ')} },`
		);
	}

	if (queryParameters.length > 0) {
		lines.push(
			`\t\t\tquery: { ${queryParameters.map((parameter) => `${JSON.stringify(parameter.wireName)}: input.${parameter.name}`).join(', ')} },`
		);
	}

	if (headerParameters.length > 0) {
		lines.push(
			`\t\t\theaders: { ${headerParameters.map((parameter) => `${JSON.stringify(parameter.wireName)}: input.${parameter.name}`).join(', ')} },`
		);
	}

	if (operation.requestBody) {
		lines.push(`\t\t\tbody: input.body,`, `\t\t\tcontentType: ${JSON.stringify(operation.requestBody.contentType)},`);
	}

	lines.push(`\t\t});`, `\t}`);
	return lines.join('\n');
}

function renderResource(specification: SdkSpecification, resource: SdkSpecification['resources'][number]): GeneratedFile {
	const referenced = new Set<string>();
	collectRefs(resource, referenced);

	const imports = [...referenced].sort();
	const modelImport = imports.length > 0 ? `import type { ${imports.join(', ')} } from '../models/index.js';\n` : '';

	const contents = [
		`// Gerado a partir de ${specification.title} ${specification.apiVersion}. Não edite à mão.`,
		'',
		`import type { Transport } from '../runtime/http.js';`,
		modelImport,
		docComment([`Operações de \`${resource.name}\`.`, `Agrupadas por ${resource.origin}.`]),
		`export class ${pascal(resource.name)}Resource {`,
		`\tconstructor(private readonly transport: Transport) {}`,
		'',
		resource.operations.map((operation) => renderOperation(resource.name, operation)).join('\n\n'),
		`}`,
		'',
	].join('\n');

	return { path: `src/resources/${resource.name}.ts`, contents };
}

function collectRefs(value: unknown, into: Set<string>): void {
	if (!value || typeof value !== 'object') return;

	if (Array.isArray(value)) {
		for (const entry of value) collectRefs(entry, into);
		return;
	}

	const node = value as Record<string, unknown>;
	if (node.kind === 'ref' && typeof node.ref === 'string') into.add(node.ref);
	for (const entry of Object.values(node)) collectRefs(entry, into);
}

function pascal(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

function httpRuntime(): string {
	return `// Gerado. Não edite à mão.

import { ApiError, NotFoundError, RateLimitError, ServerError, UnauthorizedError, ValidationError } from '../errors.js';
import { applyAuth, type AuthOptions } from './auth.js';
import { buildPath, buildQuery } from './serialization.js';

export interface RequestOptions {
	method: string;
	path: string;
	pathParams?: Record<string, unknown>;
	query?: Record<string, unknown>;
	headers?: Record<string, unknown>;
	body?: unknown;
	contentType?: string;
}

export interface TransportOptions extends AuthOptions {
	baseUrl: string;
	/** Milissegundos. O padrão evita que uma chamada pendurada trave quem chama. */
	timeoutMs?: number;
	/** Injetável para teste. O padrão é o \`fetch\` global. */
	fetch?: typeof globalThis.fetch;
	/** Cabeçalhos aplicados a toda requisição. */
	headers?: Record<string, string>;
}

export class Transport {
	constructor(private readonly options: TransportOptions) {}

	async request<T>(request: RequestOptions): Promise<T> {
		const fetchImpl = this.options.fetch ?? globalThis.fetch;
		if (!fetchImpl) throw new Error('Nenhuma implementação de fetch disponível.');

		const path = buildPath(request.path, request.pathParams ?? {});
		const query = buildQuery(request.query ?? {});
		const url = \`\${this.options.baseUrl.replace(/\\/$/, '')}\${path}\${query}\`;

		const headers: Record<string, string> = { Accept: 'application/json', ...this.options.headers };

		for (const [name, value] of Object.entries(request.headers ?? {})) {
			if (value !== undefined && value !== null) headers[name] = String(value);
		}

		if (request.body !== undefined) headers['Content-Type'] = request.contentType ?? 'application/json';

		applyAuth(headers, this.options);

		// O tempo limite é do SDK, não do servidor: sem ele, uma conexão pendurada
		// trava quem chamou sem nunca resolver nem rejeitar.
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 30_000);

		let response: Response;
		try {
			response = await fetchImpl(url, {
				method: request.method,
				headers,
				body: request.body === undefined ? undefined : JSON.stringify(request.body),
				signal: controller.signal,
			});
		} finally {
			clearTimeout(timeout);
		}

		const text = await response.text();
		const payload = parse(text, response.headers.get('content-type'));

		if (!response.ok) throw errorFor(response.status, response.statusText, payload);

		return payload as T;
	}
}

function parse(text: string, contentType: string | null): unknown {
	if (text === '') return undefined;
	if (contentType && !contentType.includes('json')) return text;

	try {
		return JSON.parse(text);
	} catch {
		// Corpo que não é JSON válido volta como texto. Lançar aqui esconderia a
		// resposta do servidor justamente quando ela é a pista do problema.
		return text;
	}
}

function errorFor(status: number, statusText: string, payload: unknown): ApiError {
	const message = messageOf(payload) ?? statusText ?? \`HTTP \${status}\`;

	switch (status) {
		case 400:
		case 422:
			return new ValidationError(message, status, payload);
		case 401:
		case 403:
			return new UnauthorizedError(message, status, payload);
		case 404:
			return new NotFoundError(message, status, payload);
		case 429:
			return new RateLimitError(message, status, payload);
		default:
			return status >= 500 ? new ServerError(message, status, payload) : new ApiError(message, status, payload);
	}
}

function messageOf(payload: unknown): string | undefined {
	if (!payload || typeof payload !== 'object') return undefined;
	const record = payload as Record<string, unknown>;

	for (const key of ['message', 'error', 'detail', 'title']) {
		const value = record[key];
		if (typeof value === 'string' && value.trim() !== '') return value;
	}

	return undefined;
}
`;
}

function serializationRuntime(): string {
	return `// Gerado. Não edite à mão.

/** Substitui \`{parametro}\` pelos valores informados, já codificados. */
export function buildPath(template: string, values: Record<string, unknown>): string {
	return template.replace(/\\{([^}]+)\\}/g, (whole, name: string) => {
		const value = values[name];
		// Marcador sem valor fica como está: é mais honesto que uma URL
		// silenciosamente errada, e o servidor devolve um 404 que aponta o problema.
		return value === undefined || value === null ? whole : encodeURIComponent(String(value));
	});
}

/** Monta a query string, omitindo o que não foi informado. */
export function buildQuery(values: Record<string, unknown>): string {
	const parts: string[] = [];

	for (const [name, value] of Object.entries(values)) {
		if (value === undefined || value === null) continue;

		// Array vira parâmetro repetido — a forma que o OpenAPI chama de \`explode\`
		// e a que mais servidores aceitam sem configuração.
		if (Array.isArray(value)) {
			for (const entry of value) parts.push(\`\${encodeURIComponent(name)}=\${encodeURIComponent(String(entry))}\`);
			continue;
		}

		parts.push(\`\${encodeURIComponent(name)}=\${encodeURIComponent(String(value))}\`);
	}

	return parts.length === 0 ? '' : \`?\${parts.join('&')}\`;
}
`;
}

function authRuntime(specification: SdkSpecification): string {
	const apiKeys = specification.securitySchemes.filter((scheme) => scheme.kind === 'apiKey');
	const hasBearer = specification.securitySchemes.some((scheme) => scheme.kind === 'http-bearer' || scheme.kind === 'oauth2');
	const hasBasic = specification.securitySchemes.some((scheme) => scheme.kind === 'http-basic');

	const fields = [
		hasBearer ? '\t/** Token enviado como `Authorization: Bearer`. */\n\ttoken?: string;' : '',
		hasBasic ? '\t/** Usuário e senha para autenticação básica. */\n\tusername?: string;\n\tpassword?: string;' : '',
		apiKeys.length > 0 ? '\t/** Chave de API. */\n\tapiKey?: string;' : '',
	]
		.filter(Boolean)
		.join('\n');

	const body: string[] = [];

	if (hasBearer) {
		body.push("\tif (options.token) headers['Authorization'] = `Bearer ${options.token}`;");
	}

	if (hasBasic) {
		body.push(
			'\tif (options.username !== undefined && options.password !== undefined) {',
			"\t\tconst encoded = typeof btoa === 'function'",
			"\t\t\t? btoa(`${options.username}:${options.password}`)",
			"\t\t\t: Buffer.from(`${options.username}:${options.password}`).toString('base64');",
			"\t\theaders['Authorization'] = `Basic ${encoded}`;",
			'\t}'
		);
	}

	for (const scheme of apiKeys) {
		if (scheme.in === 'header' && scheme.name) {
			body.push(`\tif (options.apiKey) headers[${JSON.stringify(scheme.name)}] = options.apiKey;`);
		}
	}

	const cookieKeys = apiKeys.filter((scheme) => scheme.in === 'cookie');
	const queryKeys = apiKeys.filter((scheme) => scheme.in === 'query');

	const notes = [
		'Credenciais vêm de quem constrói o cliente e nunca são gravadas no código',
		'gerado — o gerador lê `securitySchemes`, não valores.',
		...(cookieKeys.length > 0
			? [
					'',
					`A especificação declara ${cookieKeys.length} esquema(s) por cookie (${cookieKeys.map((scheme) => scheme.name ?? scheme.id).join(', ')}).`,
					'O SDK não os envia: cookie é responsabilidade do agente HTTP, e forjá-lo aqui',
					'quebraria a sessão de quem já está autenticado no navegador.',
				]
			: []),
		...(queryKeys.length > 0
			? [
					'',
					`A especificação declara ${queryKeys.length} esquema(s) por query string.`,
					'O SDK não os envia: credencial em URL vaza em log de servidor e em histórico.',
				]
			: []),
	];

	return `// Gerado. Não edite à mão.

${docComment(notes)}export interface AuthOptions {
${fields === '' ? '\t/** Esta API não declara esquema de autenticação. */\n\treadonly _?: never;' : fields}
}

export function applyAuth(headers: Record<string, string>, options: AuthOptions): void {
${body.length === 0 ? '\t// Nada a aplicar: a especificação não declara esquema suportado.' : body.join('\n')}
}
`;
}

function errorsFile(): string {
	return `// Gerado. Não edite à mão.

/** Erro devolvido pela API, com o código e o corpo preservados. */
export class ApiError extends Error {
	constructor(
		message: string,
		readonly statusCode: number,
		readonly response: unknown
	) {
		super(message);
		this.name = new.target.name;
	}
}

/** 400 e 422. */
export class ValidationError extends ApiError {}
/** 401 e 403. */
export class UnauthorizedError extends ApiError {}
/** 404. */
export class NotFoundError extends ApiError {}
/** 429. */
export class RateLimitError extends ApiError {}
/** 5xx. */
export class ServerError extends ApiError {}
`;
}

// ---------------------------------------------------------------------------
// Cliente, pacote e README
// ---------------------------------------------------------------------------

function clientFile(specification: SdkSpecification): string {
	const imports = specification.resources
		.map((resource) => `import { ${pascal(resource.name)}Resource } from './resources/${resource.name}.js';`)
		.join('\n');

	const fields = specification.resources
		.map((resource) => `\treadonly ${resource.name}: ${pascal(resource.name)}Resource;`)
		.join('\n');

	const assignments = specification.resources
		.map((resource) => `\t\tthis.${resource.name} = new ${pascal(resource.name)}Resource(transport);`)
		.join('\n');

	return `// Gerado a partir de ${specification.title} ${specification.apiVersion}. Não edite à mão.

import { Transport, type TransportOptions } from './runtime/http.js';
${imports}

export interface ClientOptions extends Partial<TransportOptions> {}

${docComment([
	`Cliente de ${specification.title}.`,
	'',
	'@example',
	`const client = new ApiClient({ token: process.env.API_TOKEN });`,
])}export class ApiClient {
${fields}

	constructor(options: ClientOptions = {}) {
		const transport = new Transport({ baseUrl: ${JSON.stringify(specification.baseUrl)}, ...options });
${assignments}
	}
}
`;
}

function packageJson(specification: SdkSpecification): string {
	return `${JSON.stringify(
		{
			name: specification.packageName,
			version: specification.version,
			description: `Cliente gerado de ${specification.title} ${specification.apiVersion}.`,
			type: 'module',
			main: './dist/index.js',
			types: './dist/index.d.ts',
			exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
			files: ['dist'],
			scripts: { build: 'tsc -p tsconfig.json' },
			// Sem dependências de execução: o runtime usa só `fetch`. Um SDK gerado
			// que arrasta uma biblioteca HTTP transfere para quem instala um
			// problema de versão que ele não escolheu ter.
			dependencies: {},
			devDependencies: { typescript: '^5.6.0' },
			lunarLimb: {
				apiVersion: specification.apiVersion,
				generatedFrom: specification.title,
			},
		},
		null,
		2
	)}\n`;
}

function tsconfig(): string {
	return `${JSON.stringify(
		{
			compilerOptions: {
				target: 'ES2022',
				module: 'NodeNext',
				moduleResolution: 'NodeNext',
				lib: ['ES2022', 'DOM'],
				strict: true,
				declaration: true,
				outDir: 'dist',
				rootDir: 'src',
				skipLibCheck: true,
			},
			include: ['src'],
		},
		null,
		2
	)}\n`;
}

function readme(specification: SdkSpecification): string {
	const first = specification.resources[0];
	const firstOperation = first?.operations[0];

	const authLines: string[] = [];
	if (specification.securitySchemes.some((scheme) => scheme.kind === 'http-bearer' || scheme.kind === 'oauth2')) {
		authLines.push('```ts', 'const client = new ApiClient({ token: process.env.API_TOKEN });', '```');
	}
	if (specification.securitySchemes.some((scheme) => scheme.kind === 'apiKey')) {
		authLines.push('```ts', 'const client = new ApiClient({ apiKey: process.env.API_KEY });', '```');
	}
	if (authLines.length === 0) authLines.push('Esta API não declara esquema de autenticação na especificação.');

	return [
		`# ${specification.packageName}`,
		'',
		`Cliente TypeScript de **${specification.title}**, gerado a partir da especificação OpenAPI.`,
		'',
		'| | |',
		'| --- | --- |',
		`| Versão do SDK | \`${specification.version}\` |`,
		`| Versão da API | \`${specification.apiVersion}\` |`,
		`| Recursos | ${specification.resources.length} |`,
		`| Modelos | ${specification.models.length} |`,
		'',
		'> Gerado automaticamente. Alterações feitas à mão são perdidas na próxima geração —',
		'> mude a especificação OpenAPI.',
		'',
		'## Instalação',
		'',
		'```bash',
		`npm install ${specification.packageName}`,
		'```',
		'',
		'## Configuração',
		'',
		'```ts',
		`import { ApiClient } from '${specification.packageName}';`,
		'',
		'const client = new ApiClient({',
		`  baseUrl: ${JSON.stringify(specification.baseUrl)},`,
		'  timeoutMs: 30_000,',
		'});',
		'```',
		'',
		'## Autenticação',
		'',
		...authLines,
		'',
		'Credenciais vêm do ambiente e nunca são gravadas no código gerado.',
		'',
		'## Quickstart',
		'',
		...(firstOperation ? ['```ts', renderExample(first.name, firstOperation), '```', ''] : []),
		'## Recursos',
		'',
		...specification.resources.flatMap((resource) => [
			`### \`client.${resource.name}\``,
			'',
			...resource.operations.map(
				(operation) =>
					`- \`${operation.name}()\` — \`${operation.method.toUpperCase()} ${operation.path}\`${operation.deprecated ? ' _(obsoleta)_' : ''}`
			),
			'',
		]),
		'## Erros',
		'',
		'Toda falha vira uma subclasse de `ApiError`, com `statusCode` e `response` preservados:',
		'',
		'```ts',
		"import { NotFoundError } from '" + specification.packageName + "';",
		'',
		'try {',
		'  await client.users.get({ id: "123" });',
		'} catch (error) {',
		'  if (error instanceof NotFoundError) { /* … */ }',
		'}',
		'```',
		'',
		...(specification.limitations.length > 0
			? [
					'## O que este SDK não cobre',
					'',
					'A especificação não permitiu representar tudo. O gerador registra o que ficou de fora',
					'em vez de gerar código que parece completo e falha em produção:',
					'',
					...specification.limitations.map((limitation) => `- ${limitation}`),
					'',
				]
			: []),
	].join('\n');
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export const typescriptRenderer: SdkRenderer = {
	language: 'typescript',

	render(specification) {
		const files: GeneratedFile[] = [
			{ path: 'src/runtime/http.ts', contents: httpRuntime() },
			{ path: 'src/runtime/serialization.ts', contents: serializationRuntime() },
			{ path: 'src/runtime/auth.ts', contents: authRuntime(specification) },
			{ path: 'src/errors.ts', contents: errorsFile() },
			{ path: 'src/client.ts', contents: clientFile(specification) },
			{
				path: 'src/models/index.ts',
				contents: [
					`// Gerado a partir de ${specification.title} ${specification.apiVersion}. Não edite à mão.`,
					'',
					// Um barril sem nenhum `export` não é módulo, e o `export * from`
					// sobre ele não compila. Especificação sem `components/schemas` é
					// caso normal, e o arquivo precisa continuar importável.
					specification.models.length === 0 ? 'export {};\n' : specification.models.map(renderModel).join('\n'),
				].join('\n'),
			},
			{
				path: 'src/index.ts',
				contents: [
					'// Gerado. Não edite à mão.',
					'',
					"export { ApiClient, type ClientOptions } from './client.js';",
					"export * from './models/index.js';",
					"export * from './errors.js';",
					"export type { AuthOptions } from './runtime/auth.js';",
					"export type { TransportOptions } from './runtime/http.js';",
					'',
				].join('\n'),
			},
			{ path: 'package.json', contents: packageJson(specification) },
			{ path: 'tsconfig.json', contents: tsconfig() },
			{ path: 'README.md', contents: readme(specification) },
		];

		for (const resource of specification.resources) files.push(renderResource(specification, resource));

		return files.sort((a, b) => a.path.localeCompare(b.path));
	},
};
