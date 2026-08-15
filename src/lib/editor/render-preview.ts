import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeStringify from 'rehype-stringify';
import matter from 'gray-matter';

/**
 * Best-effort preview pipeline. This intentionally does NOT try to reproduce
 * Astro/Starlight/MDX component rendering (that's a Fase 2/3 concern once
 * MDX component resolution is wired up) — it renders plain GitHub-flavored
 * Markdown so the writer gets fast, accurate feedback on prose, headings,
 * tables, code blocks, task lists, etc. while writing.
 */
const processor = unified()
	.use(remarkParse)
	.use(remarkGfm)
	.use(remarkRehype, { allowDangerousHtml: true })
	.use(rehypeRaw)
	.use(rehypeStringify, { allowDangerousHtml: true });

export interface PreviewResult {
	html: string;
	frontmatter: Record<string, unknown>;
	warning?: string;
}

export async function renderPreview(rawContent: string): Promise<PreviewResult> {
	const parsed = matter(rawContent);

	try {
		const file = await processor.process(parsed.content);
		return {
			html: String(file),
			frontmatter: parsed.data ?? {},
		};
	} catch (err) {
		return {
			html: '',
			frontmatter: parsed.data ?? {},
			warning: err instanceof Error ? err.message : 'Erro ao renderizar o Markdown.',
		};
	}
}
