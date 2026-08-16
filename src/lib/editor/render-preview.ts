import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMdx from 'remark-mdx';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeStringify from 'rehype-stringify';
import matter from 'gray-matter';
import path from 'node:path';
import { mdxHandlers } from './mdx-handlers';
import { rehypeRewriteImages } from './rehype-rewrite-images';
import { remarkResolveReusable, type ReusableIssue } from './remark-resolve-reusable';

/**
 * Best-effort preview pipeline.
 *
 * - `.md` files go through plain GitHub-flavored Markdown (remark-gfm) with
 *   raw HTML passed through (rehype-raw), same as Fase 1.
 * - `.mdx` files go through remark-mdx so JSX/expressions/import-export
 *   parse correctly instead of throwing. JSX components are NOT executed
 *   (see mdx-handlers.ts) — they render as a labeled box with their
 *   Markdown children still rendered normally. Real Astro/Starlight
 *   component rendering is a later-phase concern.
 * - Relative image paths are rewritten to the editor's asset API so images
 *   collocated with content (or under src/assets/) actually show up.
 */

export interface PreviewOptions {
	/** True for .mdx files — switches on the MDX-aware parser + JSX handlers. */
	isMdx?: boolean;
	/** Path of the open document, relative to src/content/docs (used to resolve relative image paths). */
	docPath?: string;
}

export interface PreviewResult {
	html: string;
	frontmatter: Record<string, unknown>;
	warning?: string;
	/** 1-based line number of a parse error, when available, for Monaco markers. */
	errorLine?: number;
	/** Non-fatal issues found while resolving <ContentBlock>/<IncludePage> references. */
	reusableIssues?: ReusableIssue[];
}

function resolveDocDir(docPath?: string): string {
	if (!docPath) return 'content/docs';
	return path.posix.join('content/docs', path.posix.dirname(docPath));
}

export async function renderPreview(rawContent: string, options: PreviewOptions = {}): Promise<PreviewResult> {
	const { isMdx = false, docPath } = options;
	const docDir = resolveDocDir(docPath);

	let parsed: ReturnType<typeof matter>;
	try {
		parsed = matter(rawContent);
	} catch (err) {
		// Malformed YAML in the frontmatter fence — surface it the same way as
		// a body parse error instead of taking down the whole request.
		const line = (err as { mark?: { line?: number } } | undefined)?.mark?.line;
		return {
			html: '',
			frontmatter: {},
			warning: err instanceof Error ? `Frontmatter inválido: ${err.message}` : 'Frontmatter inválido.',
			errorLine: typeof line === 'number' ? line + 1 : undefined,
		};
	}

	try {
		const file = isMdx
			? await unified()
					.use(remarkParse)
					.use(remarkMdx)
					.use(remarkGfm)
					.use(remarkResolveReusable)
					.use(remarkRehype, { allowDangerousHtml: false, handlers: mdxHandlers } as any)
					.use(rehypeRewriteImages, docDir)
					.use(rehypeStringify, { allowDangerousHtml: true })
					.process(parsed.content)
			: await unified()
					.use(remarkParse)
					.use(remarkGfm)
					.use(remarkRehype, { allowDangerousHtml: true })
					.use(rehypeRaw)
					.use(rehypeRewriteImages, docDir)
					.use(rehypeStringify, { allowDangerousHtml: true })
					.process(parsed.content);

		const reusableIssues = (file.data as { reusableIssues?: ReusableIssue[] }).reusableIssues;

		return {
			html: String(file),
			frontmatter: parsed.data ?? {},
			reusableIssues: reusableIssues && reusableIssues.length > 0 ? reusableIssues : undefined,
		};
	} catch (err) {
		const line = (err as { line?: number } | undefined)?.line;
		return {
			html: '',
			frontmatter: parsed.data ?? {},
			warning: err instanceof Error ? err.message : 'Erro ao renderizar o conteúdo.',
			errorLine: typeof line === 'number' ? line : undefined,
		};
	}
}
