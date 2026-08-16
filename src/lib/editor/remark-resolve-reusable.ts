import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import remarkGfm from 'remark-gfm';
import matter from 'gray-matter';
import { getContentFs } from './content-fs';

/**
 * This is the editor preview's resolver for the Fase 3 content-reuse
 * mechanism (see src/components/content/ContentBlock.astro and
 * IncludePage.astro for the equivalent used by the real, published site).
 * It is a *parallel* implementation, not literally shared code with the
 * Astro components — the preview runs through unified/remark, the real
 * site through Astro's own content + render pipeline. Both resolve the
 * same id -> same source file, so behavior should match; if the two ever
 * disagree it's a bug worth flagging.
 *
 * <ContentBlock id="x" /> and <IncludePage id="x" /> only parse as their
 * own JSX element node when the containing file is .mdx (plain .md has no
 * concept of JSX) — this plugin is only wired into the .mdx preview
 * pipeline.
 */

// Always resolve nested/referenced content with the MDX-capable parser,
// regardless of whether the *top-level* file being previewed is .md or
// .mdx — a referenced snippet/page can itself be either.
const nestedParser = unified().use(remarkParse).use(remarkMdx).use(remarkGfm);

const MAX_DEPTH = 12;

export interface ReusableIssue {
	id: string;
	reason: 'not-found' | 'circular';
}

// Loose `any` typing throughout: mdast-util-mdx-jsx's exact node/attribute
// shapes vary across versions, and this module only reads a few fields off them.
/* eslint-disable @typescript-eslint/no-explicit-any */

async function loadById(type: 'block' | 'page', id: string) {
	const fs = getContentFs(type === 'block' ? 'snippets' : 'docs');
	for (const candidate of [`${id}.md`, `${id}.mdx`]) {
		try {
			return await fs.readDocument(candidate);
		} catch {
			// try the other extension
		}
	}
	return null;
}

function matchReference(node: any): { type: 'block' | 'page'; id: string } | null {
	if (node?.type !== 'mdxJsxFlowElement' && node?.type !== 'mdxJsxTextElement') return null;
	if (node.name !== 'ContentBlock' && node.name !== 'IncludePage') return null;
	const idAttr = (node.attributes || []).find((a: any) => a.type === 'mdxJsxAttribute' && a.name === 'id');
	if (!idAttr || typeof idAttr.value !== 'string') return null;
	return { type: node.name === 'ContentBlock' ? 'block' : 'page', id: idAttr.value };
}

function errorNode(message: string): any {
	return {
		type: 'paragraph',
		data: { hProperties: { className: ['reusable-error'] } },
		children: [{ type: 'text', value: `⚠ ${message}` }],
	};
}

async function walkChildren(node: any, chain: string[], issues: ReusableIssue[], depth: number): Promise<void> {
	if (!node || !Array.isArray(node.children)) return;

	for (let i = 0; i < node.children.length; i++) {
		const child = node.children[i];
		const ref = matchReference(child);

		if (!ref) {
			await walkChildren(child, chain, issues, depth);
			continue;
		}

		if (depth >= MAX_DEPTH || chain.includes(ref.id)) {
			issues.push({ id: ref.id, reason: 'circular' });
			const trail = [...chain, ref.id].join(' → ');
			node.children[i] = errorNode(`Referência circular detectada: ${trail}`);
			continue;
		}

		const doc = await loadById(ref.type, ref.id);
		if (!doc) {
			issues.push({ id: ref.id, reason: 'not-found' });
			node.children[i] = errorNode(`Conteúdo reutilizável não encontrado: "${ref.id}"`);
			continue;
		}

		const body = matter(doc.content).content;
		const subtree = nestedParser.parse(body) as any;
		await walkChildren(subtree, [...chain, ref.id], issues, depth + 1);

		// Resolve this reference's own nested references first, then splice
		// the fully-resolved subtree in place of the reference node.
		node.children.splice(i, 1, ...subtree.children);
		i += subtree.children.length - 1;
	}
}

export function remarkResolveReusable() {
	return async (tree: any, file: any) => {
		const issues: ReusableIssue[] = [];
		await walkChildren(tree, [], issues, 0);
		file.data.reusableIssues = issues;
	};
}
