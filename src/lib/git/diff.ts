/**
 * Diff da branch (§3.3).
 *
 * O diff é lido do Git em formato unificado e traduzido para uma estrutura que
 * a interface desenha. Fazer o cliente interpretar o texto do `git diff` seria
 * repetir aqui um parser que já existe — e um parser de diff escrito às pressas
 * erra justamente nos casos que importam: arquivo renomeado, arquivo binário,
 * arquivo sem quebra de linha no fim.
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);

export type FileChange = 'added' | 'removed' | 'modified' | 'renamed';

export interface DiffLine {
	kind: 'added' | 'removed' | 'context' | 'meta';
	text: string;
	/** Linha no arquivo antigo, quando existe. */
	oldLine?: number;
	/** Linha no arquivo novo, quando existe. */
	newLine?: number;
}

export interface FileDiff {
	path: string;
	/** Caminho anterior, quando o arquivo foi renomeado. */
	previousPath?: string;
	change: FileChange;
	additions: number;
	deletions: number;
	lines: DiffLine[];
	/** `true` quando o Git não mostra o conteúdo (binário ou grande demais). */
	binary: boolean;
}

export interface BranchDiff {
	base: string;
	head: string;
	files: FileDiff[];
	additions: number;
	deletions: number;
}

async function git(args: string[]): Promise<string> {
	const { stdout } = await run('git', args, { cwd: process.cwd(), maxBuffer: 40 * 1024 * 1024 });
	return stdout;
}

/**
 * Interpreta a saída de `git diff --unified`.
 *
 * Exportada para o teste exercitar o parser sem repositório: a parte frágil é a
 * leitura do cabeçalho de trecho (`@@ -a,b +c,d @@`), e ela merece teste direto.
 */
export function parseUnifiedDiff(output: string): FileDiff[] {
	const files: FileDiff[] = [];
	let current: FileDiff | null = null;
	let oldLine = 0;
	let newLine = 0;

	const push = () => {
		if (current) files.push(current);
	};

	for (const raw of output.split('\n')) {
		if (raw.startsWith('diff --git ')) {
			push();
			// O caminho vem duas vezes, prefixado por a/ e b/. O segundo é o atual.
			const match = raw.match(/^diff --git a\/(.+?) b\/(.+)$/);
			current = {
				path: match?.[2] ?? '',
				change: 'modified',
				additions: 0,
				deletions: 0,
				lines: [],
				binary: false,
			};
			oldLine = 0;
			newLine = 0;
			continue;
		}

		if (!current) continue;

		if (raw.startsWith('new file mode')) current.change = 'added';
		else if (raw.startsWith('deleted file mode')) current.change = 'removed';
		else if (raw.startsWith('rename from ')) current.previousPath = raw.slice('rename from '.length);
		else if (raw.startsWith('rename to ')) {
			current.change = 'renamed';
			current.path = raw.slice('rename to '.length);
		} else if (raw.startsWith('Binary files ')) current.binary = true;

		if (raw.startsWith('@@')) {
			const match = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
			oldLine = Number(match?.[1] ?? 0);
			newLine = Number(match?.[2] ?? 0);
			current.lines.push({ kind: 'meta', text: raw });
			continue;
		}

		// Fora de um trecho, as linhas são cabeçalho (índice, modo, ---/+++).
		if (oldLine === 0 && newLine === 0) continue;

		if (raw.startsWith('+')) {
			current.lines.push({ kind: 'added', text: raw.slice(1), newLine: newLine++ });
			current.additions++;
		} else if (raw.startsWith('-')) {
			current.lines.push({ kind: 'removed', text: raw.slice(1), oldLine: oldLine++ });
			current.deletions++;
		} else if (raw.startsWith(' ')) {
			current.lines.push({ kind: 'context', text: raw.slice(1), oldLine: oldLine++, newLine: newLine++ });
		}
		// `\ No newline at end of file` e linhas vazias de separação não entram.
	}

	push();
	return files;
}

/**
 * Diff entre a base e a branch, incluindo o que ainda não foi commitado.
 *
 * As duas coisas juntas de propósito: quem escreve documentação no editor tem
 * alterações salvas em arquivo e ainda não commitadas, e um diff que as
 * escondesse mostraria uma revisão que não é a que existe no disco.
 */
export async function branchDiff(base: string, head = 'HEAD'): Promise<BranchDiff> {
	// `...` compara a partir do ancestral comum: sem isso, commits que entraram
	// na base depois da ramificação apareceriam como remoções da branch.
	const committed = await git(['diff', '--unified=3', '--find-renames', `${base}...${head}`]);
	const working = await git(['diff', '--unified=3', '--find-renames', 'HEAD']);
	const untracked = await git(['ls-files', '--others', '--exclude-standard']);

	const files = new Map<string, FileDiff>();
	for (const file of [...parseUnifiedDiff(committed), ...parseUnifiedDiff(working)]) {
		// Um arquivo pode aparecer nos dois; o do working tree é o estado atual.
		files.set(file.path, file);
	}

	// Arquivo novo ainda não rastreado não aparece em `git diff`. Ele é parte da
	// alteração de quem está escrevendo, então entra como adição, com contagem.
	for (const path of untracked.split('\n').map((line) => line.trim()).filter(Boolean)) {
		if (files.has(path)) continue;
		// Do disco, e não do Git: um arquivo não rastreado não está no índice, e
		// `git show :caminho` devolve vazio — foi assim que a contagem saía zero.
		let lineCount = 0;
		try {
			const content = await readFile(path, 'utf-8');
			lineCount = content === '' ? 0 : content.split('\n').length;
		} catch {
			// Apagado entre a listagem e a leitura, ou ilegível como texto.
		}
		files.set(path, {
			path,
			change: 'added',
			additions: lineCount,
			deletions: 0,
			lines: [],
			binary: false,
		});
	}

	const list = [...files.values()].sort((left, right) => left.path.localeCompare(right.path));

	return {
		base,
		head,
		files: list,
		additions: list.reduce((total, file) => total + file.additions, 0),
		deletions: list.reduce((total, file) => total + file.deletions, 0),
	};
}

/** Só os caminhos alterados — o suficiente para o linter e o Content Graph. */
export async function changedPaths(base: string, head = 'HEAD'): Promise<string[]> {
	const committed = await git(['diff', '--name-only', `${base}...${head}`]);
	const working = await git(['diff', '--name-only', 'HEAD']);
	const untracked = await git(['ls-files', '--others', '--exclude-standard']);

	const paths = new Set(
		[committed, working, untracked]
			.join('\n')
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean)
	);

	return [...paths].sort();
}
