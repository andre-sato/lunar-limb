/**
 * Organização da navegação, editável pelo editor (issue #11, opção A).
 *
 * A hierarquia dos guias vive em `src/config/sidebar.json` e **não** no disco:
 * o caminho de uma página da Starlight vem do arquivo, então mover
 * `guides/sdk.mdx` para `guides/produto/sdk.mdx` trocaria `/guides/sdk/` por
 * `/guides/produto/sdk/`. Reordenar dados não muda URL nenhuma; mover arquivo
 * muda todas as que ele tinha.
 *
 * Este módulo lê, valida e grava esses dados. A validação é o ponto: uma
 * navegação salva com um slug que não existe derruba o build inteiro — a
 * Starlight recusa com `AstroUserError`, e o portal para de subir. Recusar aqui
 * é a diferença entre um formulário que reclama e um site fora do ar.
 */

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { MANAGED_PREFIX, type SidebarConfig } from './sidebar-validate';
import path from 'node:path';

const CONFIG_FILE = path.resolve(process.cwd(), 'src/config/sidebar.json');
const DOCS_ROOT = path.resolve(process.cwd(), 'src/content/docs');

/** Slugs disponíveis: as páginas do diretório gerido, sem extensão. */
export async function availableSlugs(): Promise<string[]> {
	const dir = path.join(DOCS_ROOT, MANAGED_PREFIX);

	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return [];
	}

	return entries
		.filter((entry) => entry.isFile() && /\.mdx?$/.test(entry.name))
		.map((entry) => `${MANAGED_PREFIX}/${entry.name.replace(/\.mdx?$/, '')}`)
		.sort();
}

/**
 * Páginas que a navegação não deve listar.
 *
 * `visible: false` é a declaração de que a página existe e fica fora da
 * navegação. Ela não é órfã — é invisível de propósito, e acusá-la mandaria
 * alguém "consertar" o que está certo.
 */
export async function hiddenSlugs(slugs: readonly string[]): Promise<Set<string>> {
	const hidden = new Set<string>();

	for (const slug of slugs) {
		for (const extension of ['.mdx', '.md']) {
			const file = path.join(DOCS_ROOT, `${slug}${extension}`);
			const raw = await readFile(file, 'utf-8').catch(() => null);
			if (raw === null) continue;

			const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
			if (/^\s*visible:\s*false\s*$/m.test(frontmatter)) hidden.add(slug);
			break;
		}
	}

	return hidden;
}

export async function loadSidebar(): Promise<SidebarConfig> {
	const raw = await readFile(CONFIG_FILE, 'utf-8');
	return JSON.parse(raw) as SidebarConfig;
}

export async function saveSidebar(config: SidebarConfig): Promise<void> {
	// Indentação com tabulação e uma linha em branco no fim: o arquivo é
	// versionado, e um diff que muda o arquivo inteiro por causa de formatação
	// esconde a alteração real.
	await writeFile(CONFIG_FILE, `${JSON.stringify(config, null, '\t')}\n`, 'utf-8');
}

export * from './sidebar-validate';
