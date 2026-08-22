/**
 * Operações em lote no editor (issue #17).
 *
 * Substituir um termo em quarenta arquivos e apagar doze de uma vez são as duas
 * operações mais destrutivas que o editor oferece. As duas têm a mesma forma de
 * falhar: elas parecem ter funcionado.
 *
 * Um `replace` que casou onde não devia não deixa erro — deixa quarenta arquivos
 * com uma palavra trocada dentro de um bloco de código. Um `delete` que levou
 * junto o snippet que cinco páginas incluem não deixa erro — deixa cinco páginas
 * publicadas com um aviso de referência quebrada que ninguém relê.
 *
 * Por isso as duas passam por **plano antes de aplicação**, e o plano carrega a
 * impressão digital do que ele leu: se o arquivo mudou entre a prévia e a
 * aplicação, aquele arquivo é pulado e relatado. Sem isso a prévia mente, e uma
 * prévia que mente é pior que nenhuma — ela transfere confiança sem transferir
 * informação.
 */

import { createHash } from 'node:crypto';
import { searchContent, type SearchHit, type SearchSources } from './search';
import type { ContentRootKey } from './graph-model';

// ---------------------------------------------------------------------------
// Substituição
// ---------------------------------------------------------------------------

export interface ReplaceOptions {
	caseSensitive?: boolean;
	/** Só arquivos cujo caminho começa com este prefixo. Vazio é o acervo todo. */
	folder?: string;
	/** Casar apenas a palavra inteira. */
	wholeWord?: boolean;
	/**
	 * Incluir ocorrências dentro de blocos de código. Desligado por padrão: uma
	 * substituição de prosa que entra num exemplo executável quebra o exemplo, e
	 * o exemplo é a parte da página que alguém copia.
	 */
	includeCodeBlocks?: boolean;
	sources?: SearchSources;
}

export interface ReplaceOccurrence {
	line: number;
	/** A linha como está hoje. */
	before: string;
	/** Como ela ficaria. */
	after: string;
	inFrontmatter: boolean;
	inCodeBlock: boolean;
}

export interface ReplaceFilePlan {
	path: string;
	root: ContentRootKey;
	/** Hash do conteúdo lido para montar a prévia. */
	fingerprint: string;
	occurrences: ReplaceOccurrence[];
}

export interface ReplacePlan {
	query: string;
	replacement: string;
	options: ReplaceOptions;
	files: ReplaceFilePlan[];
	totalOccurrences: number;
	/** Ocorrências encontradas e deixadas de fora, com o motivo. */
	skipped: Array<{ path: string; line: number; reason: string }>;
}

export function fingerprintOf(content: string): string {
	return createHash('sha256').update(content, 'utf-8').digest('hex').slice(0, 16);
}

/** As linhas que caem dentro de uma cerca de código. */
export function codeBlockLines(content: string): Set<number> {
	const lines = content.split(/\r?\n/);
	const inside = new Set<number>();
	let open = false;

	lines.forEach((line, index) => {
		if (/^\s*(```|~~~)/.test(line)) {
			// A cerca de abertura e a de fechamento pertencem ao bloco: substituir
			// dentro da própria marcação quebraria a cerca.
			inside.add(index + 1);
			open = !open;
			return;
		}
		if (open) inside.add(index + 1);
	});

	return inside;
}

function matcher(query: string, options: ReplaceOptions): RegExp {
	const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const body = options.wholeWord ? `\\b${escaped}\\b` : escaped;
	return new RegExp(body, options.caseSensitive ? 'g' : 'gi');
}

export interface PlanInput {
	query: string;
	replacement: string;
	options?: ReplaceOptions;
	/** Lê o conteúdo atual de um arquivo. */
	read: (root: ContentRootKey, path: string) => Promise<string>;
}

/**
 * Monta a prévia. **Não escreve nada.**
 *
 * A busca reaproveita `searchContent`, que é quem já sabe varrer as collections.
 * Reimplementar a varredura aqui daria duas respostas para "onde este termo
 * aparece", e a segunda envelheceria.
 */
export async function planReplace({ query, replacement, options = {}, read }: PlanInput): Promise<ReplacePlan> {
	if (query === '') throw new Error('Termo de busca vazio.');

	const hits = await searchContent(query, {
		caseSensitive: options.caseSensitive,
		sources: options.sources,
		limit: 5000,
		perFileLimit: 500,
	});

	const relevant = hits.filter((hit) => !options.folder || hit.path.startsWith(options.folder));
	const byFile = new Map<string, SearchHit[]>();
	for (const hit of relevant) {
		const key = `${hit.root}:${hit.path}`;
		byFile.set(key, [...(byFile.get(key) ?? []), hit]);
	}

	const pattern = matcher(query, options);
	const files: ReplaceFilePlan[] = [];
	const skipped: ReplacePlan['skipped'] = [];
	let total = 0;

	for (const [key, fileHits] of byFile) {
		const [root, path] = [key.slice(0, key.indexOf(':')) as ContentRootKey, key.slice(key.indexOf(':') + 1)];
		const content = await read(root, path);
		const lines = content.split(/\r?\n/);
		const code = codeBlockLines(content);

		const occurrences: ReplaceOccurrence[] = [];

		for (const hit of fileHits) {
			const before = lines[hit.line - 1];
			if (before === undefined) continue;

			const inCodeBlock = code.has(hit.line);
			if (inCodeBlock && !options.includeCodeBlocks) {
				skipped.push({ path, line: hit.line, reason: 'dentro de bloco de código' });
				continue;
			}

			pattern.lastIndex = 0;
			const after = before.replace(pattern, replacement);
			if (after === before) continue;

			occurrences.push({ line: hit.line, before, after, inFrontmatter: hit.inFrontmatter, inCodeBlock });
		}

		if (occurrences.length === 0) continue;

		files.push({ path, root, fingerprint: fingerprintOf(content), occurrences });
		total += occurrences.length;
	}

	return { query, replacement, options, files, totalOccurrences: total, skipped };
}

export interface ApplyResult {
	applied: Array<{ path: string; root: ContentRootKey; occurrences: number }>;
	/** Arquivos que mudaram entre a prévia e a aplicação, e por isso não foram tocados. */
	stale: string[];
	failed: Array<{ path: string; error: string }>;
}

export interface ApplyInput {
	plan: ReplacePlan;
	read: (root: ContentRootKey, path: string) => Promise<string>;
	write: (root: ContentRootKey, path: string, content: string) => Promise<void>;
	/** Só estes caminhos são aplicados. Ausente aplica o plano inteiro. */
	only?: string[];
}

/**
 * Aplica o plano, conferindo a impressão digital de cada arquivo.
 *
 * A substituição é feita **linha a linha, nas linhas do plano** — e não com um
 * `replace` global no arquivo. A diferença aparece quando alguém acrescentou uma
 * ocorrência depois da prévia: com o replace global ela seria trocada em
 * silêncio, e a pessoa teria aprovado uma alteração que não viu.
 */
export async function applyReplace({ plan, read, write, only }: ApplyInput): Promise<ApplyResult> {
	const result: ApplyResult = { applied: [], stale: [], failed: [] };
	const allowed = only ? new Set(only) : null;

	for (const file of plan.files) {
		if (allowed && !allowed.has(file.path)) continue;

		try {
			const current = await read(file.root, file.path);

			if (fingerprintOf(current) !== file.fingerprint) {
				result.stale.push(file.path);
				continue;
			}

			const lines = current.split(/\r?\n/);
			for (const occurrence of file.occurrences) {
				// Confere a linha inteira, não só o número: um plano montado sobre um
				// arquivo idêntico ainda pode ter a linha em outro lugar se a leitura
				// tiver vindo de outra revisão.
				if (lines[occurrence.line - 1] !== occurrence.before) continue;
				lines[occurrence.line - 1] = occurrence.after;
			}

			// Preserva o fim de linha do arquivo: reescrever CRLF como LF marcaria
			// todas as linhas como alteradas no diff, escondendo a mudança real.
			const eol = current.includes('\r\n') ? '\r\n' : '\n';
			await write(file.root, file.path, lines.join(eol));
			result.applied.push({ path: file.path, root: file.root, occurrences: file.occurrences.length });
		} catch (error) {
			result.failed.push({ path: file.path, error: error instanceof Error ? error.message : String(error) });
		}
	}

	return result;
}

// ---------------------------------------------------------------------------
// Exclusão em lote
// ---------------------------------------------------------------------------

export interface DeleteTarget {
	path: string;
	root: ContentRootKey;
}

export interface DeleteAssessment extends DeleteTarget {
	/** Quem depende deste arquivo e continuaria apontando para ele. */
	dependents: string[];
	/** `true` quando outro arquivo do próprio lote depende deste. */
	dependentsInsideBatch: boolean;
}

export interface DeletePlan {
	targets: DeleteAssessment[];
	/** Alvos com dependentes fora do lote: apagar quebra referência publicada. */
	breaking: DeleteAssessment[];
	total: number;
}

/**
 * Avalia o lote antes de apagar.
 *
 * A distinção que decide o aviso: dependente **de dentro do lote** vai sumir
 * junto, e não é problema. Dependente de fora fica apontando para um arquivo que
 * deixou de existir — e é o único caso que merece interromper alguém.
 */
export function planDelete(
	targets: readonly DeleteTarget[],
	dependentsOf: (target: DeleteTarget) => string[]
): DeletePlan {
	const inBatch = new Set(targets.map((target) => `${target.root}:${target.path}`));

	const assessed: DeleteAssessment[] = targets.map((target) => {
		const dependents = dependentsOf(target);
		const outside = dependents.filter((dependent) => !inBatch.has(dependent));

		return {
			...target,
			dependents: outside,
			dependentsInsideBatch: outside.length < dependents.length,
		};
	});

	return {
		targets: assessed,
		breaking: assessed.filter((target) => target.dependents.length > 0),
		total: assessed.length,
	};
}
