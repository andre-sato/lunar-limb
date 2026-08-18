/**
 * Workflow de documentação sobre o Git (§3).
 *
 * A camada anterior (`src/lib/editor/git-status.ts`) era **somente leitura**: o
 * editor mostrava o estado do working tree e nada mais. Esta escreve — cria
 * branch, troca, renomeia, apaga — e por isso as regras mudam.
 *
 * **Nada passa por shell.** Todo comando usa `execFile` com lista de argumentos,
 * nunca uma string interpolada. Um nome de branch vindo da interface é dado, não
 * comando: sem shell, `; rm -rf` é apenas um nome inválido de branch, não uma
 * instrução.
 *
 * **Nome de branch é validado antes, não depois.** O `git check-ref-format`
 * existe e é a autoridade, mas depender só dele significaria descobrir o erro
 * já dentro do comando. A validação aqui recusa cedo e explica o porquê.
 *
 * **O que esta camada não faz:** commit automático de qualquer coisa que o
 * usuário não tenha pedido, `push --force`, e nenhuma operação que descarte
 * trabalho sem confirmação explícita de quem chamou.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Erro de uso previsto — vira 4xx na API, não 500. */
export class GitWorkflowError extends Error {
	constructor(
		message: string,
		readonly code: 'invalid_name' | 'not_a_repo' | 'conflict' | 'not_allowed' | 'failed'
	) {
		super(message);
	}
}

async function git(args: string[]): Promise<string> {
	try {
		const { stdout } = await run('git', args, { cwd: process.cwd(), maxBuffer: 20 * 1024 * 1024 });
		return stdout;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (/not a git repository/i.test(message)) {
			throw new GitWorkflowError('Este diretório não é um repositório Git.', 'not_a_repo');
		}
		throw new GitWorkflowError(message.split('\n')[0] ?? 'Comando Git falhou.', 'failed');
	}
}

// ---------------------------------------------------------------------------
// Nomes de branch
// ---------------------------------------------------------------------------

/** Prefixo sugerido para branches criadas pelo editor. */
export const BRANCH_PREFIX = 'docs/';

/**
 * Regras de nome de branch.
 *
 * São as do Git (`git check-ref-format`), aplicadas antes de chamar o comando
 * para a mensagem de erro sair em português e apontar o problema.
 */
export function validateBranchName(name: string): { ok: true } | { ok: false; reason: string } {
	const trimmed = name.trim();

	if (trimmed === '') return { ok: false, reason: 'O nome não pode ficar vazio.' };
	if (trimmed.length > 200) return { ok: false, reason: 'O nome é longo demais.' };
	if (/\s/.test(trimmed)) return { ok: false, reason: 'O nome não pode conter espaços.' };
	if (/[~^:?*[\\]/.test(trimmed)) return { ok: false, reason: 'Os caracteres ~ ^ : ? * [ \\ não são aceitos.' };
	if (/\.\./.test(trimmed)) return { ok: false, reason: 'O nome não pode conter "..".' };
	if (/^[-/]|[/.]$/.test(trimmed)) return { ok: false, reason: 'O nome não pode começar com - ou / nem terminar com / ou ponto.' };
	if (/\/\//.test(trimmed)) return { ok: false, reason: 'O nome não pode conter "//".' };
	if (trimmed.endsWith('.lock')) return { ok: false, reason: 'O nome não pode terminar em ".lock".' };
	if (/[\x00-\x20\x7f]/.test(trimmed)) return { ok: false, reason: 'O nome contém caracteres de controle.' };
	// `@{` tem significado especial em revisões do Git.
	if (trimmed.includes('@{')) return { ok: false, reason: 'O nome não pode conter "@{".' };
	if (trimmed === '@') return { ok: false, reason: 'O nome não pode ser apenas "@".' };

	return { ok: true };
}

function assertBranchName(name: string): string {
	const check = validateBranchName(name);
	if (!check.ok) throw new GitWorkflowError(check.reason, 'invalid_name');
	return name.trim();
}

/** Transforma um título em nome de branch utilizável. */
export function suggestBranchName(title: string, prefix = BRANCH_PREFIX): string {
	const slug = title
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60)
		.replace(/-+$/, '');

	return `${prefix}${slug || 'alteracao'}`;
}

// ---------------------------------------------------------------------------
// Branches
// ---------------------------------------------------------------------------

export interface BranchInfo {
	name: string;
	current: boolean;
	/** Commits à frente e atrás do branch padrão. */
	ahead: number;
	behind: number;
}

export interface BranchList {
	available: boolean;
	current: string;
	/** Branch padrão do repositório — a base natural de um PR. */
	defaultBranch: string;
	branches: BranchInfo[];
}

/**
 * Branch padrão do repositório.
 *
 * Tenta o que o remoto declara; sem remoto configurado, procura `main` e
 * `master` na ordem. Chutar errado aqui faria todo PR nascer com a base errada.
 */
export async function detectDefaultBranch(): Promise<string> {
	try {
		const head = await git(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']);
		const name = head.trim().replace('refs/remotes/origin/', '');
		if (name) return name;
	} catch {
		// Sem remoto ou sem HEAD remoto: cai para a busca local.
	}

	for (const candidate of ['main', 'master']) {
		try {
			await git(['show-ref', '--verify', '--quiet', `refs/heads/${candidate}`]);
			return candidate;
		} catch {
			// Não existe; tenta o próximo.
		}
	}

	return (await currentBranch()) || 'main';
}

export async function currentBranch(): Promise<string> {
	try {
		return (await git(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
	} catch {
		return '';
	}
}

export async function listBranches(): Promise<BranchList> {
	let current: string;
	try {
		current = (await git(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
	} catch {
		return { available: false, current: '', defaultBranch: '', branches: [] };
	}

	const defaultBranch = await detectDefaultBranch();
	const raw = await git(['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
	const names = raw.split('\n').map((line) => line.trim()).filter(Boolean);

	const branches: BranchInfo[] = [];
	for (const name of names) {
		let ahead = 0;
		let behind = 0;

		if (name !== defaultBranch) {
			try {
				const counts = await git(['rev-list', '--left-right', '--count', `${defaultBranch}...${name}`]);
				const [left, right] = counts.trim().split(/\s+/).map(Number);
				behind = left || 0;
				ahead = right || 0;
			} catch {
				// Branches sem ancestral comum: a contagem não se aplica.
			}
		}

		branches.push({ name, current: name === current, ahead, behind });
	}

	branches.sort((left, right) => {
		if (left.current !== right.current) return left.current ? -1 : 1;
		if (left.name === defaultBranch) return -1;
		if (right.name === defaultBranch) return 1;
		return left.name.localeCompare(right.name);
	});

	return { available: true, current, defaultBranch, branches };
}

/** Cria uma branch a partir da base indicada e faz checkout nela. */
export async function createBranch(name: string, base?: string): Promise<string> {
	const branch = assertBranchName(name);
	const from = base ? assertBranchName(base) : await detectDefaultBranch();

	const existing = await listBranches();
	if (existing.branches.some((item) => item.name === branch)) {
		throw new GitWorkflowError(`A branch "${branch}" já existe.`, 'conflict');
	}

	// `-c` e não `-b`: `switch` recusa trocar de branch com alteração que se
	// perderia, o que é a proteção que o `checkout` não dá de graça.
	await git(['switch', '-c', branch, from]);
	return branch;
}

export async function switchBranch(name: string): Promise<string> {
	const branch = assertBranchName(name);
	await git(['switch', branch]);
	return branch;
}

export async function renameBranch(from: string, to: string): Promise<string> {
	const target = assertBranchName(to);
	await git(['branch', '-m', assertBranchName(from), target]);
	return target;
}

/**
 * Apaga uma branch.
 *
 * Sem `-D`: o `-d` recusa apagar trabalho que ainda não foi integrado, e essa
 * recusa é justamente a proteção. Forçar seria descartar commits em nome de
 * quem clicou num botão sem saber disso.
 */
export async function deleteBranch(name: string): Promise<void> {
	const branch = assertBranchName(name);
	const list = await listBranches();

	if (branch === list.current) {
		throw new GitWorkflowError('Não é possível apagar a branch em que você está.', 'not_allowed');
	}
	if (branch === list.defaultBranch) {
		throw new GitWorkflowError(`"${branch}" é a branch padrão do repositório.`, 'not_allowed');
	}

	try {
		await git(['branch', '-d', branch]);
	} catch (error) {
		const message = error instanceof GitWorkflowError ? error.message : String(error);
		if (/not fully merged/i.test(message)) {
			throw new GitWorkflowError(
				`"${branch}" tem commits que não estão em outra branch. Integre ou apague pelo terminal, conscientemente.`,
				'not_allowed'
			);
		}
		throw error;
	}
}
