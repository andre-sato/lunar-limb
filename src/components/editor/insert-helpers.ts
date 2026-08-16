import { splitContent, buildContent } from './frontmatter';

export type ContentComponentName = 'ContentBlock' | 'IncludePage';

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
