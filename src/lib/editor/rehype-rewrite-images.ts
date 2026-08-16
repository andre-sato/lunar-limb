import { visit } from 'unist-util-visit';
import path from 'node:path';

/**
 * Markdown/MDX images are usually written with paths relative to the page
 * file (`![](./cover.png)`, `![](../../assets/cover.png)`), which Astro's
 * own build resolves through its asset pipeline. The editor's preview has
 * no bundler in the loop, so relative image paths are rewritten here to
 * `/api/editor/asset?path=...`, resolved against `docDir` (the open
 * document's folder, expressed relative to `src/`).
 *
 * Absolute URLs, `data:` URIs, and root-relative paths (served from
 * `public/`) are left untouched.
 */
export function rehypeRewriteImages(docDir: string) {
	return (tree: any) => {
		visit(tree, 'element', (node: any) => {
			if (node.tagName !== 'img' || !node.properties?.src) return;
			const src = String(node.properties.src);

			if (/^([a-z]+:)?\/\//i.test(src) || src.startsWith('data:') || src.startsWith('/')) {
				return;
			}

			const resolved = path.posix.normalize(path.posix.join(docDir, src));
			node.properties.src = `/api/editor/asset?path=${encodeURIComponent(resolved)}`;
			// Local trust boundary: preview content comes from files the writer
			// controls, so a small inline handler to flag broken images is fine.
			node.properties.onerror = "this.classList.add('img-broken')";
		});
	};
}
