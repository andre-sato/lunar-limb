/**
 * As verificações, como funções puras (§4, §6, §7, §10).
 *
 * Cada uma recebe o material já lido e devolve resultados. Nenhuma lê disco nem
 * abre conexão — isso fica no runner. É o que permite testar o próprio conjunto
 * de testes (§16) sem repositório, sem rede e em milissegundos.
 */

import type { TestLocation, TestResult } from './types';

// ---------------------------------------------------------------------------
// Links (§4)
// ---------------------------------------------------------------------------

export interface PageIndex {
	/** URL pública → títulos das âncoras daquela página. */
	anchors: Map<string, Set<string>>;
	/** URLs públicas conhecidas. */
	urls: Set<string>;
}

export interface MarkdownLink {
	href: string;
	text: string;
	line: number;
	column: number;
}

/** Links do corpo, ignorando os que estão dentro de bloco de código. */
export function extractLinks(body: string): MarkdownLink[] {
	const links: MarkdownLink[] = [];
	let fenced = false;

	body.split('\n').forEach((raw, index) => {
		if (/^\s*(?:```|~~~)/.test(raw)) {
			fenced = !fenced;
			return;
		}
		if (fenced) return;

		// Remove código inline antes de procurar: `[x](y)` dentro de crases é
		// exemplo de sintaxe, não um link.
		const line = raw.replace(/`[^`]*`/g, (match) => ' '.repeat(match.length));

		for (const match of line.matchAll(/\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
			links.push({
				text: match[1],
				href: match[2],
				line: index + 1,
				column: (match.index ?? 0) + 1,
			});
		}
	});

	return links;
}

/** Âncora percent-encoded pelo editor volta ao texto antes da comparação. */
function decodeAnchor(fragment: string): string {
	try {
		return decodeURIComponent(fragment);
	} catch {
		return fragment;
	}
}

function normalizeUrl(url: string): string {
	const withoutQuery = url.split('?')[0] ?? url;
	if (withoutQuery === '/') return '/';
	return withoutQuery.endsWith('/') ? withoutQuery : `${withoutQuery}/`;
}

/** Âncora no formato que a Starlight gera para os títulos. */
export function slugifyHeading(text: string): string {
	return text
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/`[^`]*`/g, (match) => match.replace(/`/g, ''))
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

export function headingAnchors(body: string): Set<string> {
	const anchors = new Set<string>();
	let fenced = false;

	for (const line of body.split('\n')) {
		if (/^\s*(?:```|~~~)/.test(line)) {
			fenced = !fenced;
			continue;
		}
		if (fenced) continue;

		const match = line.match(/^#{1,6}\s+(.+?)\s*$/);
		if (match) anchors.add(slugifyHeading(match[1]));
	}

	return anchors;
}

/**
 * `DOC-LINK-001` — link interno para página inexistente.
 * `DOC-LINK-002` — âncora inexistente na página de destino.
 *
 * Link externo não é avaliado aqui: ele exige rede e mora na categoria
 * `external`, que só o perfil estrito executa.
 */
export function checkLinks(path: string, body: string, index: PageIndex): TestResult[] {
	const results: TestResult[] = [];
	// Âncoras da própria página, calculadas do corpo: depender do índice aqui
	// exigiria adivinhar a URL a partir do caminho, e `index.md` quebraria.
	const ownAnchors = headingAnchors(body);

	for (const link of extractLinks(body)) {
		const { href } = link;

		// Fora do escopo desta verificação: outro host, protocolo, e-mail.
		if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) continue;

		const location = { path, line: link.line, column: link.column };

		// Âncora na própria página.
		if (href.startsWith('#')) {
			// A âncora escrita no link passa pela **mesma** normalização dos títulos:
			// `#criando-uma-página` e o título "Criando uma página" só se encontram
			// depois de dobrar o acento, que é o que o navegador também faz.
			const anchor = slugifyHeading(decodeAnchor(href.slice(1)));
			results.push(
				ownAnchors.has(anchor)
					? { id: 'DOC-LINK-002', category: 'link', status: 'pass', name: `âncora ${href}`, location }
					: {
							id: 'DOC-LINK-002',
							category: 'link',
							status: 'fail',
							name: `âncora ${href}`,
							message: `A página não tem um título que gere a âncora "${anchor}".`,
							location,
						}
			);
			continue;
		}

		// Link relativo sem barra inicial: o portal usa caminhos absolutos, e um
		// relativo aqui quase sempre é engano de quem copiou de outro lugar.
		if (!href.startsWith('/')) continue;

		const [target, fragment] = href.split('#');
		const normalized = normalizeUrl(target);

		if (!index.urls.has(normalized)) {
			results.push({
				id: 'DOC-LINK-001',
				category: 'link',
				status: 'fail',
				name: `link ${href}`,
				message: 'A página de destino não existe.',
				expected: 'uma página publicada',
				actual: normalized,
				location,
			});
			continue;
		}

		results.push({ id: 'DOC-LINK-001', category: 'link', status: 'pass', name: `link ${href}`, location });

		if (fragment) {
			const anchors = index.anchors.get(normalized) ?? new Set();
			results.push(
				anchors.has(slugifyHeading(decodeAnchor(fragment)))
					? { id: 'DOC-LINK-002', category: 'link', status: 'pass', name: `âncora ${href}`, location }
					: {
							id: 'DOC-LINK-002',
							category: 'link',
							status: 'fail',
							name: `âncora ${href}`,
							message: `A página existe, mas não tem a âncora "${fragment}".`,
							location,
						}
			);
		}
	}

	return results;
}

// ---------------------------------------------------------------------------
// Content Graph (§10)
// ---------------------------------------------------------------------------

export interface GraphProblemInput {
	kind: string;
	severity: string;
	message: string;
	path?: string;
	line?: number;
}

/**
 * `DOC-GRAPH-001` — referência quebrada, circular ou duplicada.
 *
 * O grafo já detecta esses problemas para o editor; aqui eles viram teste, que
 * é o que permite reprovar um pull request por causa deles.
 */
export function checkGraph(problems: readonly GraphProblemInput[]): TestResult[] {
	if (problems.length === 0) {
		return [{ id: 'DOC-GRAPH-001', category: 'graph', status: 'pass', name: 'referências de conteúdo' }];
	}

	return problems.map((problem) => ({
		id: 'DOC-GRAPH-001',
		category: 'graph',
		status: problem.severity === 'error' ? ('fail' as const) : ('skip' as const),
		name: `${problem.kind}`,
		message: problem.message,
		// Aviso do grafo (conteúdo órfão, por exemplo) não reprova: é informação
		// para quem escreve, não defeito de comportamento.
		skipReason: problem.severity === 'error' ? undefined : `severidade ${problem.severity}`,
		location: problem.path ? { path: problem.path, line: problem.line } : undefined,
	}));
}

// ---------------------------------------------------------------------------
// API (§5, §6)
// ---------------------------------------------------------------------------

export interface SchemaLike {
	type?: string;
	required?: string[];
	properties?: Record<string, SchemaLike>;
	items?: SchemaLike;
	enum?: unknown[];
}

export interface SchemaViolation {
	pointer: string;
	message: string;
}

/**
 * Valida um exemplo contra um schema OpenAPI.
 *
 * Deliberadamente parcial: verifica tipo, campos obrigatórios e enum. Não
 * pretende ser um validador de JSON Schema completo — o que se quer pegar aqui
 * é o exemplo que envelheceu em relação ao contrato, e isso aparece nesses três.
 */
export function validateAgainstSchema(
	value: unknown,
	schema: SchemaLike | undefined,
	pointer = ''
): SchemaViolation[] {
	if (!schema) return [];
	const violations: SchemaViolation[] = [];
	const at = pointer || '(raiz)';

	if (schema.enum && !schema.enum.includes(value as never)) {
		violations.push({ pointer: at, message: `valor fora do enum: ${JSON.stringify(value)}` });
		return violations;
	}

	switch (schema.type) {
		case 'object': {
			if (value === null || typeof value !== 'object' || Array.isArray(value)) {
				violations.push({ pointer: at, message: `esperava objeto, veio ${describe(value)}` });
				return violations;
			}

			const record = value as Record<string, unknown>;
			for (const field of schema.required ?? []) {
				if (!(field in record)) {
					// O nome do campo vai também na mensagem: quem lê o relatório no
					// terminal vê a mensagem antes do ponteiro, e "campo obrigatório
					// ausente" sozinho manda a pessoa procurar qual é.
					violations.push({ pointer: `${pointer}/${field}`, message: `campo obrigatório ausente: \`${field}\`` });
				}
			}

			for (const [key, child] of Object.entries(schema.properties ?? {})) {
				if (key in record) {
					violations.push(...validateAgainstSchema(record[key], child, `${pointer}/${key}`));
				}
			}
			break;
		}

		case 'array': {
			if (!Array.isArray(value)) {
				violations.push({ pointer: at, message: `esperava lista, veio ${describe(value)}` });
				break;
			}
			value.forEach((item, index) => {
				violations.push(...validateAgainstSchema(item, schema.items, `${pointer}/${index}`));
			});
			break;
		}

		case 'string':
			if (typeof value !== 'string') {
				violations.push({ pointer: at, message: `esperava texto, veio ${describe(value)}` });
			}
			break;

		case 'integer':
		case 'number':
			if (typeof value !== 'number') {
				violations.push({ pointer: at, message: `esperava número, veio ${describe(value)}` });
			}
			break;

		case 'boolean':
			if (typeof value !== 'boolean') {
				violations.push({ pointer: at, message: `esperava booleano, veio ${describe(value)}` });
			}
			break;
	}

	return violations;
}

function describe(value: unknown): string {
	if (value === null) return 'null';
	if (Array.isArray(value)) return 'lista';
	return typeof value;
}

export interface ApiExampleInput {
	/** Onde o exemplo está declarado. */
	source: string;
	operation: string;
	status: string;
	example: unknown;
	schema?: SchemaLike;
}

/** `DOC-API-003` — exemplo de resposta que não bate com o schema. */
export function checkApiExamples(examples: readonly ApiExampleInput[]): TestResult[] {
	return examples.flatMap((example): TestResult[] => {
		if (!example.schema) {
			return [
				{
					id: 'DOC-API-003',
					category: 'api' as const,
					status: 'skip' as const,
					name: `${example.operation} ${example.status}`,
					skipReason: 'a resposta não declara schema',
				},
			];
		}

		const violations = validateAgainstSchema(example.example, example.schema);
		if (violations.length === 0) {
			return [
				{
					id: 'DOC-API-003',
					category: 'api' as const,
					status: 'pass' as const,
					name: `${example.operation} ${example.status}`,
				},
			];
		}

		return violations.map((violation) => ({
			id: 'DOC-API-003',
			category: 'api' as const,
			status: 'fail' as const,
			name: `${example.operation} ${example.status}`,
			message: `${violation.pointer}: ${violation.message}`,
			location: { path: example.source },
		}));
	});
}

// ---------------------------------------------------------------------------
// Snippets (§7, §8)
// ---------------------------------------------------------------------------

export interface Snippet {
	language: string;
	code: string;
	line: number;
	/** `true` quando a cerca traz o marcador `test`. */
	executable: boolean;
	/** `false` quando o corpo traz `@test: false`. */
	enabled: boolean;
	/** Saída esperada declarada com `@expect-output:`. */
	expectedOutput?: string;
	/** Código de saída esperado, declarado com `@expect-exit:`. */
	expectedExit?: number;
}

/**
 * Extrai os blocos de código e o que eles declaram sobre si.
 *
 * O protocolo é o da spec: a cerca marca o bloco como executável
 * (```` ```python test ````) e um comentário no corpo pode desligá-lo
 * (`@test: false`). Marcação na cerca e no corpo, porque a primeira é visível
 * na leitura e o segundo sobrevive a copiar e colar.
 */
export function extractSnippets(body: string): Snippet[] {
	const snippets: Snippet[] = [];
	const lines = body.split('\n');

	let open: { language: string; test: boolean; line: number; fence: string } | null = null;
	let buffer: string[] = [];

	lines.forEach((line, index) => {
		const fence = line.match(/^\s*(`{3,}|~{3,})\s*([A-Za-z0-9_+-]*)\s*(.*)$/);

		if (open) {
			const closing = line.match(/^\s*(`{3,}|~{3,})\s*$/);
			if (closing && closing[1][0] === open.fence[0] && closing[1].length >= open.fence.length) {
				const code = buffer.join('\n');
				snippets.push({
					language: open.language,
					code,
					line: open.line,
					executable: open.test,
					enabled: !/^\s*(?:#|\/\/|--)\s*@test:\s*false\s*$/m.test(code),
					expectedOutput: matchDirective(code, 'expect-output'),
					expectedExit: toNumber(matchDirective(code, 'expect-exit')),
				});
				open = null;
				buffer = [];
				return;
			}
			buffer.push(line);
			return;
		}

		if (fence) {
			// ```` ``` test ```` é ambíguo: em Markdown a primeira palavra depois da
			// cerca é a linguagem, então `test` cai em `fence[2]`. Quem escreveu isso
			// quis marcar o bloco, não declarar uma linguagem chamada "test" — e o
			// resultado é o bloco marcado **sem** linguagem, que é o que a
			// verificação precisa reprovar em vez de ignorar.
			const declared = fence[2] || '';
			const rest = fence[3] ?? '';
			const markerOnly = declared === 'test';

			open = {
				language: markerOnly ? 'text' : declared || 'text',
				test: markerOnly || /\btest\b/.test(rest),
				line: index + 1,
				fence: fence[1],
			};
			buffer = [];
		}
	});

	return snippets;
}

function matchDirective(code: string, name: string): string | undefined {
	const match = code.match(new RegExp(`^\\s*(?:#|//|--)\\s*@${name}:\\s*(.+)\\s*$`, 'm'));
	return match ? match[1].trim() : undefined;
}

function toNumber(value: string | undefined): number | undefined {
	if (value === undefined) return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * `DOC-SNIPPET-001` — bloco marcado como executável.
 *
 * **A execução não acontece por padrão.** Rodar código vindo de um arquivo de
 * conteúdo é execução arbitrária: quem escreve documentação passa a poder rodar
 * qualquer coisa na máquina de quem testa, e em CI isso é uma porta aberta.
 *
 * O que roda por padrão é a verificação estrutural: o bloco declara linguagem,
 * tem corpo, e o marcador está bem formado. Executar de verdade exige o
 * interruptor explícito de quem opera o portal.
 */
export function checkSnippets(path: string, snippets: readonly Snippet[]): TestResult[] {
	const executable = snippets.filter((snippet) => snippet.executable);

	// Página sem bloco executável não gera resultado: um "pulado" por página
	// afogaria o relatório em dezenas de linhas que não dizem nada. Quando
	// nenhuma página tem blocos, o runner registra um único pulado com o motivo.
	if (executable.length === 0) return [];

	return executable.map((snippet) => {
		const location = { path, line: snippet.line };

		if (!snippet.enabled) {
			return {
				id: 'DOC-SNIPPET-001',
				category: 'snippet' as const,
				status: 'skip' as const,
				name: `bloco ${snippet.language}`,
				skipReason: 'desligado com @test: false',
				location,
			};
		}

		if (snippet.code.trim() === '') {
			return {
				id: 'DOC-SNIPPET-001',
				category: 'snippet' as const,
				status: 'fail' as const,
				name: `bloco ${snippet.language}`,
				message: 'marcado como executável e sem código.',
				location,
			};
		}

		if (snippet.language === 'text') {
			return {
				id: 'DOC-SNIPPET-001',
				category: 'snippet' as const,
				status: 'fail' as const,
				name: 'bloco sem linguagem',
				message: 'marcado como executável sem declarar a linguagem — não há como rodá-lo.',
				location,
			};
		}

		return {
			id: 'DOC-SNIPPET-001',
			category: 'snippet' as const,
			status: 'skip' as const,
			name: `bloco ${snippet.language}`,
			skipReason: 'execução desligada (ver DOCTEST_RUN_SNIPPETS)',
			location,
		};
	});
}

// ---------------------------------------------------------------------------
// Links externos (§9) — a única verificação que sai da máquina
// ---------------------------------------------------------------------------

export interface ExternalLink {
	url: string;
	location: TestLocation;
}

/** Links `http`/`https` do corpo, com a posição onde aparecem. */
export function externalLinks(path: string, body: string): ExternalLink[] {
	return extractLinks(body)
		.filter((link) => /^https?:\/\//i.test(link.href))
		.map((link) => ({ url: link.href, location: { path, line: link.line, column: link.column } }));
}

export interface ProbeResult {
	status?: number;
	/** Falha de transporte: DNS, TLS, tempo esgotado. */
	error?: string;
}

export type Probe = (url: string) => Promise<ProbeResult>;

/**
 * `DOC-LINK-003` — link externo que não responde.
 *
 * Só o perfil estrito roda isto, e por bom motivo: depende de rede, de terceiros
 * e do humor deles. Um 403 ou 429 **não** reprova — sites bloqueiam robôs, e
 * transformar isso em falha ensinaria a equipe a ignorar o relatório inteiro.
 * Reprova o que é evidência real de link morto: 404, 410 e a família 5xx.
 */
export async function checkExternalLinks(
	links: readonly ExternalLink[],
	probe: Probe,
	concurrency = 6
): Promise<TestResult[]> {
	if (links.length === 0) {
		return [
			{
				id: 'DOC-LINK-003',
				category: 'external',
				status: 'skip',
				name: 'links externos',
				skipReason: 'nenhum link externo nas páginas analisadas',
			},
		];
	}

	// Uma sondagem por URL, mesmo que vinte páginas citem a mesma: dobrar o
	// tráfego contra terceiros é o caminho mais curto para ser bloqueado.
	const unique = new Map<string, ExternalLink>();
	for (const link of links) if (!unique.has(link.url)) unique.set(link.url, link);

	const queue = [...unique.values()];
	const results: TestResult[] = [];

	async function worker(): Promise<void> {
		for (;;) {
			const link = queue.shift();
			if (!link) return;

			const started = Date.now();
			const outcome = await probe(link.url);
			const durationMs = Date.now() - started;
			const base = { id: 'DOC-LINK-003', category: 'external' as const, name: `link ${link.url}`, location: link.location, durationMs };

			if (outcome.error) {
				results.push({ ...base, status: 'fail', message: `não foi possível alcançar: ${outcome.error}` });
				continue;
			}

			const status = outcome.status ?? 0;

			if (status === 404 || status === 410 || status >= 500) {
				results.push({ ...base, status: 'fail', message: `respondeu ${status}.`, expected: '2xx ou 3xx', actual: String(status) });
				continue;
			}

			if (status >= 400) {
				results.push({ ...base, status: 'skip', skipReason: `respondeu ${status} — provavelmente bloqueio a robô, não link morto` });
				continue;
			}

			results.push({ ...base, status: 'pass' });
		}
	}

	await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));

	return results;
}
