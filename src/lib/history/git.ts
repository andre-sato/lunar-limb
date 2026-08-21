/**
 * A camada de leitura do Git (P2.1).
 *
 * Tudo o que o Time Machine sabe sobre o passado vem daqui, e daqui só sai
 * leitura: nenhuma função deste arquivo escreve, faz checkout, muda branch ou
 * toca o índice. Reconstruir o passado não pode ter efeito no presente — e a
 * forma de garantir isso é `git show`, que lê um blob sem mexer na árvore de
 * trabalho.
 *
 * Todas as chamadas usam `execFile` com lista de argumentos, nunca shell: um
 * caminho de página com espaço, aspas ou cifrão é conteúdo, não sintaxe.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { HistoryEntry } from './types';

const run = promisify(execFile);

const SEPARATOR = '\x1f';
const RECORD = '\x1e';

async function git(args: string[], maxBuffer = 32 * 1024 * 1024): Promise<string> {
	try {
		const { stdout } = await run('git', args, { cwd: process.cwd(), maxBuffer });
		return stdout;
	} catch {
		return '';
	}
}

/** O repositório tem histórico? Sem isto, tudo aqui devolve vazio em silêncio. */
export async function hasHistory(): Promise<boolean> {
	return (await git(['rev-parse', '--git-dir'])).trim() !== '';
}

// ---------------------------------------------------------------------------
// Timeline (§ Timeline)
// ---------------------------------------------------------------------------

const CHANGE_MAP: Record<string, HistoryEntry['change']> = {
	A: 'added',
	M: 'modified',
	D: 'deleted',
	R: 'renamed',
};

/** Número do PR quando o assunto do commit o menciona — convenção do GitHub. */
export function pullRequestOf(subject: string): number | undefined {
	const match = subject.match(/(?:#|pull request )(\d{1,6})/i);
	return match ? Number.parseInt(match[1], 10) : undefined;
}

/**
 * A timeline de uma página.
 *
 * `--follow` para o histórico sobreviver a renomeações: uma página que mudou de
 * nome não começou a existir naquele dia, e uma timeline que a mostra assim conta
 * a história errada.
 */
export async function timelineOf(relativePath: string, limit = 50): Promise<HistoryEntry[]> {
	const file = `src/content/docs/${relativePath}`;

	// `--raw` **e** `--numstat` juntos: com `--name-status` o git suprime o
	// numstat, e a timeline saía com todas as contagens de linha em zero. O modo
	// bruto traz o status e o numstat traz as contagens.
	const stdout = await git([
		'log',
		`-${limit}`,
		'--follow',
		'--numstat',
		'--raw',
		`--format=${RECORD}%H${SEPARATOR}%aI${SEPARATOR}%an${SEPARATOR}%s${SEPARATOR}%D`,
		'--',
		file,
	]);

	const entries: HistoryEntry[] = [];

	for (const block of stdout.split(RECORD)) {
		if (block.trim() === '') continue;

		const [header, ...rest] = block.split('\n');
		const [commit, date, author, subject, refs] = header.split(SEPARATOR);
		if (!commit) continue;

		let change: HistoryEntry['change'] = 'modified';
		let insertions = 0;
		let deletions = 0;

		for (const line of rest) {
			const numstat = line.match(/^(\d+|-)\t(\d+|-)\t/);
			if (numstat) {
				insertions = numstat[1] === '-' ? 0 : Number.parseInt(numstat[1], 10);
				deletions = numstat[2] === '-' ? 0 : Number.parseInt(numstat[2], 10);
				continue;
			}

			const status = line.match(/^([AMDR])\d*\t/);
			if (status) change = CHANGE_MAP[status[1]] ?? 'modified';
		}

		entries.push({
			commit,
			date,
			author,
			subject,
			change,
			// `%D` traz `tag: v1.2` junto de branches; só as tags interessam como
			// marco de release.
			tags: [...(refs ?? '').matchAll(/tag:\s*([^,)]+)/g)].map((match) => match[1].trim()),
			pullRequest: pullRequestOf(subject ?? ''),
			insertions,
			deletions,
		});
	}

	return entries;
}

// ---------------------------------------------------------------------------
// Resolução de referência
// ---------------------------------------------------------------------------

/**
 * O commit vigente numa data.
 *
 * `--before` devolve o último commit **até** aquele instante, que é o estado que
 * alguém veria naquele dia. Usar `--since` devolveria o primeiro commit depois da
 * data — o estado que ainda não existia.
 */
export async function commitAt(date: string): Promise<string | undefined> {
	const stdout = await git(['rev-list', '-1', `--before=${date} 23:59:59`, 'HEAD']);
	const commit = stdout.trim();
	return commit === '' ? undefined : commit;
}

export async function resolveRef(ref: string): Promise<{ commit: string; date: string } | undefined> {
	const stdout = await git(['log', '-1', `--format=%H${SEPARATOR}%aI`, ref]);
	const [commit, date] = stdout.trim().split(SEPARATOR);
	return commit ? { commit, date } : undefined;
}

// ---------------------------------------------------------------------------
// Conteúdo num ponto do passado
// ---------------------------------------------------------------------------

/**
 * O conteúdo de um arquivo num commit.
 *
 * `git show ref:caminho` lê o blob direto do objeto — sem checkout, sem mexer na
 * árvore de trabalho, sem risco de deixar o repositório em estado estranho se a
 * chamada falhar no meio.
 */
export async function fileAt(ref: string, path: string): Promise<string | undefined> {
	const stdout = await git(['show', `${ref}:${path}`]);
	return stdout === '' ? undefined : stdout;
}

/** Os arquivos de documentação existentes num commit. */
export async function docsAt(ref: string): Promise<string[]> {
	const stdout = await git(['ls-tree', '-r', '--name-only', ref, 'src/content/docs']);

	return stdout
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => /\.mdx?$/.test(line))
		.map((line) => line.slice('src/content/docs/'.length));
}

/** Os arquivos de um diretório num commit — glossário, especificações. */
export async function treeAt(ref: string, directory: string, pattern = /\.[a-z]+$/i): Promise<string[]> {
	const stdout = await git(['ls-tree', '-r', '--name-only', ref, directory]);

	return stdout
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line !== '' && pattern.test(line));
}

// ---------------------------------------------------------------------------
// Commits e releases
// ---------------------------------------------------------------------------

export interface CommitInfo {
	commit: string;
	date: string;
	author: string;
	subject: string;
	files: string[];
	tags: string[];
	pullRequest?: number;
	/**
	 * Corpo da mensagem, sem o assunto. Só é preenchido por `commitsInRange`,
	 * que o busca numa segunda chamada — o corpo é multilinha e, no formato de
	 * `parseCommits`, ele se confundiria com a lista de arquivos.
	 */
	body?: string;
}

export async function commitsBetween(from: string, to = 'HEAD', limit = 200): Promise<CommitInfo[]> {
	const stdout = await git([
		'log',
		`-${limit}`,
		'--name-only',
		`--format=${RECORD}%H${SEPARATOR}%aI${SEPARATOR}%an${SEPARATOR}%s${SEPARATOR}%D`,
		`${from}..${to}`,
	]);

	return parseCommits(stdout);
}

/**
 * Os commits de uma janela de datas, com o corpo da mensagem.
 *
 * `commitsBetween` recebe refs; um changelog mensal precisa de datas. As duas
 * usam o mesmo parser, e a diferença é só o recorte — reescrever a leitura aqui
 * daria duas respostas para "quais commits existem neste intervalo".
 *
 * `--since`/`--until` do Git são inclusivos no início e exclusivos no fim, então
 * quem chama passa o primeiro instante do mês seguinte como `until`.
 */
export async function commitsInRange(since: string, until: string, limit = 500): Promise<CommitInfo[]> {
	const stdout = await git([
		'log',
		`-${limit}`,
		'--name-only',
		`--since=${since}`,
		`--until=${until}`,
		`--format=${RECORD}%H${SEPARATOR}%aI${SEPARATOR}%an${SEPARATOR}%s${SEPARATOR}%D`,
	]);

	const commits = parseCommits(stdout);
	if (commits.length === 0) return commits;

	// Segunda chamada só para os corpos, indexados por hash.
	const bodies = await git([
		'log',
		`-${limit}`,
		`--since=${since}`,
		`--until=${until}`,
		`--format=${RECORD}%H${SEPARATOR}%b`,
	]);

	const byHash = new Map<string, string>();
	for (const block of bodies.split(RECORD)) {
		if (block.trim() === '') continue;
		const index = block.indexOf(SEPARATOR);
		if (index === -1) continue;
		byHash.set(block.slice(0, index).trim(), block.slice(index + 1).trim());
	}

	return commits.map((commit) => ({ ...commit, body: byHash.get(commit.commit) ?? '' }));
}

export async function commitInfo(ref: string): Promise<CommitInfo | undefined> {
	const stdout = await git([
		'show',
		'--name-only',
		`--format=${RECORD}%H${SEPARATOR}%aI${SEPARATOR}%an${SEPARATOR}%s${SEPARATOR}%D`,
		ref,
	]);

	return parseCommits(stdout)[0];
}

function parseCommits(stdout: string): CommitInfo[] {
	const commits: CommitInfo[] = [];

	for (const block of stdout.split(RECORD)) {
		if (block.trim() === '') continue;

		const [header, ...rest] = block.split('\n');
		const [commit, date, author, subject, refs] = header.split(SEPARATOR);
		if (!commit) continue;

		commits.push({
			commit,
			date,
			author,
			subject,
			files: rest.map((line) => line.trim()).filter((line) => line !== '' && !line.startsWith('diff --git')),
			tags: [...(refs ?? '').matchAll(/tag:\s*([^,)]+)/g)].map((match) => match[1].trim()),
			pullRequest: pullRequestOf(subject ?? ''),
		});
	}

	return commits;
}

export interface ReleaseInfo {
	tag: string;
	date: string;
	commit: string;
}

/** As tags do repositório, da mais recente para a mais antiga. */
export async function releases(limit = 30): Promise<ReleaseInfo[]> {
	const stdout = await git([
		'for-each-ref',
		`--format=%(refname:short)${SEPARATOR}%(creatordate:iso-strict)${SEPARATOR}%(objectname)`,
		'--sort=-creatordate',
		`--count=${limit}`,
		'refs/tags',
	]);

	return stdout
		.split(/\r?\n/)
		.map((line) => line.split(SEPARATOR))
		.filter((parts) => parts.length === 3 && parts[0] !== '')
		.map(([tag, date, commit]) => ({ tag, date, commit }));
}
