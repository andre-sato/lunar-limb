/**
 * Pull request: portão de qualidade e criação (§3.4, §3.6, §4).
 *
 * Duas metades bem diferentes.
 *
 * **O portão** é nosso e roda local: linter, quality score, impacto no Content
 * Graph. Ele responde "esta alteração está pronta para revisão?" antes de
 * qualquer coisa sair da máquina.
 *
 * **A criação** é do provedor. O PR vive no GitHub, e é lá que a revisão, a
 * aprovação e o merge acontecem — reimplementar isso aqui seria construir um
 * GitHub pior dentro do editor, e ainda por cima desconectado do que a equipe
 * já usa para revisar código.
 *
 * Sem credencial configurada, esta camada **não falha**: ela devolve a URL de
 * comparação do provedor, com título e corpo prontos. O trabalho de preparação
 * não se perde por falta de token.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getContentGraph } from '../editor/content-graph';
import { changedPaths } from './diff';

const run = promisify(execFile);

const DOCS_PREFIX = 'src/content/docs/';
const SNIPPETS_PREFIX = 'src/content/snippets/';

export interface RemoteInfo {
	/** `https://github.com/dono/repo` — sem `.git` e sem credencial embutida. */
	url: string;
	owner: string;
	repo: string;
	host: string;
}

/**
 * Lê o remoto `origin` e o normaliza.
 *
 * Aceita as duas formas que o Git usa (`https://` e `git@host:dono/repo`), e
 * descarta qualquer credencial que esteja embutida na URL — ela não deve chegar
 * à interface nem a um log.
 */
export function parseRemote(raw: string): RemoteInfo | null {
	const url = raw.trim();
	if (url === '') return null;

	const ssh = url.match(/^(?:ssh:\/\/)?git@([^:/]+)[:/](.+?)(?:\.git)?$/);
	const https = url.match(/^https?:\/\/(?:[^@/]+@)?([^/]+)\/(.+?)(?:\.git)?$/);
	const match = ssh ?? https;
	if (!match) return null;

	const host = match[1];
	const segments = match[2].split('/').filter(Boolean);
	if (segments.length < 2) return null;

	const owner = segments[segments.length - 2];
	const repo = segments[segments.length - 1];

	return { url: `https://${host}/${owner}/${repo}`, owner, repo, host };
}

export async function getRemote(): Promise<RemoteInfo | null> {
	try {
		const { stdout } = await run('git', ['remote', 'get-url', 'origin'], { cwd: process.cwd() });
		return parseRemote(stdout);
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Impacto no Content Graph (§4)
// ---------------------------------------------------------------------------

export interface ContentImpact {
	/** Blocos reutilizáveis alterados nesta branch. */
	changedSnippets: string[];
	/** Páginas que consomem esses blocos e mudam de conteúdo sem serem editadas. */
	affectedPages: string[];
}

/**
 * Descobre quem mais muda por tabela.
 *
 * Editar um bloco reutilizável altera todas as páginas que o incluem sem tocar
 * em nenhuma delas. Quem revisa o PR precisa saber disso: são as páginas que
 * mudaram de verdade e não aparecem no diff.
 */
export async function contentImpact(paths: readonly string[]): Promise<ContentImpact> {
	const changedSnippets = paths
		.filter((file) => file.startsWith(SNIPPETS_PREFIX))
		.map((file) => file.slice(SNIPPETS_PREFIX.length).replace(/\.mdx?$/, ''));

	if (changedSnippets.length === 0) return { changedSnippets: [], affectedPages: [] };

	const graph = await getContentGraph({ fresh: true });
	const editedPages = new Set(
		paths.filter((file) => file.startsWith(DOCS_PREFIX)).map((file) => file.slice(DOCS_PREFIX.length))
	);

	// As arestas do grafo são "quem usa o quê": aqui a leitura é ao contrário —
	// dado o bloco alterado, quais páginas apontam para ele.
	const changed = new Set(changedSnippets);
	const affected = new Set<string>();

	for (const edge of graph.edges) {
		if (edge.refType !== 'block' || !changed.has(edge.target)) continue;

		const source = graph.nodes.find((node) => node.key === edge.source);
		if (!source || source.type !== 'page') continue;

		// Página já editada aparece no diff; listá-la de novo seria ruído.
		if (!editedPages.has(source.path)) affected.add(source.path);
	}

	return { changedSnippets, affectedPages: [...affected].sort() };
}

// ---------------------------------------------------------------------------
// Corpo do pull request
// ---------------------------------------------------------------------------

export interface PullRequestInput {
	title: string;
	description: string;
	base: string;
	head: string;
	score?: number;
	gatePassed?: boolean;
	changedFiles: readonly string[];
	impact?: ContentImpact;
}

/**
 * Monta o corpo do PR.
 *
 * O que entra aqui é o que a pessoa revisora precisa saber **antes** de abrir os
 * arquivos: a nota do linter, quantas páginas mudam sem aparecer no diff, e a
 * lista do que foi tocado.
 */
export function composePullRequestBody(input: PullRequestInput): string {
	const parts: string[] = [];

	if (input.description.trim() !== '') {
		parts.push(input.description.trim(), '');
	}

	if (typeof input.score === 'number') {
		const verdict = input.gatePassed === false ? '⚠️ abaixo do mínimo' : '✅';
		parts.push(`**Quality Score:** ${input.score.toFixed(1)}/10 ${verdict}`, '');
	}

	const docs = input.changedFiles.filter((file) => file.startsWith(DOCS_PREFIX));
	const snippets = input.changedFiles.filter((file) => file.startsWith(SNIPPETS_PREFIX));
	const others = input.changedFiles.filter(
		(file) => !file.startsWith(DOCS_PREFIX) && !file.startsWith(SNIPPETS_PREFIX)
	);

	parts.push(`**Arquivos alterados:** ${input.changedFiles.length}`, '');
	for (const [label, files] of [
		['Páginas', docs],
		['Blocos reutilizáveis', snippets],
		['Outros', others],
	] as const) {
		if (files.length === 0) continue;
		parts.push(`_${label}_`);
		for (const file of files) parts.push(`- \`${file}\``);
		parts.push('');
	}

	if (input.impact && input.impact.affectedPages.length > 0) {
		parts.push(
			`**Impacto no conteúdo:** ${input.impact.affectedPages.length} página(s) mudam por causa de bloco reutilizável e **não aparecem no diff**:`,
			''
		);
		for (const page of input.impact.affectedPages) parts.push(`- \`${page}\``);
		parts.push('');
	}

	parts.push('---', '_Preparado pelo editor do portal._');
	return parts.join('\n').trim();
}

/** URL de comparação do provedor, com título e corpo já preenchidos. */
export function compareUrl(remote: RemoteInfo, input: PullRequestInput): string {
	const parameters = new URLSearchParams({
		quick_pull: '1',
		title: input.title,
		body: composePullRequestBody(input),
	});
	return `${remote.url}/compare/${encodeURIComponent(input.base)}...${encodeURIComponent(input.head)}?${parameters}`;
}

// ---------------------------------------------------------------------------
// Criação pelo provedor
// ---------------------------------------------------------------------------

export interface PullRequestResult {
	created: boolean;
	url: string;
	number?: number;
	/** Explica por que não foi criado, quando `created` é `false`. */
	reason?: string;
}

/** Token do provedor. Vem do ambiente; nunca do repositório nem da interface. */
export function providerToken(): string {
	return (process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '').trim();
}

/**
 * Cria o PR no provedor, ou devolve o caminho manual.
 *
 * Falta de token não é erro: é a configuração mais comum de quem acabou de
 * clonar o projeto. A URL de comparação leva ao mesmo lugar com tudo preenchido.
 */
export async function createPullRequest(input: PullRequestInput): Promise<PullRequestResult> {
	const remote = await getRemote();
	if (!remote) {
		return { created: false, url: '', reason: 'Nenhum remoto `origin` configurado.' };
	}

	const token = providerToken();
	if (!token) {
		return {
			created: false,
			url: compareUrl(remote, input),
			reason: 'Sem GITHUB_TOKEN no ambiente: abra o link para criar o pull request.',
		};
	}

	if (remote.host !== 'github.com') {
		return {
			created: false,
			url: compareUrl(remote, input),
			reason: `A criação automática cobre github.com; este remoto é ${remote.host}.`,
		};
	}

	const response = await fetch(`https://api.github.com/repos/${remote.owner}/${remote.repo}/pulls`, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${token}`,
			accept: 'application/vnd.github+json',
			'content-type': 'application/json',
		},
		body: JSON.stringify({
			title: input.title,
			body: composePullRequestBody(input),
			base: input.base,
			head: input.head,
		}),
	});

	if (!response.ok) {
		// A mensagem do provedor é mais útil que a nossa, mas o token nunca
		// aparece nela — e não há nada nosso a acrescentar sobre o motivo.
		const detail = await response.text().catch(() => '');
		const message = detail.slice(0, 300) || `HTTP ${response.status}`;
		return { created: false, url: compareUrl(remote, input), reason: `O provedor recusou: ${message}` };
	}

	const created = (await response.json()) as { html_url?: string; number?: number };
	return { created: true, url: created.html_url ?? remote.url, number: created.number };
}

export { changedPaths };
