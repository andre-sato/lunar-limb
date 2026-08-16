import { splitContent, buildContent } from './frontmatter';

export type ContentComponentName = 'ContentBlock' | 'IncludePage' | 'If';

/**
 * Both components live at src/components/content/<Name>.astro. `docPath` is
 * relative to src/content/docs (e.g. "guides/authentication.mdx"), so the
 * import needs to climb: <subfolders> -> docs -> content -> src, then back
 * down into components/content.
 */
export function relativeContentComponentPath(docPath: string, componentName: ContentComponentName): string {
	const dir = docPath.includes('/') ? docPath.slice(0, docPath.lastIndexOf('/')) : '';
	const depth = dir === '' ? 0 : dir.split('/').length;
	const up = '../'.repeat(depth + 2);
	return `${up}components/content/${componentName}.astro`;
}

/**
 * Inserts `import ComponentName from '...';` right after the frontmatter
 * (or at the very top, if there isn't one) — unless it's already imported.
 * This is what lets "Insert Reusable Content" work without the writer ever
 * needing to know MDX requires the import.
 */
export function ensureMdxImport(content: string, docPath: string, componentName: ContentComponentName): string {
	const alreadyImported = new RegExp(`import\\s+${componentName}\\s+from\\s+['"][^'"]+['"]`).test(content);
	if (alreadyImported) return content;

	const importPath = relativeContentComponentPath(docPath, componentName);
	const importLine = `import ${componentName} from '${importPath}';`;

	const { frontmatter, body, hasFrontmatter } = splitContent(content);
	const newBody = `${importLine}\n\n${body}`;
	return hasFrontmatter ? buildContent(frontmatter, newBody) : `${importLine}\n\n${content}`;
}

export function referenceTag(componentName: ContentComponentName, id: string): string {
	return `<${componentName} id="${id}" />`;
}

/**
 * Fase 5 — bloco condicional. O corpo vai em linhas próprias porque o MDX só
 * trata o conteúdo interno como Markdown quando ele está separado da tag por
 * uma linha em branco.
 */
export function conditionalBlock(flag: string, body: string, options: { not?: boolean; equals?: string } = {}): string {
	const attrs = [`flag="${flag}"`];
	if (options.equals !== undefined && options.equals !== '') attrs.push(`equals="${options.equals}"`);
	if (options.not) attrs.push('not');
	const inner = body.trim() === '' ? 'Conteúdo condicional.' : body.trim();
	return `<If ${attrs.join(' ')}>\n\n${inner}\n\n</If>`;
}

/**
 * Substitui a tag de referência que começa em `offset` pelo conteúdo canônico —
 * o "Detach" da §28 da especificação. `body` já vem sem frontmatter.
 *
 * Recebe a posição exata (vinda de `extractReferences`) em vez de procurar a
 * tag por texto: uma página que documenta a sintaxe tem a mesma tag dentro de
 * um bloco de código *antes* da referência real, e a busca textual acertaria o
 * exemplo, corrompendo a documentação.
 */
export function detachReferenceAt(content: string, offset: number, tagLength: number, body: string): string {
	if (offset < 0 || offset + tagLength > content.length) return content;
	return content.slice(0, offset) + body.trim() + content.slice(offset + tagLength);
}
