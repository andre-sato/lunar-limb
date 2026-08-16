import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Fase 5 — Git awareness (§43 da especificação).
 *
 * Somente leitura, de propósito: o editor mostra o estado do working tree, mas
 * nunca faz commit, stage ou checkout. Operações destrutivas em um repositório
 * ficam com quem está no terminal.
 */

export type GitState = 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed';

/** Estado por caminho, relativo à raiz da collection. Ex.: `{ "docs": { "guides/a.mdx": "modified" } }` */
export interface GitStatusMap {
	docs: Record<string, GitState>;
	snippets: Record<string, GitState>;
	/** false quando não há repositório Git (ou o git não está disponível). */
	available: boolean;
	branch?: string;
}

const DOCS_PREFIX = 'src/content/docs/';
const SNIPPETS_PREFIX = 'src/content/snippets/';

function stateFromCode(code: string): GitState | null {
	if (code === '??') return 'untracked';
	// O código tem duas colunas (index, working tree); a mais "forte" vence.
	const flags = code.replace(/\s/g, '');
	if (flags.includes('R')) return 'renamed';
	if (flags.includes('D')) return 'deleted';
	if (flags.includes('A')) return 'added';
	if (flags.includes('M')) return 'modified';
	return null;
}

export async function getGitStatus(): Promise<GitStatusMap> {
	const empty: GitStatusMap = { docs: {}, snippets: {}, available: false };

	let stdout: string;
	let branch: string | undefined;
	try {
		const status = await run('git', ['status', '--porcelain', '--', 'src/content'], {
			cwd: process.cwd(),
			windowsHide: true,
		});
		stdout = status.stdout;

		try {
			const head = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
				cwd: process.cwd(),
				windowsHide: true,
			});
			branch = head.stdout.trim() || undefined;
		} catch {
			// Repositório sem commits ainda — o nome do branch é opcional.
		}
	} catch {
		// Sem git, ou fora de um repositório: o editor simplesmente não mostra badges.
		return empty;
	}

	const result: GitStatusMap = { docs: {}, snippets: {}, available: true, branch };

	for (const rawLine of stdout.split('\n')) {
		if (!rawLine.trim()) continue;

		const code = rawLine.slice(0, 2);
		let filePath = rawLine.slice(3).trim();

		// Renomeios vêm como "antigo -> novo"; interessa o destino.
		const arrow = filePath.indexOf(' -> ');
		if (arrow !== -1) filePath = filePath.slice(arrow + 4);

		// Caminhos com caracteres especiais vêm entre aspas.
		if (filePath.startsWith('"') && filePath.endsWith('"')) {
			try {
				filePath = JSON.parse(filePath);
			} catch {
				filePath = filePath.slice(1, -1);
			}
		}

		const normalized = filePath.split(path.sep).join('/');
		const state = stateFromCode(code);
		if (!state) continue;

		if (normalized.startsWith(DOCS_PREFIX)) {
			result.docs[normalized.slice(DOCS_PREFIX.length)] = state;
		} else if (normalized.startsWith(SNIPPETS_PREFIX)) {
			result.snippets[normalized.slice(SNIPPETS_PREFIX.length)] = state;
		}
	}

	return result;
}
