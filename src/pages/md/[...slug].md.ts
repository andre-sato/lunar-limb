import type { APIRoute } from 'astro';
import { collectPages } from '../../lib/ai-readable/collect';
import { toCleanMarkdown } from '../../lib/ai-readable/llms';

export const prerender = true;

/**
 * Markdown limpo de cada página (§4).
 *
 * `/md/guides/getting-started.md` devolve o texto sem a marcação que existe só
 * para a página ficar bonita — imports de MDX, tags de componente, sintaxe de
 * aside. O conteúdo dentro desses componentes permanece: ele é a página.
 *
 * Prefixo `/md/` e não `.md` no caminho original: a Starlight já é dona das
 * rotas de documentação, e disputar o mesmo caminho com ela renderiza a página
 * errada em algum caso de borda — sem contar que `/guides/x.md` e `/guides/x/`
 * indexados como URLs distintas confundem buscadores.
 */
export async function getStaticPaths() {
	const pages = await collectPages();

	return pages.map((page) => ({
		// `guides/getting-started.mdx` → `guides/getting-started`
		params: { slug: page.path.replace(/\.mdx?$/, '') },
		props: { page },
	}));
}

export const GET: APIRoute = async ({ props, site }) => {
	const { page } = props as { page: Awaited<ReturnType<typeof collectPages>>[number] };

	return new Response(toCleanMarkdown(page, site?.origin ?? ''), {
		headers: {
			'Content-Type': 'text/markdown; charset=utf-8',
			'Cache-Control': 'public, max-age=3600',
		},
	});
};
