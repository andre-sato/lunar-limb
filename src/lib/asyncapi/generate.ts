/**
 * AsyncAPI → página de referência em Markdown.
 *
 * Existe porque `starlight-openapi` só entende OpenAPI: dado um documento
 * AsyncAPI, ele gera uma página com o título certo e **nenhuma operação** — o
 * pior tipo de falha, a silenciosa. AsyncAPI descreve canais e mensagens de um
 * sistema orientado a eventos; OpenAPI descreve rotas HTTP. Não são a mesma
 * coisa e não há conversão honesta entre elas.
 *
 * A transformação aqui é literal: tudo que sai na página está no documento. O
 * gerador não infere comportamento, não completa lacunas e não inventa exemplos.
 * Quando um campo falta, a página não fala dele.
 */

import yaml from 'js-yaml';

// ---------------------------------------------------------------------------
// Tipos do subconjunto de AsyncAPI 2.x que a página usa
// ---------------------------------------------------------------------------

export interface AsyncApiDocument {
	asyncapi: string;
	info: {
		title: string;
		version: string;
		description?: string;
		license?: { name: string; url?: string };
	};
	defaultContentType?: string;
	servers?: Record<string, AsyncApiServer>;
	channels?: Record<string, AsyncApiChannel>;
	components?: {
		messages?: Record<string, AsyncApiMessage>;
		schemas?: Record<string, JsonSchema>;
		securitySchemes?: Record<string, { type: string; description?: string }>;
		parameters?: Record<string, { description?: string; schema?: JsonSchema }>;
		messageTraits?: Record<string, { headers?: JsonSchema }>;
		operationTraits?: Record<string, { bindings?: Record<string, unknown> }>;
	};
}

interface AsyncApiServer {
	url: string;
	protocol: string;
	description?: string;
	security?: Array<Record<string, unknown>>;
	tags?: Array<{ name: string; description?: string }>;
}

interface AsyncApiChannel {
	description?: string;
	parameters?: Record<string, Ref | { description?: string; schema?: JsonSchema }>;
	publish?: AsyncApiOperation;
	subscribe?: AsyncApiOperation;
}

interface AsyncApiOperation {
	operationId?: string;
	summary?: string;
	description?: string;
	traits?: Array<Ref | Record<string, unknown>>;
	message?: Ref | AsyncApiMessage;
}

interface AsyncApiMessage {
	name?: string;
	title?: string;
	summary?: string;
	contentType?: string;
	traits?: Array<Ref | Record<string, unknown>>;
	payload?: Ref | JsonSchema;
}

interface Ref {
	$ref: string;
}

export interface JsonSchema {
	type?: string;
	format?: string;
	description?: string;
	enum?: unknown[];
	minimum?: number;
	maximum?: number;
	properties?: Record<string, JsonSchema | Ref>;
	items?: JsonSchema | Ref;
	required?: string[];
	$ref?: string;
}

export class AsyncApiError extends Error {}

// ---------------------------------------------------------------------------
// Parsing e resolução de referências
// ---------------------------------------------------------------------------

export function parseAsyncApi(raw: string): AsyncApiDocument {
	let loaded: unknown;
	try {
		loaded = yaml.load(raw);
	} catch (error) {
		throw new AsyncApiError(`Documento inválido: ${error instanceof Error ? error.message : error}`);
	}

	if (!loaded || typeof loaded !== 'object') {
		throw new AsyncApiError('Documento vazio.');
	}

	const document = loaded as Partial<AsyncApiDocument> & { openapi?: string; swagger?: string };

	if (document.openapi || document.swagger) {
		// Erro explícito em vez de gerar uma página vazia: quem passou um
		// OpenAPI aqui quer o `starlight-openapi`, não este gerador.
		throw new AsyncApiError(
			'Este documento é OpenAPI, não AsyncAPI. Coloque-o em src/schemas/ com a extensão .yaml e o plugin starlight-openapi o publica automaticamente.'
		);
	}
	if (!document.asyncapi) {
		throw new AsyncApiError('Documento sem o campo `asyncapi`: não é uma especificação AsyncAPI.');
	}
	if (!document.info?.title) {
		throw new AsyncApiError('Documento sem `info.title`.');
	}

	return document as AsyncApiDocument;
}

function isRef(value: unknown): value is Ref {
	return typeof value === 'object' && value !== null && typeof (value as Ref).$ref === 'string';
}

/**
 * Resolve uma referência interna (`#/components/...`).
 *
 * Só referências internas: um `$ref` para outro arquivo ou para uma URL exigiria
 * ler o disco ou a rede, e o gerador é uma transformação pura de um documento.
 * Referência externa é devolvida como está, e a página mostra o caminho — o
 * leitor vê que existe algo ali em vez de encontrar um vazio.
 */
export function resolveRef<T>(document: AsyncApiDocument, value: T | Ref, depth = 0): T | Ref {
	if (!isRef(value)) return value;
	if (depth > 10) return value; // ciclo: para em vez de estourar a pilha

	const pointer = value.$ref;
	if (!pointer.startsWith('#/')) return value;

	const segments = pointer.slice(2).split('/');
	let current: unknown = document;
	for (const segment of segments) {
		if (current === null || typeof current !== 'object') return value;
		// `~1` e `~0` são escapes de JSON Pointer para `/` e `~`.
		const key = segment.replace(/~1/g, '/').replace(/~0/g, '~');
		current = (current as Record<string, unknown>)[key];
	}

	if (current === undefined) return value;
	return resolveRef(document, current as T, depth + 1);
}

// ---------------------------------------------------------------------------
// Renderização
// ---------------------------------------------------------------------------

function escapeCell(value: string): string {
	// `|` fecharia a célula da tabela.
	return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

function code(value: string): string {
	return `\`${value.replace(/`/g, '')}\``;
}

/** Descreve o tipo de um schema em uma linha. */
export function describeType(document: AsyncApiDocument, schema: JsonSchema | Ref | undefined): string {
	if (!schema) return '—';
	const resolved = resolveRef(document, schema);
	if (isRef(resolved)) return code(resolved.$ref);

	const parts: string[] = [];
	if (resolved.type) parts.push(resolved.type);
	if (resolved.format) parts.push(`(${resolved.format})`);
	if (resolved.enum) parts.push(`— ${resolved.enum.map((value) => code(String(value))).join(' ou ')}`);

	const bounds: string[] = [];
	if (typeof resolved.minimum === 'number') bounds.push(`mín. ${resolved.minimum}`);
	if (typeof resolved.maximum === 'number') bounds.push(`máx. ${resolved.maximum}`);
	if (bounds.length > 0) parts.push(`(${bounds.join(', ')})`);

	return parts.length > 0 ? parts.join(' ') : '—';
}

/** Tabela de propriedades de um objeto. */
function renderProperties(document: AsyncApiDocument, schema: JsonSchema | Ref | undefined): string[] {
	const resolved = resolveRef(document, schema);
	if (isRef(resolved) || !resolved?.properties) return [];

	const required = new Set(resolved.required ?? []);
	const lines = ['| Campo | Tipo | Obrigatório | Descrição |', '| --- | --- | :-: | --- |'];

	for (const [name, property] of Object.entries(resolved.properties)) {
		const resolvedProperty = resolveRef(document, property);
		const description = isRef(resolvedProperty) ? '' : (resolvedProperty.description ?? '');
		lines.push(
			`| ${code(name)} | ${escapeCell(describeType(document, property))} | ${
				required.has(name) ? '✓' : ''
			} | ${escapeCell(description)} |`
		);
	}

	return lines;
}

function renderServers(document: AsyncApiDocument): string[] {
	const servers = Object.entries(document.servers ?? {});
	if (servers.length === 0) return [];

	const lines = ['## Servidores', ''];

	for (const [name, server] of servers) {
		lines.push(`### ${name}`, '');
		if (server.description) lines.push(server.description, '');

		lines.push('| Propriedade | Valor |', '| --- | --- |');
		lines.push(`| Endereço | ${code(server.url)} |`);
		lines.push(`| Protocolo | ${code(server.protocol)} |`);

		const security = (server.security ?? []).flatMap((entry) => Object.keys(entry));
		if (security.length > 0) {
			lines.push(`| Segurança | ${security.map(code).join(', ')} |`);
		}
		lines.push('');

		if (server.tags && server.tags.length > 0) {
			lines.push('| Tag | Significado |', '| --- | --- |');
			for (const tag of server.tags) {
				lines.push(`| ${code(tag.name)} | ${escapeCell(tag.description ?? '')} |`);
			}
			lines.push('');
		}
	}

	return lines;
}

/**
 * Sentido de cada operação, na perspectiva de quem integra.
 *
 * Este é o ponto que mais confunde em AsyncAPI 2.x: `publish` significa "a
 * aplicação aceita que você publique aqui", e `subscribe`, "a aplicação publica
 * e você consome". A perspectiva é a da aplicação descrita, não a sua — então a
 * página diz explicitamente o que **você** faz.
 */
const OPERATION_MEANING: Record<'publish' | 'subscribe', { label: string; action: string }> = {
	publish: { label: 'publish', action: 'você **publica** mensagens neste canal' },
	subscribe: { label: 'subscribe', action: 'você **consome** mensagens deste canal' },
};

function renderChannels(document: AsyncApiDocument): string[] {
	const channels = Object.entries(document.channels ?? {});
	if (channels.length === 0) return [];

	const lines = ['## Canais', ''];

	for (const [address, channel] of channels) {
		lines.push(`### ${code(address)}`, '');
		if (channel.description) lines.push(channel.description, '');

		const parameters = Object.entries(channel.parameters ?? {});
		if (parameters.length > 0) {
			lines.push('**Parâmetros do endereço**', '');
			lines.push('| Parâmetro | Tipo | Descrição |', '| --- | --- | --- |');
			for (const [name, parameter] of parameters) {
				const resolved = resolveRef(document, parameter);
				const description = isRef(resolved) ? '' : (resolved.description ?? '');
				const schema = isRef(resolved) ? undefined : resolved.schema;
				lines.push(
					`| ${code(`{${name}}`)} | ${escapeCell(describeType(document, schema))} | ${escapeCell(description)} |`
				);
			}
			lines.push('');
		}

		for (const kind of ['publish', 'subscribe'] as const) {
			const operation = channel[kind];
			if (!operation) continue;

			const meaning = OPERATION_MEANING[kind];
			lines.push(`#### ${operation.operationId ?? meaning.label}`, '');
			lines.push(`Operação ${code(meaning.label)}: ${meaning.action}.`, '');

			if (operation.summary) lines.push(operation.summary, '');
			if (operation.description) lines.push(operation.description, '');

			const message = resolveRef(document, operation.message);
			if (message && !isRef(message)) {
				const label = message.title ?? message.name ?? 'mensagem';
				lines.push(`**Mensagem:** ${label}`, '');
				if (message.summary) lines.push(message.summary, '');

				const contentType = message.contentType ?? document.defaultContentType;
				if (contentType) lines.push(`Content type: ${code(contentType)}`, '');

				const payload = renderProperties(document, message.payload);
				if (payload.length > 0) {
					lines.push('**Payload**', '', ...payload, '');
				}

				const headers = messageHeaders(document, message);
				if (headers.length > 0) {
					lines.push('**Cabeçalhos**', '', ...headers, '');
				}
			}

			const bindings = operationBindings(document, operation);
			if (bindings.length > 0) {
				lines.push('**Bindings**', '', ...bindings, '');
			}
		}
	}

	return lines;
}

/** Cabeçalhos que a mensagem herda dos seus traits. */
function messageHeaders(document: AsyncApiDocument, message: AsyncApiMessage): string[] {
	for (const trait of message.traits ?? []) {
		const resolved = resolveRef(document, trait) as { headers?: JsonSchema } | Ref;
		if (isRef(resolved) || !resolved.headers) continue;
		const rendered = renderProperties(document, resolved.headers);
		if (rendered.length > 0) return rendered;
	}
	return [];
}

/** Protocolo e configuração declarados nos traits da operação. */
function operationBindings(document: AsyncApiDocument, operation: AsyncApiOperation): string[] {
	const lines: string[] = [];

	for (const trait of operation.traits ?? []) {
		const resolved = resolveRef(document, trait) as { bindings?: Record<string, unknown> } | Ref;
		if (isRef(resolved) || !resolved.bindings) continue;

		for (const [protocol, binding] of Object.entries(resolved.bindings)) {
			if (!binding || typeof binding !== 'object') continue;
			for (const [key, value] of Object.entries(binding as Record<string, unknown>)) {
				// `describeType` já inclui o enum; repeti-lo aqui duplicaria os
				// valores na mesma linha.
				lines.push(`- ${code(protocol)} · ${code(key)}: ${escapeCell(describeType(document, value as JsonSchema))}`);
			}
		}
	}

	return lines;
}

function renderSecuritySchemes(document: AsyncApiDocument): string[] {
	const schemes = Object.entries(document.components?.securitySchemes ?? {});
	if (schemes.length === 0) return [];

	const lines = ['## Autenticação', '', '| Esquema | Tipo | Como usar |', '| --- | --- | --- |'];
	for (const [name, scheme] of schemes) {
		lines.push(`| ${code(name)} | ${code(scheme.type)} | ${escapeCell(scheme.description ?? '')} |`);
	}
	lines.push('');

	return lines;
}

function renderSchemas(document: AsyncApiDocument): string[] {
	const schemas = Object.entries(document.components?.schemas ?? {});
	// Só os schemas que são objetos com propriedades: os escalares já aparecem
	// inline nas tabelas de payload, e repeti-los aqui seria ruído.
	const objects = schemas.filter(([, schema]) => Boolean((schema as JsonSchema).properties));
	if (objects.length === 0) return [];

	const lines = ['## Schemas', ''];
	for (const [name, schema] of objects) {
		lines.push(`### ${code(name)}`, '');
		if (schema.description) lines.push(schema.description, '');
		lines.push(...renderProperties(document, schema), '');
	}

	return lines;
}

export interface GenerateOptions {
	/** Caminho do arquivo de origem, citado na página. */
	sourcePath: string;
	/** Rótulo e ordem na navegação. */
	sidebarOrder?: number;
	tags?: string[];
}

/** Monta a página completa, com frontmatter. */
export function generateReferencePage(document: AsyncApiDocument, options: GenerateOptions): string {
	const { info } = document;

	const description =
		firstParagraph(info.description) ?? `Referência da ${info.title}, versão ${info.version}.`;

	const frontmatter = [
		'---',
		`title: ${quote(info.title)}`,
		`description: ${quote(description)}`,
	];
	if (options.sidebarOrder !== undefined) {
		frontmatter.push('sidebar:', `  order: ${options.sidebarOrder}`);
	}
	if (options.tags && options.tags.length > 0) {
		frontmatter.push(`tags: [${options.tags.join(', ')}]`);
	}
	frontmatter.push('---');

	const header = [
		'',
		`:::note[Página gerada]`,
		`Esta página é gerada a partir de ${code(options.sourcePath)} pelo comando`,
		'`npm run docs:asyncapi`. Edite a especificação, não esta página.',
		':::',
		'',
		'| Propriedade | Valor |',
		'| --- | --- |',
		`| Especificação | AsyncAPI ${code(document.asyncapi)} |`,
		`| Versão da API | ${code(info.version)} |`,
	];
	if (document.defaultContentType) {
		header.push(`| Content type padrão | ${code(document.defaultContentType)} |`);
	}
	if (info.license) {
		header.push(
			`| Licença | ${info.license.url ? `[${info.license.name}](${info.license.url})` : info.license.name} |`
		);
	}
	header.push('');

	// A descrição vem sob um `##` próprio: ela costuma trazer os seus próprios
	// headings, e sem um pai eles ficariam no mesmo nível das seções geradas —
	// o sumário da Starlight (h2/h3) mostraria a estrutura errada.
	const body = info.description ? ['## Visão geral', '', info.description.trim(), ''] : [];

	return [
		...frontmatter,
		...header,
		...body,
		...renderServers(document),
		...renderChannels(document),
		...renderSchemas(document),
		...renderSecuritySchemes(document),
	]
		.join('\n')
		.replace(/\n{3,}/g, '\n\n')
		.trimEnd()
		.concat('\n');
}

function firstParagraph(text: string | undefined): string | undefined {
	if (!text) return undefined;
	const paragraph = text.trim().split(/\r?\n\s*\r?\n/)[0]?.replace(/\s+/g, ' ').trim();
	if (!paragraph) return undefined;
	return paragraph.length > 160 ? `${paragraph.slice(0, 157).trimEnd()}…` : paragraph;
}

function quote(value: string): string {
	return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
