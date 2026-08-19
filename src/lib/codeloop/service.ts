/**
 * `DocumentationImpactService` (P2.2 — § API).
 *
 * A parte que toca disco e Git. Ela reúne os vínculos declarados nas páginas, o
 * que o Digital Twin sabe do produto, o que o Contract Testing achou dos exemplos
 * e o que mudou segundo o Git — e chama as funções puras de `analyze.ts`.
 *
 * Um guardrail da spec vale repetir aqui, onde ele poderia ser violado: **nenhuma
 * alteração de código é feita**. Este serviço lê o repositório, escreve relatório,
 * e no máximo cria uma tarefa para o Agent Orchestrator — que por sua vez escreve
 * só em workspace isolado e exige aprovação humana.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { getTwin } from '../twin/load';
import { findUndocumented as findUndocumentedEndpoints, countsForCoverage } from '../twin/analysis';
import { runContractTests } from '../contract/engine';
import { indexBindings, parseBindings, resolveBindings, type BindingIndex } from './bindings';
import {
	analyzeImpact,
	blocksMerge,
	computeConsistency,
	computeReleaseCoverage,
	evaluatePolicy,
	findOrphans,
	findUndocumented,
} from './analyze';
import {
	DEFAULT_POLICY,
	type CodeLoopPolicy,
	type DocumentationImpact,
	type DocumentationOrphan,
	type EntityType,
	type PolicyViolationReport,
	type UndocumentedEntity,
} from './types';

const run = promisify(execFile);

const ROOT = process.cwd();
const DOCS_ROOT = path.resolve(ROOT, 'src/content/docs');
const CONFIG_FILE = path.resolve(ROOT, 'codeloop.yml');
const DOCS_PREFIX = 'src/content/docs/';

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

export async function loadPolicy(): Promise<CodeLoopPolicy> {
	try {
		const raw = await readFile(CONFIG_FILE, 'utf-8');
		const parsed = yaml.load(raw) as
			| {
					documentation?: {
						bindings?: { requiredFor?: string[] };
						policy?: {
							apiChanges?: { requireDocs?: boolean; requireExamples?: boolean };
							breakingChanges?: { requireMigrationGuide?: boolean };
							releases?: { minimumCoverage?: number };
							failOnViolation?: boolean;
						};
					};
			  }
			| null
			| undefined;

		const bindings = parsed?.documentation?.bindings;
		const policy = parsed?.documentation?.policy;

		// A spec escreve `public-api`, `public-event`, `cli-command`; o modelo usa
		// `api`, `event`, `cli`. Aceitar as duas formas evita que a configuração do
		// próprio exemplo não funcione.
		const requiredFor = (bindings?.requiredFor ?? [])
			.map((entry) => entry.replace(/^public-/, '').replace(/-command$/, ''))
			.filter((entry): entry is EntityType =>
				['api', 'schema', 'service', 'function', 'class', 'event', 'database', 'cli', 'config', 'feature'].includes(entry)
			);

		return {
			requiredFor: requiredFor.length > 0 ? requiredFor : DEFAULT_POLICY.requiredFor,
			requireDocsForApiChanges: policy?.apiChanges?.requireDocs ?? DEFAULT_POLICY.requireDocsForApiChanges,
			requireMigrationGuide: policy?.breakingChanges?.requireMigrationGuide ?? DEFAULT_POLICY.requireMigrationGuide,
			requireExamples: policy?.apiChanges?.requireExamples ?? DEFAULT_POLICY.requireExamples,
			releaseMinimumCoverage: policy?.releases?.minimumCoverage ?? DEFAULT_POLICY.releaseMinimumCoverage,
			failOnViolation: policy?.failOnViolation ?? DEFAULT_POLICY.failOnViolation,
		};
	} catch {
		return DEFAULT_POLICY;
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

export async function loadBindingIndex(policy?: CodeLoopPolicy): Promise<BindingIndex & { migrationGuides: string[] }> {
	const [effective, twin] = await Promise.all([policy ? Promise.resolve(policy) : loadPolicy(), getTwin({ fresh: true })]);

	const files = await walk(DOCS_ROOT);
	const declared = [];
	const migrationGuides: string[] = [];

	for (const relative of files) {
		const raw = await readFile(path.join(DOCS_ROOT, relative), 'utf-8');
		declared.push(...parseBindings(relative, raw, effective));

		// Guia de migração reconhecido pelo nome do arquivo ou pelo título: é
		// convenção, e a alternativa seria um campo a mais para alguém esquecer.
		if (/migrat|migra[cç]/i.test(relative) || /^title:.*migra/im.test(raw)) migrationGuides.push(relative);
	}

	return { ...indexBindings(resolveBindings(declared, twin.graph)), migrationGuides };
}

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

async function git(args: string[]): Promise<string> {
	try {
		const { stdout } = await run('git', args, { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 });
		return stdout;
	} catch {
		return '';
	}
}

export async function changedFiles(range: string): Promise<string[]> {
	const committed = await git(['diff', '--name-only', range]);
	const working = range.includes('..') ? '' : await git(['diff', '--name-only', 'HEAD']);

	return [
		...new Set(
			[committed, working]
				.join('\n')
				.split(/\r?\n/)
				.map((line) => line.trim().replace(/\\/g, '/'))
				.filter(Boolean)
		),
	];
}

/**
 * As linhas alteradas de um arquivo, segundo o Git.
 *
 * `-U0` remove o contexto: sem isso, três linhas vizinhas de cada hunk entrariam
 * na conta e endpoints que ninguém tocou seriam marcados como alterados.
 */
export async function changedLineRanges(range: string, file: string): Promise<Array<[number, number]>> {
	const args = range.includes('..') ? ['diff', '-U0', range, '--', file] : ['diff', '-U0', 'HEAD', '--', file];
	const diff = await git(args);

	const ranges: Array<[number, number]> = [];
	for (const match of diff.matchAll(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/gm)) {
		const start = Number(match[1]);
		const count = match[2] === undefined ? 1 : Number(match[2]);
		// Remoção pura tem count 0 e começa na linha anterior à excluída; ainda
		// assim ela alterou aquele ponto do arquivo.
		ranges.push(count === 0 ? [start, start + 1] : [start, start + count - 1]);
	}

	return ranges;
}

/** Onde cada operação começa e termina numa especificação OpenAPI. */
export function endpointLineSpans(raw: string): Array<{ method: string; path: string; start: number; end: number }> {
	const lines = raw.split(/\r?\n/);
	const spans: Array<{ method: string; path: string; start: number; end: number }> = [];

	let inPaths = false;
	let pathIndent = 0;
	let currentPath: string | null = null;
	let open: { method: string; path: string; start: number } | null = null;

	const close = (endLine: number) => {
		if (open) spans.push({ ...open, end: endLine });
		open = null;
	};

	lines.forEach((line, index) => {
		const number = index + 1;
		if (/^paths:\s*$/.test(line)) {
			inPaths = true;
			return;
		}
		if (!inPaths) return;

		// Chave de topo diferente de `paths:` encerra a seção.
		if (/^\S/.test(line)) {
			close(index);
			inPaths = false;
			return;
		}

		const pathMatch = line.match(/^(\s+)(\/\S*):\s*$/);
		if (pathMatch) {
			close(index);
			pathIndent = pathMatch[1].length;
			currentPath = pathMatch[2];
			return;
		}

		const methodMatch = line.match(/^(\s+)(get|post|put|patch|delete|head|options):\s*$/i);
		if (methodMatch && currentPath && methodMatch[1].length > pathIndent) {
			close(index);
			open = { method: methodMatch[2].toUpperCase(), path: currentPath, start: number };
		}
	});

	close(lines.length);
	return spans;
}

function overlaps(ranges: readonly (readonly [number, number])[], start: number, end: number): boolean {
	return ranges.some(([from, to]) => from <= end && to >= start);
}

/**
 * As entidades do produto que estes arquivos tocam.
 *
 * A tradução arquivo → entidade sai do Digital Twin, que já sabe qual arquivo
 * implementa qual endpoint. Deduzir aqui de novo criaria uma segunda resposta para
 * a mesma pergunta.
 */
export async function entitiesFor(
	files: readonly string[],
	range?: string
): Promise<Array<{ entityId: string; entityType: EntityType; detail: string }>> {
	const twin = await getTwin();
	const touched = new Set(files);

	const entities: Array<{ entityId: string; entityType: EntityType; detail: string }> = [];

	for (const edge of twin.graph.edges) {
		if (edge.relation !== 'implements') continue;

		const code = twin.graph.nodes.find((node) => node.id === edge.from);
		if (!code?.source || !touched.has(code.source)) continue;

		const endpoint = twin.graph.nodes.find((node) => node.id === edge.to);
		if (!endpoint) continue;

		// Rota interna — editor, administração — está fora do contrato de
		// documentação por declaração do próprio `twin.yml`. Cobrá-la aqui faria
		// toda mudança no editor bloquear o merge, e o primeiro efeito disso seria
		// alguém desligar o portão inteiro.
		if (!countsForCoverage(endpoint)) continue;

		entities.push({ entityId: endpoint.name, entityType: 'api', detail: `implementado em \`${code.source}\`` });
	}

	// Especificação alterada.
	//
	// Marcar **todo** endpoint declarado no arquivo seria fácil e estaria errado:
	// corrigir uma palavra num `summary` bloquearia o merge por quatro endpoints
	// que ninguém tocou. Quando dá para saber quais linhas mudaram, só as operações
	// que as contêm entram; quando não dá (arquivo novo, sem `range`), o arquivo
	// inteiro entra, que é o lado seguro do erro.
	for (const file of files) {
		if (!file.startsWith('src/schemas/')) continue;

		const declared = twin.graph.nodes.filter((node) => node.type === 'endpoint' && node.source === file);
		if (declared.length === 0) continue;

		let touchedNames: Set<string> | null = null;

		if (range) {
			const ranges = await changedLineRanges(range, file);
			if (ranges.length > 0) {
				const raw = await readFile(path.resolve(ROOT, file), 'utf-8').catch(() => '');
				const spans = endpointLineSpans(raw).filter((span) => overlaps(ranges, span.start, span.end));

				// Linha alterada fora de qualquer operação — `info:`, `components:`,
				// um servidor — não é mudança de endpoint nenhum.
				touchedNames = new Set(
					declared
						.filter((node) =>
							spans.some((span) => {
								const [method, endpointPath] = node.name.split(' ');
								return method === span.method && endpointPath?.endsWith(span.path);
							})
						)
						.map((node) => node.name)
				);
			}
		}

		for (const node of declared) {
			if (touchedNames && !touchedNames.has(node.name)) continue;
			if (entities.some((entity) => entity.entityId === node.name)) continue;
			entities.push({ entityId: node.name, entityType: 'api', detail: `declarado em \`${file}\`` });
		}
	}

	return entities;
}

// ---------------------------------------------------------------------------
// Serviço
// ---------------------------------------------------------------------------

export interface ImpactReport {
	impact: DocumentationImpact;
	violations: PolicyViolationReport[];
	blocked: boolean;
	policy: CodeLoopPolicy;
}

export interface DocumentationImpactService {
	analyze(range: string): Promise<ImpactReport>;
	getBindings(entityId?: string): Promise<BindingIndex['bindings']>;
	checkCoverage(range: string): Promise<{ coverage: number; missing: number; blocked: boolean }>;
	findOrphans(): Promise<DocumentationOrphan[]>;
	findUndocumented(): Promise<UndocumentedEntity[]>;
	consistency(): Promise<ReturnType<typeof computeConsistency>>;
	releaseCoverage(from: string, to?: string): Promise<ReturnType<typeof computeReleaseCoverage>>;
}

export const documentationImpact: DocumentationImpactService = {
	async analyze(range) {
		const policy = await loadPolicy();
		const [index, files] = await Promise.all([loadBindingIndex(policy), changedFiles(range)]);

		const changedPages = files
			.filter((file) => file.startsWith(DOCS_PREFIX) && /\.mdx?$/.test(file))
			.map((file) => file.slice(DOCS_PREFIX.length));

		const entities = await entitiesFor(files, range);

		// Quebra de contrato vem do Contract Testing, que já compara especificação
		// interpretada com o que a documentação mostra.
		const contracts = await runContractTests().catch(() => null);
		const brokenIds = new Set(
			(contracts?.contracts ?? []).filter((contract) => contract.status === 'invalid').map((contract) => contract.id)
		);

		const impact = analyzeImpact({
			changeId: range,
			changedEntities: entities.map((entity) => ({
				...entity,
				breaking: brokenIds.has(entity.entityId),
			})),
			changedPages,
			byEntity: index.byEntity,
			migrationGuides: index.migrationGuides.filter((guide) => changedPages.includes(guide)),
			staleExamples: (contracts?.contracts ?? [])
				.filter((contract) => contract.status === 'invalid')
				.flatMap((contract) => contract.documentation.map((reference) => reference.path)),
			policy,
		});

		const violations = evaluatePolicy(impact, policy);

		return { impact, violations, blocked: blocksMerge(violations, policy), policy };
	},

	async getBindings(entityId) {
		const index = await loadBindingIndex();
		return entityId ? index.bindings.filter((binding) => binding.entityId === entityId) : index.bindings;
	},

	async checkCoverage(range) {
		const report = await documentationImpact.analyze(range);
		return {
			coverage: report.impact.coverage,
			missing: report.impact.missingDocumentation.length,
			blocked: report.blocked,
		};
	},

	async findOrphans() {
		return findOrphans((await loadBindingIndex()).bindings);
	},

	/**
	 * Entidades públicas sem documentação.
	 *
	 * Os endpoints vêm do Digital Twin, que já faz essa conta — e aqui ela é
	 * refinada pelos vínculos: um endpoint pode estar "documentado" por menção de
	 * texto no Twin e continuar sem **vínculo declarado**, que é o que a política
	 * exige. O guardrail da spec é exatamente esse: não considerar somente texto.
	 */
	async findUndocumented() {
		const [policy, index, twin] = await Promise.all([loadPolicy(), loadBindingIndex(), getTwin()]);

		const endpoints = twin.graph.nodes
			.filter((node) => node.type === 'endpoint' && countsForCoverage(node))
			.map((node) => ({
				entityId: node.name,
				entityType: 'api' as EntityType,
				evidence: [
					node.source ? `declarado em \`${node.source}\`` : 'implementado no código',
					...(node.metadata?.deprecated ? ['marcado como obsoleto'] : []),
				],
			}));

		const undocumented = findUndocumented({ entities: endpoints, byEntity: index.byEntity, policy });

		// O que o Twin já considera não documentado nem por menção é o caso mais
		// grave; ele aparece com evidência adicional.
		const alsoUnmentioned = new Set(findUndocumentedEndpoints(twin.graph).map((item) => item.node.name));

		return undocumented.map((entity) =>
			alsoUnmentioned.has(entity.entityId)
				? { ...entity, evidence: [...entity.evidence, 'nenhuma página sequer menciona o caminho'] }
				: entity
		);
	},

	async consistency() {
		const [index, twin, contracts] = await Promise.all([
			loadBindingIndex(),
			getTwin(),
			runContractTests().catch(() => null),
		]);

		return computeConsistency({
			bindings: index.bindings,
			endpoints: twin.graph.nodes.filter((node) => node.type === 'endpoint').map((node) => node.name),
			schemas: twin.graph.nodes.filter((node) => node.type === 'schema').map((node) => node.name),
			commands: twin.graph.nodes.filter((node) => node.type === 'code').map((node) => node.name),
			examples: contracts ? { valid: contracts.counts.valid, invalid: contracts.counts.invalid } : undefined,
		});
	},

	async releaseCoverage(from, to = 'HEAD') {
		const [index, files] = await Promise.all([loadBindingIndex(), changedFiles(`${from}..${to}`)]);

		const entities = await entitiesFor(files, `${from}..${to}`);
		const updatedPages = files
			.filter((file) => file.startsWith(DOCS_PREFIX))
			.map((file) => file.slice(DOCS_PREFIX.length));

		const contracts = await runContractTests().catch(() => null);
		const breaking = (contracts?.contracts ?? [])
			.filter((contract) => contract.status === 'invalid')
			.map((contract) => contract.id);

		// Sem histórico anterior não dá para separar "nova" de "alterada" com
		// honestidade; todas entram como alteradas, e o relatório diz o total.
		return computeReleaseCoverage({
			newEntities: [],
			changedEntities: entities.map((entity) => entity.entityId),
			removedEntities: [],
			breakingEntities: breaking,
			byEntity: index.byEntity,
			updatedPages,
			migrationGuides: index.migrationGuides,
		});
	},
};
