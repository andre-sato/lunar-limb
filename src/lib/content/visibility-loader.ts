import type { Loader, LoaderContext } from 'astro/loaders';
import rawVariables from '../../config/content-variables.json';
import { hiddenReasonFor, normalizeVariables } from './variables';

/**
 * Fase 5 — `visible: false` e `showIf: <variável>` no frontmatter.
 *
 * "Invisível para o leitor" aqui significa: **fora da navegação e fora da
 * busca, mas ainda publicada e acessível por URL direta**. É exatamente o que
 * a Starlight já sabe fazer via `sidebar.hidden` e `pagefind: false`; este
 * wrapper apenas traduz os nossos dois campos para esses dois, em vez de
 * inventar um mecanismo de renderização próprio.
 *
 * Deliberadamente **não** usamos `draft: true`, que removeria a página do
 * build de produção — o pedido é "publicada, porém invisível", não "não
 * publicada".
 *
 * Roda depois do loader original, sobre as entradas já carregadas. Como as
 * variáveis são resolvidas em build time, mudar uma variável e reconstruir é o
 * que liga/desliga as páginas condicionais.
 */
export function withVisibility(base: Loader): Loader {
	return {
		...base,
		name: `${base.name}+visibility`,
		load: async (context: LoaderContext) => {
			await base.load(context);

			const variables = normalizeVariables(rawVariables);

			for (const [, entry] of context.store.entries()) {
				const data = entry.data as Record<string, unknown>;
				if (!hiddenReasonFor(data, variables)) continue;

				const sidebar =
					data.sidebar && typeof data.sidebar === 'object' && !Array.isArray(data.sidebar)
						? (data.sidebar as Record<string, unknown>)
						: {};

				const nextData = {
					...data,
					sidebar: { ...sidebar, hidden: true },
					pagefind: false,
				};

				context.store.set({
					id: entry.id,
					data: nextData,
					body: entry.body,
					filePath: entry.filePath,
					deferredRender: entry.deferredRender,
					rendered: entry.rendered,
					assetImports: entry.assetImports,
					// `store.set` ignora a escrita quando o digest recebido é igual ao
					// que já está guardado. Reaproveitar o digest original faria este
					// wrapper virar um no-op silencioso — o digest precisa refletir os
					// dados novos.
					digest: context.generateDigest(nextData),
				});
			}
		},
	};
}
