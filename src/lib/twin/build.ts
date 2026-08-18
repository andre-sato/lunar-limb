/**
 * Construção do Digital Twin a partir das fontes de verdade (§2, §6, §7).
 *
 * Cada fonte entra por uma função própria, e todas são puras: recebem o material
 * já lido e devolvem nós e arestas. Quem toca disco é `load.ts`. Essa divisão é o
 * que permite testar "endpoint implementado e não documentado" sem repositório.
 *
 * O Content Graph existente é **preservado** (§6): ele entra como uma camada do
 * Twin, com as mesmas relações de `uses` e `used-by` que o editor já usa. Nada
 * dele é reinterpretado.
 */

import type { ContentGraph } from '../editor/graph-model';
import type { ApiModel } from '../api-explorer/model';
import type { GlossDef } from '../glossary/types';
import { twinId, type TwinEdge, type TwinGraph, type TwinNode } from './types';

export interface BuildInput {
	graph?: ContentGraph;
	/** Prefixos de caminho considerados internos ao portal. */
	internal?: readonly string[];
	/** Especificações lidas, com o caminho de cada uma. */
	apis?: ReadonlyArray<{ path: string; model: ApiModel; kind: 'openapi' | 'asyncapi' }>;
	/** Páginas com o corpo, para derivar `documents` e `references`. */
	pages?: ReadonlyArray<{ path: string; title?: string; body: string; version?: string }>;
	/** Rotas implementadas no código, do roteamento por arquivo. */
	routes?: ReadonlyArray<{ file: string; path: string; methods: string[] }>;
	glossary?: readonly GlossDef[];
	/** Identificadores de teste conhecidos. */
	tests?: readonly string[];
	/** Versões declaradas no registro. */
	versions?: ReadonlyArray<{ id: string; lifecycle: string }>;
}

class Builder {
	readonly nodes = new Map<string, TwinNode>();
	readonly edges: TwinEdge[] = [];

	node(node: TwinNode): TwinNode {
		const existing = this.nodes.get(node.id);
		if (existing) {
			// Um nó pode ser descoberto por duas fontes — o endpoint aparece na
			// especificação e no código. A segunda descoberta enriquece a primeira em
			// vez de substituí-la, senão a ordem de leitura mudaria o resultado.
			existing.source = existing.source ?? node.source;
			existing.version = existing.version ?? node.version;
			existing.metadata = { ...node.metadata, ...existing.metadata };
			return existing;
		}
		this.nodes.set(node.id, node);
		return node;
	}

	edge(from: string, to: string, relation: TwinEdge['relation'], origin: TwinEdge['origin']): void {
		if (!this.nodes.has(from) || !this.nodes.has(to)) return;
		if (this.edges.some((edge) => edge.from === from && edge.to === to && edge.relation === relation)) return;
		this.edges.push({ from, to, relation, origin });
	}
}

/** Normaliza o caminho de um endpoint para comparação entre fontes. */
export function normalizeEndpointPath(path: string): string {
	return (
		path
			.replace(/\/+$/, '')
			// `{id}` e `[id]` são o mesmo parâmetro escrito em duas convenções: a do
			// OpenAPI e a do roteamento por arquivo da Astro. Sem normalizar, todo
			// endpoint com parâmetro apareceria como implementado **e** documentado
			// separadamente — dois problemas inventados de uma vez.
			.replace(/\[(?:\.{3})?([^\]]+)\]/g, '{$1}')
			.replace(/\/{2,}/g, '/') || '/'
	);
}

export function endpointKey(method: string, path: string): string {
	return `${method.toUpperCase()} ${normalizeEndpointPath(path)}`;
}

/** O caminho casa com algum prefixo interno? */
export function isInternal(routePath: string, prefixes: readonly string[] | undefined): boolean {
	return (prefixes ?? []).some((prefix) => routePath.startsWith(prefix));
}

export function buildTwin(input: BuildInput): TwinGraph {
	const builder = new Builder();

	addPages(builder, input);
	addContentGraph(builder, input);
	addApis(builder, input);
	addRoutes(builder, input);
	addGlossary(builder, input);
	addTests(builder, input);
	addVersions(builder, input);
	linkDocumentation(builder, input);

	return { nodes: [...builder.nodes.values()], edges: builder.edges, generatedAt: Date.now() };
}

// ---------------------------------------------------------------------------
// Documentação
// ---------------------------------------------------------------------------

function addPages(builder: Builder, input: BuildInput): void {
	for (const page of input.pages ?? []) {
		builder.node({
			id: twinId.page(page.path),
			type: 'page',
			name: page.title ?? page.path,
			source: `src/content/docs/${page.path}`,
			version: page.version,
		});
	}
}

/** O Content Graph vira uma camada do Twin, com as relações que já tinha (§6). */
function addContentGraph(builder: Builder, input: BuildInput): void {
	const graph = input.graph;
	if (!graph) return;

	for (const node of graph.nodes) {
		if (node.type === 'block') {
			builder.node({
				id: twinId.snippet(node.id),
				type: 'snippet',
				name: node.title ?? node.id,
				source: `src/content/snippets/${node.path}`,
			});
		} else {
			builder.node({
				id: twinId.page(node.path),
				type: 'page',
				name: node.title ?? node.path,
				source: `src/content/docs/${node.path}`,
			});
		}
	}

	for (const edge of graph.edges) {
		const source = graph.nodes.find((node) => node.key === edge.source);
		if (!source) continue;

		const from = source.type === 'block' ? twinId.snippet(source.id) : twinId.page(source.path);
		const to = edge.refType === 'block' ? twinId.snippet(edge.target) : twinId.page(edge.target);

		builder.edge(from, to, 'uses', 'declared');
		builder.edge(to, from, 'used-by', 'declared');
	}
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * O prefixo que a especificação declara como servidor.
 *
 * `servers: [{ url: /api }]` quer dizer que `/auth/me` na especificação é
 * `/api/auth/me` no ar. Sem juntar as duas partes, o mesmo endpoint vira **dois**
 * nós — um "declarado na especificação" e outro "implementado no código" — e
 * ambos aparecem como não documentados. Foi o que a primeira medição mostrou.
 *
 * Só servidor relativo entra: uma URL absoluta aponta para outro host, e ali o
 * caminho da especificação já é o caminho completo.
 */
export function basePathOf(model: ApiModel): string {
	const first = model.servers[0] ?? '';
	if (!first.startsWith('/')) return '';
	return first.replace(/\/+$/, '');
}

function addApis(builder: Builder, input: BuildInput): void {
	for (const { path: file, model, kind } of input.apis ?? []) {
		const base = basePathOf(model);
		const apiNode = builder.node({
			id: twinId.api(file),
			type: 'api',
			name: model.title,
			source: file,
			version: model.version,
			metadata: { kind },
		});

		for (const operation of model.operations) {
			const key = endpointKey(operation.method, `${base}${operation.path}`);
			builder.node({
				id: twinId.endpoint(key),
				type: 'endpoint',
				name: key,
				source: file,
				version: model.version,
				metadata: {
					operationId: operation.id,
					deprecated: operation.deprecated,
					tags: operation.tags,
					hasExample: Boolean(operation.requestBody?.example),
					security: operation.security.map((scheme) => scheme.id),
				},
			});

			builder.edge(apiNode.id, twinId.endpoint(key), 'contains', 'declared');

			if (operation.requestBody?.example) {
				const exampleId = twinId.example(`${key} requisição`);
				builder.node({ id: exampleId, type: 'example', name: `Exemplo de ${key}`, source: file });
				builder.edge(twinId.endpoint(key), exampleId, 'contains', 'declared');
			}
		}

		for (const scheme of model.securitySchemes) {
			const schemaId = twinId.schema(`${file}#${scheme.id}`);
			builder.node({ id: schemaId, type: 'schema', name: scheme.id, source: file, metadata: { kind: 'security' } });
			builder.edge(apiNode.id, schemaId, 'contains', 'declared');
		}
	}
}

/**
 * Rotas implementadas, derivadas do roteamento por arquivo.
 *
 * Este é o "Code Graph" do §6 nesta base: a Astro mapeia arquivo para rota de
 * forma determinística, então `src/pages/api/auth/me.ts` que exporta `GET`
 * **implementa** `GET /api/auth/me`. Não é heurística — é a regra do framework.
 *
 * A §7 pede que a arquitetura permita acrescentar analisadores de TypeScript,
 * Java, Python e outros. Por isso a fonte entra aqui já normalizada em
 * `{ arquivo, caminho, métodos }`: acrescentar uma linguagem é produzir essa
 * lista de outro jeito, sem tocar no grafo.
 */
function addRoutes(builder: Builder, input: BuildInput): void {
	for (const route of input.routes ?? []) {
		const codeId = twinId.code(route.file);
		builder.node({
			id: codeId,
			type: 'code',
			name: route.file.replace(/^src\/pages\//, ''),
			source: route.file,
			metadata: { methods: route.methods },
		});

		for (const method of route.methods) {
			const key = endpointKey(method, route.path);
			builder.node({
				id: twinId.endpoint(key),
				type: 'endpoint',
				name: key,
				// Interno é rota do próprio portal — editor, painel administrativo. Ela
				// entra no grafo e fica fora da cobertura: um endpoint declarado numa
				// especificação, porém, é público por definição, e o `node()` preserva o
				// que já foi registrado por ela.
				metadata: { implemented: true, internal: isInternal(route.path, input.internal) },
			});
			// A implementação é conhecida pela convenção do framework, não declarada
			// por alguém — daí `derived`.
			builder.edge(codeId, twinId.endpoint(key), 'implements', 'derived');
		}
	}
}

// ---------------------------------------------------------------------------
// Glossário, testes e versões
// ---------------------------------------------------------------------------

function addGlossary(builder: Builder, input: BuildInput): void {
	for (const term of input.glossary ?? []) {
		builder.node({
			id: twinId.glossary(term.id),
			type: 'glossary',
			name: term.term,
			source: `src/content/glossary/${term.id}.md`,
		});
	}
}

function addTests(builder: Builder, input: BuildInput): void {
	for (const id of input.tests ?? []) {
		builder.node({ id: twinId.test(id), type: 'test', name: id });
	}
}

function addVersions(builder: Builder, input: BuildInput): void {
	for (const version of input.versions ?? []) {
		builder.node({
			id: twinId.version(version.id),
			type: 'version',
			name: version.id,
			metadata: { lifecycle: version.lifecycle },
		});
	}
}

// ---------------------------------------------------------------------------
// Ligações a partir do texto das páginas
// ---------------------------------------------------------------------------

const TRY_IT = /<TryIt\b[^>]*schema=["']([^"']+)["'][^>]*operation=["']([^"']+)["'][^>]*>/g;
const PROVENANCE_CODE = /source:\s*((?:src|scripts)\/[^\s:]+\.[A-Za-z]+)(?::\d+)?/g;

function linkDocumentation(builder: Builder, input: BuildInput): void {
	const operationIndex = new Map<string, string>();
	for (const { path: file, model } of input.apis ?? []) {
		const base = basePathOf(model);
		for (const operation of model.operations) {
			operationIndex.set(
				`${file.replace(/^.*\//, '')}::${operation.id}`,
				endpointKey(operation.method, `${base}${operation.path}`)
			);
		}
	}

	const endpointPaths = [...builder.nodes.values()]
		.filter((node) => node.type === 'endpoint')
		.map((node) => ({ id: node.id, path: node.name.split(' ').slice(1).join(' ') }));

	for (const page of input.pages ?? []) {
		const pageId = twinId.page(page.path);
		if (!builder.nodes.has(pageId)) continue;

		// 1. `<TryIt/>`: declaração explícita de que a página exercita a operação.
		for (const match of page.body.matchAll(TRY_IT)) {
			const key = operationIndex.get(`${match[1]}::${match[2]}`);
			if (key) builder.edge(pageId, twinId.endpoint(key), 'documents', 'declared');
		}

		// 2. Caminho literal do endpoint no texto. Inferência, e por isso exige o
		//    caminho inteiro — não o nome do recurso.
		for (const endpoint of endpointPaths) {
			if (endpoint.path.split('/').filter(Boolean).length < 2) continue;
			if (page.body.includes(endpoint.path)) builder.edge(pageId, endpoint.id, 'documents', 'derived');
		}

		// 3. Proveniência apontando para código: a página referencia o arquivo.
		for (const match of page.body.matchAll(PROVENANCE_CODE)) {
			const codeId = twinId.code(match[1]);
			if (!builder.nodes.has(codeId)) {
				builder.node({ id: codeId, type: 'code', name: match[1], source: match[1] });
			}
			builder.edge(pageId, codeId, 'references', 'declared');
		}

		// 4. Proveniência apontando para teste: o teste valida o que a página afirma.
		for (const id of input.tests ?? []) {
			if (page.body.includes(`source: ${id}`)) {
				builder.edge(pageId, twinId.test(id), 'validated-by', 'declared');
			}
		}

		// 5. Termos do glossário mencionados.
		for (const term of input.glossary ?? []) {
			if (page.body.includes(term.term)) builder.edge(pageId, twinId.glossary(term.id), 'defines', 'derived');
		}

		if (page.version) builder.edge(pageId, twinId.version(page.version), 'belongs-to', 'declared');
	}
}
