import type { APIRoute } from 'astro';
import { collectPages } from '../../lib/ai-readable/collect';
import { toCleanMarkdown } from '../../lib/ai-readable/llms';
import { recordAgentRead } from '../../lib/observe/store';

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
 *
 * Renderizada no servidor para que a leitura por agentes possa ser contada:
 * rota pré-renderizada vira arquivo estático e não passa por código nenhum. O
 * `getStaticPaths` que existia aqui deu lugar à resolução por slug, e o índice
 * é montado uma vez por processo.
 */
export const prerender = false;

type Page = Awaited<ReturnType<typeof collectPages>>[number];

/** Slug sem extensão → página. Montado na primeira requisição do processo. */
let index: Map<string, Page> | null = null;

async function pageFor(slug: string): Promise<Page | undefined> {
	if (!index) {
		const pages = await collectPages();
		index = new Map(pages.map((page) => [page.path.replace(/\.mdx?$/, ''), page]));
	}
	return index.get(slug);
}

export const GET: APIRoute = async ({ params, site }) => {
	// O slug chega sem a extensão que a rota declara: `/md/guides/x.md` produz
	// `guides/x`. Tirar um `.md` remanescente cobre quem escreve o caminho à mão.
	const slug = (params.slug ?? '').replace(/\.mdx?$/, '');
	const page = await pageFor(slug);

	if (!page) {
		return new Response('Página não encontrada.\n', {
			status: 404,
			headers: { 'Content-Type': 'text/plain; charset=utf-8' },
		});
	}

	// Só leitura que encontrou conteúdo é contada. Uma varredura de caminhos
	// inexistentes não é leitura de documentação, e contá-la inflaria a métrica
	// com ruído de robô de varredura.
	void recordAgentRead('markdown', page.path).catch(() => {
		// Medição nunca pode quebrar a entrega do conteúdo.
	});

	return new Response(toCleanMarkdown(page, site?.origin ?? ''), {
		headers: {
			'Content-Type': 'text/markdown; charset=utf-8',
			'Cache-Control': 'public, max-age=3600',
		},
	});
};
