/**
 * Orquestração dos testes (§3, §11).
 *
 * O runner é a única parte que toca disco: ele lê as páginas, monta o índice de
 * links, carrega o grafo e as especificações, e chama as verificações puras de
 * `checks.ts`. Essa separação é o que permite testar as verificações sem
 * repositório.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { getContentGraph } from '../editor/content-graph';
import { collectProblems, type ContentProblem } from '../editor/graph-model';
import { parseOpenApi } from '../api-explorer/model';
import {
	checkApiExamples,
	checkExternalLinks,
	checkGraph,
	checkLinks,
	checkSnippets,
	extractSnippets,
	externalLinks,
	headingAnchors,
	type ApiExampleInput,
	type PageIndex,
	type Probe,
} from './checks';
import { PROFILE_CATEGORIES, summarize, type TestProfile, type TestReport, type TestResult } from './types';

const DOCS_ROOT = path.resolve(process.cwd(), 'src/content/docs');
const SCHEMAS_ROOT = path.resolve(process.cwd(), 'src/schemas');

interface Page {
	/** Caminho relativo a `src/content/docs`. */
	path: string;
	url: string;
	body: string;
}

function urlFor(relative: string): string {
	const withoutExtension = relative.replace(/\.mdx?$/, '');
	const slug = withoutExtension.replace(/(?:^|\/)index$/, '');
	return `/${slug}/`.replace(/\/{2,}/g, '/');
}

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

/**
 * Apaga o frontmatter **sem** apagar as linhas.
 *
 * Removê-lo de fato desloca todo o corpo, e o relatório passa a apontar para a
 * linha errada — que é pior que não apontar, porque manda a pessoa procurar o
 * problema onde ele não está. Cada linha do frontmatter vira uma linha vazia, e
 * a numeração continua sendo a do arquivo.
 */
function blankFrontmatter(raw: string): string {
	return raw.replace(/^---\r?\n[\s\S]*?\r?\n---/, (block) => block.replace(/[^\r\n]/g, ''));
}

async function loadPages(): Promise<Page[]> {
	const files = await walk(DOCS_ROOT);
	const pages: Page[] = [];

	for (const relative of files) {
		const raw = await readFile(path.join(DOCS_ROOT, relative), 'utf-8');
		pages.push({ path: relative, url: urlFor(relative), body: blankFrontmatter(raw) });
	}

	return pages;
}

/**
 * Índice de páginas e âncoras.
 *
 * Rotas que não vêm de arquivo de conteúdo entram à mão: elas existem, e sem
 * isso todo link para `/glossary/` seria acusado de quebrado.
 */
function buildIndex(pages: readonly Page[]): PageIndex {
	const urls = new Set<string>([
		'/glossary/',
		'/atualizacoes/',
		'/tags/',
		'/editor/',
		'/settings/',
		'/login/',
	]);
	const anchors = new Map<string, Set<string>>();

	for (const page of pages) {
		urls.add(page.url);
		anchors.set(page.url, headingAnchors(page.body));
	}

	return { urls, anchors };
}

/** Exemplos declarados nas especificações OpenAPI. */
async function loadApiExamples(): Promise<ApiExampleInput[]> {
	let files: string[];
	try {
		files = (await readdir(SCHEMAS_ROOT)).filter((file) => /\.(ya?ml|json)$/i.test(file));
	} catch {
		return [];
	}

	const examples: ApiExampleInput[] = [];

	for (const file of files) {
		const raw = await readFile(path.join(SCHEMAS_ROOT, file), 'utf-8');
		if (!/^\s*["']?(openapi|swagger)["']?\s*:/m.test(raw)) continue;

		let model;
		try {
			model = parseOpenApi(raw);
		} catch {
			continue;
		}

		// O modelo do Explorer já resolve `$ref` e monta os exemplos; reaproveitá-lo
		// evita um segundo interpretador de OpenAPI com regras ligeiramente
		// diferentes — que é como duas verdades nascem.
		for (const operation of model.operations) {
			if (!operation.requestBody) continue;
			try {
				examples.push({
					source: `src/schemas/${file}`,
					operation: `${operation.method.toUpperCase()} ${operation.path}`,
					status: 'requisição',
					example: JSON.parse(operation.requestBody.example),
					schema: operation.requestBody.schema as never,
				});
			} catch {
				// Exemplo que não é JSON: outro formato, fora do escopo.
			}
		}
	}

	return examples;
}

/**
 * Sondagem real: `HEAD` primeiro, `GET` quando o servidor não aceita `HEAD`.
 *
 * Sem redirecionamento automático desligado — seguir o redirecionamento é o
 * comportamento do leitor, e é o dele que se quer verificar. O tempo é limitado
 * para que um host mudo não trave a suíte inteira.
 */
async function httpProbe(url: string, timeoutMs = 8000): Promise<{ status?: number; error?: string }> {
	for (const method of ['HEAD', 'GET'] as const) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const response = await fetch(url, {
				method,
				redirect: 'follow',
				signal: controller.signal,
				headers: { 'user-agent': 'lunar-limb-doctest' },
			});
			// 405/501 em `HEAD` não diz nada sobre o link: repete com `GET`.
			if (method === 'HEAD' && (response.status === 405 || response.status === 501)) continue;
			return { status: response.status };
		} catch (error) {
			if (method === 'GET') return { error: (error as Error).name === 'AbortError' ? 'tempo esgotado' : (error as Error).message };
		} finally {
			clearTimeout(timer);
		}
	}

	return { error: 'sem resposta' };
}

export interface RunOptions {
	profile?: TestProfile;
	/** Restringe a um caminho relativo a `src/content/docs`. */
	file?: string;
	/** Caminhos alterados, para `--changed`. */
	changed?: readonly string[];
	/**
	 * Sondagem de link externo. Injetável para que o teste desta suíte não
	 * dependa da internet — e para que ninguém precise da internet para rodá-la.
	 */
	probe?: Probe;
}

export async function runDocumentationTests(options: RunOptions = {}): Promise<TestReport> {
	const started = Date.now();
	const profile = options.profile ?? 'quick';
	const categories = PROFILE_CATEGORIES[profile];
	const results: TestResult[] = [];

	const allPages = await loadPages();
	// O índice usa **todas** as páginas mesmo quando o teste é de uma só: um link
	// só é válido se o destino existir no portal inteiro.
	const index = buildIndex(allPages);

	const selected = options.file
		? allPages.filter((page) => page.path === options.file)
		: options.changed
			? allPages.filter((page) => options.changed!.some((changed) => changed.endsWith(page.path)))
			: allPages;

	if (categories.includes('link')) {
		for (const page of selected) results.push(...checkLinks(page.path, page.body, index));
	}

	if (categories.includes('graph')) {
		const graph = await getContentGraph({ fresh: true });
		const problems = collectProblems(graph).map((problem: ContentProblem) => ({
			kind: problem.kind,
			severity: problem.severity,
			message: problem.message,
			path: problem.path,
			line: problem.location?.line,
		}));
		results.push(...checkGraph(problems));
	}

	if (categories.includes('api')) {
		results.push(...checkApiExamples(await loadApiExamples()));
	}

	if (categories.includes('snippet')) {
		const before = results.length;
		for (const page of selected) {
			results.push(...checkSnippets(page.path, extractSnippets(page.body)));
		}
		if (results.length === before) {
			results.push({
				id: 'DOC-SNIPPET-001',
				category: 'snippet',
				status: 'skip',
				name: 'blocos executáveis',
				skipReason: 'nenhum bloco marcado com `test` nas páginas analisadas',
			});
		}
	}

	if (categories.includes('external')) {
		const links = selected.flatMap((page) => externalLinks(page.path, page.body));
		results.push(...(await checkExternalLinks(links, options.probe ?? httpProbe)));
	}

	// `runtime` executaria as chamadas de exemplo contra a API de verdade. Isso
	// exige credencial e um ambiente onde a chamada seja segura de repetir — não
	// existe ainda, e aparece como pulado com o motivo em vez de desaparecer do
	// relatório e dar a impressão de ter passado.
	if (categories.includes('runtime')) {
		results.push({
			id: 'DOC-API-001',
			category: 'runtime',
			status: 'skip',
			name: 'chamadas reais à API',
			skipReason: 'exige credencial e ambiente de execução; não configurado',
		});
	}

	return {
		profile,
		results,
		summary: summarize(results, Date.now() - started),
		categories,
	};
}
