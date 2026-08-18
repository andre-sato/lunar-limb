/**
 * Workspace isolado (§21, §27).
 *
 * O Writer nunca escreve no repositório. Ele escreve aqui, num diretório à parte,
 * e o que chega à interface é o **diff** — que é a única forma de alguém aprovar
 * uma mudança sabendo o que está aprovando.
 *
 * A separação também é o que torna o cancelamento barato: descartar uma execução
 * é apagar um diretório, não desfazer alterações espalhadas pela árvore de
 * conteúdo.
 *
 * Toda escrita passa pela política de caminhos antes de tocar o disco. Confinar o
 * workspace não bastaria sozinho: `write('../../src/lib/auth/users.ts')` sairia
 * dele, e é por isso que a checagem acontece sobre o caminho lógico, antes de
 * qualquer resolução.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertWritePath, checkReadPath, PolicyViolation } from './policy';
import type { FileChange } from './types';

const ROOT = process.cwd();

/** Fora de `src/`, e fora do que o Git rastreia. */
const WORKSPACE_ROOT = path.resolve(ROOT, 'data/agent-workspaces');

export class AgentWorkspace {
	private readonly directory: string;
	private readonly written = new Map<string, string>();

	constructor(readonly runId: string) {
		// O id vem do orquestrador e é um UUID, mas confiar nisso seria confiar num
		// invariante mantido em outro arquivo.
		if (!/^[A-Za-z0-9_-]+$/.test(runId)) {
			throw new PolicyViolation('Identificador de execução inválido.', 'invalid_run_id');
		}
		this.directory = path.join(WORKSPACE_ROOT, runId);
	}

	async prepare(): Promise<void> {
		await mkdir(this.directory, { recursive: true });
	}

	/** Lê do **repositório**, para o agente saber o que já existe. */
	async readOriginal(relativePath: string): Promise<string | undefined> {
		const check = checkReadPath(relativePath);
		if (!check.allowed) throw new PolicyViolation(check.reason ?? 'Leitura não permitida.', 'path_not_allowed');

		try {
			return await readFile(path.resolve(ROOT, relativePath), 'utf-8');
		} catch {
			return undefined;
		}
	}

	/** Escreve no workspace. Nunca no repositório. */
	async write(relativePath: string, content: string, allowedPaths?: readonly string[]): Promise<void> {
		assertWritePath(relativePath, allowedPaths);

		const target = path.join(this.directory, relativePath);

		// Cinto e suspensório: mesmo com a checagem lógica acima, o caminho
		// resolvido tem de continuar dentro do workspace.
		if (!target.startsWith(this.directory + path.sep)) {
			throw new PolicyViolation('O caminho escapa do workspace.', 'path_escape');
		}

		await mkdir(path.dirname(target), { recursive: true });
		await writeFile(target, content, 'utf-8');
		this.written.set(relativePath.replace(/\\/g, '/'), content);
	}

	/** O que foi escrito, como diff contra o repositório (§21). */
	async changes(): Promise<FileChange[]> {
		const changes: FileChange[] = [];

		for (const [relativePath, after] of this.written) {
			const before = await this.readOriginal(relativePath);
			changes.push({
				path: relativePath,
				kind: before === undefined ? 'create' : 'update',
				before,
				after,
				diff: unifiedDiff(relativePath, before ?? '', after),
			});
		}

		return changes.sort((a, b) => a.path.localeCompare(b.path));
	}

	/** Descarta o workspace. Chamado ao cancelar, rejeitar ou concluir. */
	async discard(): Promise<void> {
		await rm(this.directory, { recursive: true, force: true });
	}
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

/**
 * Diff unificado simples.
 *
 * Suficiente para revisão de texto e sem dependência nova. A comparação é por
 * linha, com o maior prefixo e sufixo em comum recortados — o que produz um bloco
 * de mudança legível para edição de prosa, que é o caso desta camada. Não tenta
 * ser um algoritmo de diff mínimo: para um parágrafo reescrito no meio da página,
 * o resultado é o mesmo, e para uma reordenação grande um diff maior é honesto.
 */
export function unifiedDiff(filePath: string, before: string, after: string, context = 3): string {
	if (before === after) return '';

	const beforeLines = before === '' ? [] : before.replace(/\r\n?/g, '\n').split('\n');
	const afterLines = after === '' ? [] : after.replace(/\r\n?/g, '\n').split('\n');

	let start = 0;
	while (start < beforeLines.length && start < afterLines.length && beforeLines[start] === afterLines[start]) start++;

	let endBefore = beforeLines.length;
	let endAfter = afterLines.length;
	while (endBefore > start && endAfter > start && beforeLines[endBefore - 1] === afterLines[endAfter - 1]) {
		endBefore--;
		endAfter--;
	}

	const contextStart = Math.max(0, start - context);
	const contextEndBefore = Math.min(beforeLines.length, endBefore + context);
	const contextEndAfter = Math.min(afterLines.length, endAfter + context);

	const lines: string[] = [
		`--- a/${filePath}`,
		`+++ b/${filePath}`,
		`@@ -${contextStart + 1},${contextEndBefore - contextStart} +${contextStart + 1},${contextEndAfter - contextStart} @@`,
	];

	for (let index = contextStart; index < start; index++) lines.push(` ${beforeLines[index]}`);
	for (let index = start; index < endBefore; index++) lines.push(`-${beforeLines[index]}`);
	for (let index = start; index < endAfter; index++) lines.push(`+${afterLines[index]}`);
	for (let index = endBefore; index < contextEndBefore; index++) lines.push(` ${beforeLines[index]}`);

	return lines.join('\n');
}
