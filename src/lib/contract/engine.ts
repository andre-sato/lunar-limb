/**
 * Motor de Contract Testing (§3, §6, §9, §18, §22, §25).
 *
 * A parte que toca disco. Ela lê as especificações e as páginas, usa o **Digital
 * Twin** para saber quem documenta o quê (§25 — esta camada não mantém grafo
 * próprio) e chama as verificações puras de `assertions.ts`.
 *
 * Um contrato aqui é um endpoint da especificação mais as páginas que o
 * documentam. Sem página associada ele fica `unknown`, não `valid`: contrato que
 * ninguém documenta não está certo, está sem documentação — e isso é assunto da
 * cobertura do Twin, não deste relatório.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { parseOpenApi, type ApiModel, type ApiOperation } from '../api-explorer/model';
import { basePathOf, endpointKey } from '../twin/build';
import { getTwin } from '../twin/load';
import { twinId } from '../twin/types';
import {
	checkAuthentication,
	checkCodeExample,
	checkMethodAndPath,
	checkParameters,
	checkRequestExample,
	checkResponseExample,
	checkStatusCodes,
	type SchemaLike,
} from './assertions';
import {
	extractCodeBlocks,
	extractCurlRequests,
	extractHttpRequests,
	extractJsonBlocks,
	extractParameterMentions,
	extractStatusMentions,
	parseDeclaredContract,
} from './extract';
import {
	countByStatus,
	worstContractStatus,
	type ContractAssertion,
	type ContractDimension,
	type ContractReport,
	type ContractScore,
	type DocumentationContract,
	type DocumentationReference,
} from './types';

const ROOT = process.cwd();
const DOCS_ROOT = path.resolve(ROOT, 'src/content/docs');
const SCHEMAS_ROOT = path.resolve(ROOT, 'src/schemas');
const BASELINE_FILE = path.resolve(ROOT, 'contracts.yml');

// ---------------------------------------------------------------------------
// Baseline (§22)
// ---------------------------------------------------------------------------

export interface BaselineContract {
	endpoint: string;
	response?: { status?: string };
	required?: string[];
}

/**
 * Contratos declarados à mão, para APIs sem OpenAPI completo.
 *
 * É o caminho de adoção gradual da §22: a equipe descreve o mínimo — o endpoint,
 * o status esperado, os campos obrigatórios — e passa a ter verificação sobre
 * isso enquanto a especificação não existe.
 */
export interface ContractConfig {
	/** Bloquear o merge quando houver contrato quebrado (§21). */
	failOnBreaking: boolean;
}

export const DEFAULT_CONTRACT_CONFIG: ContractConfig = { failOnBreaking: true };

/**
 * Configuração do portão (§21).
 *
 * `failOnBreaking` liga por padrão, e só `invalid` bloqueia — `warning` nunca.
 * Aviso é meio caminho (parâmetro obrigatório que a página não lista, campo a
 * mais numa requisição), e bloquear merge por meio caminho leva a equipe a
 * desligar o portão inteiro, que é o resultado oposto ao pretendido.
 */
export async function loadContractConfig(): Promise<ContractConfig> {
	try {
		const raw = await readFile(BASELINE_FILE, 'utf-8');
		const parsed = yaml.load(raw) as { contracts?: unknown; failOnBreaking?: boolean } | null | undefined;
		return { failOnBreaking: parsed?.failOnBreaking !== false };
	} catch {
		return DEFAULT_CONTRACT_CONFIG;
	}
}

export async function loadBaselines(): Promise<BaselineContract[]> {
	try {
		const raw = await readFile(BASELINE_FILE, 'utf-8');
		const parsed = yaml.load(raw) as { contracts?: BaselineContract[] } | null | undefined;
		return (parsed?.contracts ?? []).filter((entry) => typeof entry?.endpoint === 'string');
	} catch {
		return [];
	}
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

async function walk(dir: string, base = ''): Promise<string[]> {
	const found: string[] = [];
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return found;
	}
	for (const entry of entries) {
		const relative = base ? `${base}/${entry.name}` : entry.name;
		if (entry.isDirectory()) found.push(...(await walk(path.join(dir, entry.name), relative)));
		else if (/\.mdx?$/.test(entry.name)) found.push(relative);
	}
	return found;
}

interface SpecFile {
	path: string;
	model: ApiModel;
	document: Record<string, unknown>;
	basePath: string;
}

async function readSpecs(): Promise<SpecFile[]> {
	let files: string[];
	try {
		files = (await readdir(SCHEMAS_ROOT)).filter((file) => /\.(ya?ml|json)$/i.test(file));
	} catch {
		return [];
	}

	const specs: SpecFile[] = [];

	for (const file of files) {
		const raw = await readFile(path.join(SCHEMAS_ROOT, file), 'utf-8');
		if (!/^\s*["']?(openapi|swagger)["']?\s*:/m.test(raw)) continue;

		try {
			const model = parseOpenApi(raw);
			const document = (/\.json$/i.test(file) ? JSON.parse(raw) : yaml.load(raw)) as Record<string, unknown>;
			specs.push({ path: `src/schemas/${file}`, model, document, basePath: basePathOf(model) });
		} catch {
			// Especificação inválida: os testes de documentação já reclamam dela.
		}
	}

	return specs;
}

/** Schema de resposta de uma operação, resolvido do documento bruto. */
function responseSchemaOf(spec: SpecFile, operation: ApiOperation, status: string): SchemaLike | undefined {
	const paths = spec.document.paths as Record<string, Record<string, unknown>> | undefined;
	const entry = paths?.[operation.path]?.[operation.method] as
		| { responses?: Record<string, { content?: Record<string, { schema?: unknown }> }> }
		| undefined;

	const content = entry?.responses?.[status]?.content;
	if (!content) return undefined;

	const media = content['application/json'] ?? Object.values(content)[0];
	return resolveRefs(spec.document, media?.schema) as SchemaLike | undefined;
}

/** Resolve `$ref` interno, para a comparação não parar num ponteiro. */
function resolveRefs(document: Record<string, unknown>, value: unknown, depth = 0): unknown {
	if (!value || typeof value !== 'object' || depth > 8) return value;

	if ('$ref' in value) {
		const pointer = String((value as { $ref: string }).$ref);
		if (!pointer.startsWith('#/')) return value;

		let current: unknown = document;
		for (const segment of pointer.slice(2).split('/')) {
			const key = segment.replace(/~1/g, '/').replace(/~0/g, '~');
			current = (current as Record<string, unknown> | undefined)?.[key];
			if (current === undefined) return value;
		}
		return resolveRefs(document, current, depth + 1);
	}

	if (Array.isArray(value)) return value.map((item) => resolveRefs(document, item, depth + 1));

	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, resolveRefs(document, item, depth + 1)])
	);
}

// ---------------------------------------------------------------------------
// Score (§18)
// ---------------------------------------------------------------------------

export function scoreContracts(contracts: readonly DocumentationContract[]): ContractScore {
	const dimensions = new Map<ContractDimension, { good: number; checked: number }>();

	for (const contract of contracts) {
		for (const assertion of contract.assertions) {
			// `unknown` não entra na conta: não se pontua o que não foi verificado.
			// Contá-lo como erro puniria a ausência de contrato, e como acerto
			// premiaria a mesma ausência.
			if (assertion.status === 'unknown') continue;

			const entry = dimensions.get(assertion.dimension) ?? { good: 0, checked: 0 };
			entry.checked++;
			if (assertion.status === 'valid') entry.good++;
			// `warning` conta como verificado e não conta como bom: ele é meio
			// caminho, e arredondá-lo para qualquer lado esconderia o que ele é.
			dimensions.set(assertion.dimension, entry);
		}
	}

	const byDimension = [...dimensions.entries()].map(([dimension, entry]) => ({
		dimension,
		value: Math.round((entry.good / entry.checked) * 100),
		checked: entry.checked,
	}));

	const totalChecked = byDimension.reduce((sum, entry) => sum + entry.checked, 0);
	const totalGood = byDimension.reduce((sum, entry) => sum + (entry.value / 100) * entry.checked, 0);

	return {
		value: totalChecked === 0 ? 0 : Math.round((totalGood / totalChecked) * 100),
		byDimension: byDimension.sort((a, b) => a.value - b.value),
	};
}

// ---------------------------------------------------------------------------
// Análise
// ---------------------------------------------------------------------------

export interface ContractOptions {
	/** Restringe às páginas alteradas (`--changed`). */
	changed?: readonly string[];
	/** Restringe a uma especificação. */
	api?: string;
}

export async function runContractTests(options: ContractOptions = {}): Promise<ContractReport> {
	const [specs, baselines, twin] = await Promise.all([readSpecs(), loadBaselines(), getTwin({ fresh: true })]);

	const selectedSpecs = options.api ? specs.filter((spec) => spec.path.endsWith(options.api!)) : specs;

	const files = await walk(DOCS_ROOT);
	const pages = new Map<string, string>();
	for (const relative of files) {
		pages.set(relative, await readFile(path.join(DOCS_ROOT, relative), 'utf-8'));
	}

	const contracts: DocumentationContract[] = [];

	for (const spec of selectedSpecs) {
		const securityIndex = new Map(
			spec.model.securitySchemes.map((scheme) => [scheme.id, { kind: scheme.kind, name: scheme.name, in: scheme.in }])
		);

		for (const operation of spec.model.operations) {
			const key = endpointKey(operation.method, `${spec.basePath}${operation.path}`);

			// Quem documenta o quê vem do Twin (§25). Este motor não monta grafo.
			const references: DocumentationReference[] = twin.graph.edges
				.filter((edge) => edge.relation === 'documents' && edge.to === twinId.endpoint(key))
				.map((edge) => ({
					// O id do nó no Twin não tem extensão; o relatório aponta arquivos, e
					// um caminho sem extensão não abre no editor de ninguém.
					path: resolvePagePath(edge.from.replace(/^page:/, ''), pages),
					association: edge.origin === 'declared' ? ('declared' as const) : ('inferred' as const),
				}));

			// Declaração explícita no frontmatter tem precedência sobre a inferência.
			for (const [pagePath, raw] of pages) {
				const declared = parseDeclaredContract(raw);
				if (!declared) continue;
				if (!declared.ref.includes(operation.path.replace(/\//g, '~1'))) continue;
				if (declared.path && !spec.path.endsWith(declared.path)) continue;

				const existing = references.find((reference) => reference.path.replace(/\.mdx?$/, '') === pagePath.replace(/\.mdx?$/, ''));
				if (existing) existing.association = 'declared';
				else references.push({ path: pagePath, association: 'declared' });
			}

			const relevant = options.changed
				? references.filter((reference) => options.changed!.some((changed) => changed.endsWith(reference.path)))
				: references;

			if (options.changed && relevant.length === 0) continue;

			const assertions: ContractAssertion[] = [];

			if (references.length === 0) {
				// Sem página associada não há contrato a verificar. `unknown`, não
				// `valid`: cobertura é problema do Twin, e marcá-lo como válido aqui
				// inflaria o score com endpoints que ninguém documentou.
				assertions.push({
					id: 'CONTRACT-DOC-000',
					dimension: 'path',
					status: 'unknown',
					message: 'Nenhuma página documenta este endpoint.',
				});
			}

			for (const reference of relevant) {
				const raw = pages.get(reference.path) ?? pages.get(`${reference.path}.md`) ?? pages.get(`${reference.path}.mdx`);
				if (!raw) continue;

				assertions.push(...assertOverPage(raw, reference.path, spec, operation, securityIndex));
			}

			contracts.push({
				id: key,
				source: { type: 'openapi', path: spec.path, pointer: `#/paths/${operation.path.replace(/\//g, '~1')}/${operation.method}` },
				documentation: references,
				assertions,
				status: worstContractStatus(assertions.map((assertion) => assertion.status)),
			});
		}
	}

	// Baselines (§22): contratos declarados à mão para APIs sem especificação.
	for (const baseline of baselines) {
		const [method, endpointPath] = baseline.endpoint.split(/\s+/);
		if (!method || !endpointPath) continue;

		const key = endpointKey(method, endpointPath);
		if (contracts.some((contract) => contract.id === key)) continue;

		const references: DocumentationReference[] = twin.graph.edges
			.filter((edge) => edge.relation === 'documents' && edge.to === twinId.endpoint(key))
			.map((edge) => ({ path: edge.from.replace(/^page:/, ''), association: 'inferred' as const }));

		const assertions: ContractAssertion[] = [];

		for (const reference of references) {
			const raw = pages.get(reference.path) ?? pages.get(`${reference.path}.md`) ?? pages.get(`${reference.path}.mdx`);
			if (!raw) continue;

			const blocks = extractCodeBlocks(raw);
			const schema: SchemaLike = { type: 'object', required: baseline.required ?? [] };

			for (const json of extractJsonBlocks(blocks)) {
				assertions.push(
					...checkResponseExample(
						{ value: json.value, location: { path: reference.path, line: json.line } },
						schema,
						baseline.response?.status ?? '200'
					)
				);
			}
		}

		if (assertions.length === 0) {
			assertions.push({
				id: 'CONTRACT-BASE-000',
				dimension: 'response',
				status: 'unknown',
				message: 'Baseline declarada, sem exemplo documentado para comparar.',
			});
		}

		contracts.push({
			id: key,
			source: { type: 'baseline', path: 'contracts.yml', pointer: baseline.endpoint },
			documentation: references,
			assertions,
			status: worstContractStatus(assertions.map((assertion) => assertion.status)),
		});
	}

	return {
		contracts: contracts.sort(
			(a, b) => worstOrder(a.status) - worstOrder(b.status) || a.id.localeCompare(b.id)
		),
		score: scoreContracts(contracts),
		counts: countByStatus(contracts),
		breaking: [],
		generatedAt: Date.now(),
	};
}

/** Devolve o caminho com extensão, do jeito que o arquivo existe em disco. */
function resolvePagePath(withoutExtension: string, pages: ReadonlyMap<string, string>): string {
	if (pages.has(withoutExtension)) return withoutExtension;
	for (const candidate of [`${withoutExtension}.mdx`, `${withoutExtension}.md`]) {
		if (pages.has(candidate)) return candidate;
	}
	return withoutExtension;
}

function worstOrder(status: DocumentationContract['status']): number {
	return { invalid: 0, warning: 1, unknown: 2, valid: 3 }[status];
}

/** Todas as dimensões, sobre uma página. */
function assertOverPage(
	raw: string,
	pagePath: string,
	spec: SpecFile,
	operation: ApiOperation,
	securityIndex: ReadonlyMap<string, { kind: string; name?: string; in?: string }>
): ContractAssertion[] {
	const assertions: ContractAssertion[] = [];
	const blocks = extractCodeBlocks(raw);

	const requests = [...extractHttpRequests(blocks), ...extractCurlRequests(blocks)];
	const expectedPath = `${spec.basePath}${operation.path}`;

	// Só as requisições que falam **deste** endpoint. Uma página de referência
	// mostra vários, e comparar todos contra um único contrato produziria uma
	// enxurrada de divergências inventadas.
	const matching = requests.filter((request) => samePath(request.path, expectedPath));

	for (const request of matching) {
		const location = { path: pagePath, line: request.line };

		assertions.push(...checkMethodAndPath({ ...request, location }, operation, spec.basePath));

		if (request.body !== undefined) {
			assertions.push(
				...checkRequestExample(
					{ value: request.body, location },
					resolveRefs(spec.document, operation.requestBody?.schema) as SchemaLike | undefined
				)
			);
		}

		assertions.push(...checkAuthentication(request.headers, operation, securityIndex, location));
	}

	if (matching.length > 0) {
		assertions.push(...checkParameters(extractParameterMentions(raw), operation.parameters, { path: pagePath }));
		assertions.push(...checkStatusCodes(extractStatusMentions(raw), operation, { path: pagePath }));

		// Resposta: o primeiro bloco JSON solto da página, comparado com o schema
		// da resposta de sucesso.
		const success = operation.responses.find((response) => response.status.startsWith('2'))?.status;
		if (success) {
			const schema = responseSchemaOf(spec, operation, success);
			for (const json of extractJsonBlocks(blocks)) {
				assertions.push(
					...checkResponseExample({ value: json.value, location: { path: pagePath, line: json.line } }, schema, success)
				);
			}
		}

		for (const block of blocks) {
			if (!['ts', 'typescript', 'js', 'javascript', 'python'].includes(block.language)) continue;
			assertions.push(
				...checkCodeExample(
					block.content,
					resolveRefs(spec.document, operation.requestBody?.schema) as SchemaLike | undefined,
					{ path: pagePath, line: block.line }
				)
			);
		}
	}

	return assertions;
}

/** Caminhos iguais a menos do nome do parâmetro. */
function samePath(documented: string, expected: string): boolean {
	const normalize = (value: string) => value.replace(/\{[^}]+\}/g, '{}').replace(/\/+$/, '');
	return normalize(documented) === normalize(expected);
}
