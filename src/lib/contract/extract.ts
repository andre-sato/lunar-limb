/**
 * O que a documentação afirma sobre o contrato (§7, §15).
 *
 * Funções puras que leem o texto de uma página e devolvem o que ela **mostra**:
 * requisições HTTP, blocos JSON, cabeçalhos de autenticação, comandos de CLI.
 * Sem isso não há o que comparar com a especificação.
 *
 * A associação página↔contrato vem de duas fontes, e a ordem importa. Primeiro o
 * que está **declarado** no frontmatter; depois o que dá para **inferir** do
 * texto. A spec pede que a inferência seja priorizada para reduzir trabalho
 * manual (§7), e é o que acontece — mas quando alguém declarou, a declaração
 * ganha, porque ela é a intenção de quem escreveu.
 */

import yaml from 'js-yaml';

export interface DeclaredContract {
	type: 'openapi' | 'asyncapi';
	/** `#/paths/~1users/post` */
	ref: string;
	/** Arquivo da especificação, quando a página especifica um. */
	path?: string;
}

/** Lê o bloco `contract:` do frontmatter (§7). */
export function parseDeclaredContract(raw: string): DeclaredContract | null {
	const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!frontmatter) return null;

	let parsed: { contract?: { type?: string; ref?: string; path?: string } } | null | undefined;
	try {
		parsed = yaml.load(frontmatter[1]) as typeof parsed;
	} catch {
		return null;
	}

	const contract = parsed?.contract;
	if (!contract?.ref) return null;

	const type = contract.type === 'asyncapi' ? 'asyncapi' : 'openapi';
	return { type, ref: String(contract.ref), path: contract.path ? String(contract.path) : undefined };
}

// ---------------------------------------------------------------------------
// Blocos de código
// ---------------------------------------------------------------------------

export interface CodeBlock {
	language: string;
	content: string;
	/** Linha da cerca de abertura, 1-based, contando o arquivo inteiro. */
	line: number;
}

export function extractCodeBlocks(raw: string): CodeBlock[] {
	const blocks: CodeBlock[] = [];
	// Normaliza CRLF **aqui**, uma vez, para todo mundo que consome os blocos.
	//
	// Em JavaScript, `$` não casa antes de `\r` e `.` não consome `\r` — os dois
	// são terminadores de linha. Um `Content-Type: application/json\r` fazia toda
	// expressão de cabeçalho devolver `null`, e a extração de requisições HTTP
	// simplesmente não via cabeçalho nenhum. Num repositório com checkout no
	// Windows, isso é todo arquivo.
	const lines = raw.replace(/\r\n?/g, '\n').split('\n');

	let open: { language: string; line: number; fence: string } | null = null;
	let buffer: string[] = [];

	lines.forEach((line, index) => {
		const fence = line.match(/^\s*(`{3,}|~{3,})\s*([A-Za-z0-9_+-]*)/);

		if (open) {
			const closing = line.match(/^\s*(`{3,}|~{3,})\s*$/);
			if (closing && closing[1][0] === open.fence[0] && closing[1].length >= open.fence.length) {
				blocks.push({ language: open.language, content: buffer.join('\n'), line: open.line });
				open = null;
				buffer = [];
				return;
			}
			buffer.push(line);
			return;
		}

		if (fence) {
			open = { language: (fence[2] || 'text').toLowerCase(), line: index + 1, fence: fence[1] };
			buffer = [];
		}
	});

	return blocks;
}

// ---------------------------------------------------------------------------
// Requisições HTTP documentadas (§15)
// ---------------------------------------------------------------------------

export interface DocumentedRequest {
	method: string;
	path: string;
	headers: Array<{ header: string; value?: string }>;
	/** Corpo JSON, quando o bloco traz um. */
	body?: unknown;
	line: number;
}

const REQUEST_LINE = /^\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)/i;
const HEADER_LINE = /^\s*([A-Za-z][A-Za-z0-9-]*)\s*:\s*(.+)$/;

/** Requisições completas em blocos `http`. */
export function extractHttpRequests(blocks: readonly CodeBlock[]): DocumentedRequest[] {
	const requests: DocumentedRequest[] = [];

	for (const block of blocks) {
		if (!['http', 'https', 'text'].includes(block.language)) continue;

		const lines = block.content.split('\n');
		const first = lines[0]?.match(REQUEST_LINE);
		if (!first) continue;

		const headers: Array<{ header: string; value?: string }> = [];
		let bodyStart = -1;

		for (let index = 1; index < lines.length; index++) {
			if (lines[index].trim() === '') {
				bodyStart = index + 1;
				break;
			}
			const header = lines[index].match(HEADER_LINE);
			if (header) headers.push({ header: header[1], value: header[2].trim() });
		}

		let body: unknown;
		if (bodyStart > 0) {
			try {
				body = JSON.parse(lines.slice(bodyStart).join('\n'));
			} catch {
				// Corpo que não é JSON: fora do escopo desta comparação.
			}
		}

		const url = first[2];
		requests.push({
			method: first[1].toUpperCase(),
			// Só o caminho: o host pode ser de exemplo, e comparar hosts
			// transformaria toda documentação com `api.exemplo.com` em contrato
			// quebrado.
			path: url.startsWith('http') ? new URL(url).pathname : url.split('?')[0],
			headers,
			body,
			line: block.line,
		});
	}

	return requests;
}

/** Exemplos em cURL, que é como a maioria das páginas de API escreve. */
export function extractCurlRequests(blocks: readonly CodeBlock[]): DocumentedRequest[] {
	const requests: DocumentedRequest[] = [];

	for (const block of blocks) {
		if (!['bash', 'sh', 'shell', 'console'].includes(block.language)) continue;
		if (!/\bcurl\b/.test(block.content)) continue;

		const joined = block.content.replace(/\\\r?\n/g, ' ');

		const method = joined.match(/(?:-X|--request)\s+([A-Za-z]+)/)?.[1]?.toUpperCase();
		const url = joined.match(/curl\s+(?:[^\s]*\s+)*?["']?(https?:\/\/[^\s"']+|\/[^\s"']+)/)?.[1];
		if (!url) continue;

		const headers: Array<{ header: string; value?: string }> = [];
		for (const match of joined.matchAll(/(?:-H|--header)\s+["']([^"']+)["']/g)) {
			const [, header, value] = match[1].match(/^([^:]+):\s*(.*)$/) ?? [];
			if (header) headers.push({ header: header.trim(), value: value?.trim() });
		}

		let body: unknown;
		const data = joined.match(/(?:-d|--data(?:-raw)?)\s+'([\s\S]*?)'/)?.[1];
		if (data) {
			try {
				body = JSON.parse(data);
			} catch {
				// Não é JSON.
			}
		}

		requests.push({
			// Sem `-X`, cURL usa `GET` — a menos que haja corpo, e aí é `POST`.
			method: method ?? (body !== undefined || data ? 'POST' : 'GET'),
			path: url.startsWith('http') ? new URL(url).pathname : url.split('?')[0],
			headers,
			body,
			line: block.line,
		});
	}

	return requests;
}

// ---------------------------------------------------------------------------
// Respostas e comandos
// ---------------------------------------------------------------------------

export interface DocumentedJson {
	value: unknown;
	line: number;
}

export function extractJsonBlocks(blocks: readonly CodeBlock[]): DocumentedJson[] {
	const found: DocumentedJson[] = [];

	for (const block of blocks) {
		if (!['json', 'jsonc'].includes(block.language)) continue;
		try {
			found.push({ value: JSON.parse(block.content), line: block.line });
		} catch {
			// Bloco com reticências ou comentário: não dá para comparar.
		}
	}

	return found;
}

export interface DocumentedCommand {
	command: string;
	options: string[];
	line: number;
}

/** Comandos com opções longas, para a verificação de CLI (§14). */
export function extractCommands(blocks: readonly CodeBlock[], binary: string): DocumentedCommand[] {
	const commands: DocumentedCommand[] = [];

	for (const block of blocks) {
		if (!['bash', 'sh', 'shell', 'console'].includes(block.language)) continue;

		for (const line of block.content.split('\n')) {
			const trimmed = line.replace(/^\s*\$\s*/, '').trim();
			if (!trimmed.startsWith(`${binary} `)) continue;

			commands.push({
				command: trimmed,
				options: [...trimmed.matchAll(/(--[A-Za-z][A-Za-z0-9-]*)/g)].map((match) => match[1]),
				line: block.line,
			});
		}
	}

	return commands;
}

/** Parâmetros citados como `?limit=` ou `{id}` no texto. */
export function extractParameterMentions(raw: string): string[] {
	const found = new Set<string>();
	for (const match of raw.matchAll(/[?&]([A-Za-z_][A-Za-z0-9_]*)=/g)) found.add(match[1]);
	for (const match of raw.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) found.add(match[1]);
	return [...found];
}

/** Códigos de status citados no texto: `200`, `404`, `4xx` não conta. */
export function extractStatusMentions(raw: string): string[] {
	const found = new Set<string>();
	for (const match of raw.matchAll(/\b([1-5]\d{2})\b/g)) found.add(match[1]);
	return [...found];
}
