// @ts-check
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import react from '@astrojs/react';
import node from '@astrojs/node';
import starWarp from '@inox-tools/star-warp';
import starlightLinksValidator from 'starlight-links-validator';
import starlightScrollToTop from 'starlight-scroll-to-top';
import starlightTags from 'starlight-tags';
import starlightVideos from 'starlight-videos';
import starlightViewModes from 'starlight-view-modes';
import starlightOpenAPI from 'starlight-openapi';
import starlightVersions from 'starlight-versions';
import { portal } from './src/config/portal';

// `monaco-vim` (Fase 5) importa caminhos internos como
// `monaco-editor/esm/vs/editor/editor.api`. O campo `exports` do monaco-editor
// 0.56 mapeia `./*` para `./esm/vs/*.js`, então esses caminhos viram
// `esm/vs/esm/vs/...` e não resolvem. O alias abaixo os aponta direto para os
// arquivos reais no disco.
const monacoEsmAlias = {
	find: /^monaco-editor\/esm\/vs\/(.*)$/,
	replacement: fileURLToPath(new URL('./node_modules/monaco-editor/esm/vs/$1', import.meta.url)),
};

/**
 * Referência da API a partir de um arquivo OpenAPI (`starlight-openapi`).
 *
 * O plugin é registrado **só quando existe um schema** em `src/schemas/`. A
 * referência de API deste portal é escrita à mão e não descreve endpoints
 * concretos; inventar um schema para ativar o plugin criaria documentação falsa.
 * Assim, basta colocar `src/schemas/minha-api.yaml` no repositório para as
 * páginas passarem a existir — sem tocar nesta configuração.
 */
function openApiPlugins() {
	const dir = fileURLToPath(new URL('./src/schemas', import.meta.url));
	if (!existsSync(dir)) return [];

	// Só documentos que **são** OpenAPI. Não basta a extensão: o plugin entende
	// apenas `paths`, e um AsyncAPI (que descreve canais, não rotas HTTP) gera
	// uma página com o título certo e nenhuma operação — falha silenciosa, pior
	// que um erro. Ver `scripts/asyncapi-to-docs.ts` para o caminho do AsyncAPI.
	const schemas = readdirSync(dir)
		.filter((file) => /\.(ya?ml|json)$/i.test(file))
		.filter((file) => {
			const raw = readFileSync(`${dir}/${file}`, 'utf-8');
			return /^\s*["']?(openapi|swagger)["']?\s*:/m.test(raw);
		});
	if (schemas.length === 0) return [];

	return [
		starlightOpenAPI(
			schemas.map((file) => ({
				base: `api/${file.replace(/\.(ya?ml|json)$/i, '')}`,
				schema: `./src/schemas/${file}`,
				sidebar: { label: file.replace(/\.(ya?ml|json)$/i, '') },
			}))
		),
	];
}

/**
 * Documentação versionada (`starlight-versions`).
 *
 * Também condicional, e pelo mesmo motivo: o plugin exige versões declaradas, e
 * cada versão é uma cópia congelada da documentação gerada pelo comando dele.
 * Declarar uma versão vazia mudaria a navegação sem haver conteúdo antigo para
 * mostrar. Crie `versions.json` com `["1.0"]` e rode o comando do plugin para
 * ativar.
 */
function versionPlugins() {
	const file = fileURLToPath(new URL('./versions.json', import.meta.url));
	if (!existsSync(file)) return [];

	try {
		const declared = JSON.parse(readFileSync(file, 'utf-8'));
		if (!Array.isArray(declared) || declared.length === 0) return [];
		return [starlightVersions({ versions: declared.map((slug) => ({ slug: String(slug) })) })];
	} catch {
		// `versions.json` inválido não deve derrubar o build do portal inteiro.
		return [];
	}
}

// https://astro.build/config
export default defineConfig({
	// URL pública do portal. Sitemap e registro OpenSearch (busca "warp")
	// precisam de URL absoluta — sem ela o primeiro é ignorado e o segundo
	// derruba o build. `SITE_URL` permite trocá-la por ambiente sem editar
	// código.
	site: process.env.SITE_URL || portal.siteUrl,
	// The editor exposes on-demand pages/API routes that read and write
	// Markdown files from the repository. A static build cannot serve those
	// routes, so the portal uses Astro's Node server output. Documentation
	// pages remain cacheable/static-friendly, while the editor and API routes
	// are available in both `astro dev` and the built standalone server.
	output: 'server',
	adapter: node({ mode: 'standalone' }),
	integrations: [
		starlight({
			title: {
				'pt-BR': `${portal.companyName} ${portal.portalName}`,
				en: `${portal.companyName} Developer Portal`,
				es: `${portal.companyName} Portal para Desarrolladores`,
			},
			description: portal.description,
			defaultLocale: 'root',
			locales: {
				root: {
					label: 'Português (Brasil)',
					lang: 'pt-BR',
				},
				en: { label: 'English', lang: 'en' },
				es: { label: 'Español', lang: 'es' },
			},
			plugins: [
				// Valida os links internos no build. É complementar ao
				// `docs:lint`: o linter olha referências de conteúdo
				// reutilizável e qualidade editorial; este verifica se cada link
				// e cada âncora apontam para algo que existe.
				starlightLinksValidator({
					errorOnRelativeLinks: false,
					errorOnInvalidHashes: true,
					// Rotas que não são entradas de conteúdo da Starlight: o
					// validador não as vê no grafo de documentação e as acusaria
					// como quebradas. São de duas naturezas — páginas próprias do
					// portal (editor, administração) e rotas injetadas por outros
					// plugins (tags, modo zen, busca warp).
					exclude: [
						'/editor',
						'/editor/**',
						'/settings',
						'/settings/**',
						'/login',
						'/403',
						'/tags',
						'/tags/**',
						'/zen-mode/**',
						'/warp',
						'/warp.xml',
					],
				}),
				// Modos de leitura: zen (só o conteúdo) e tela cheia.
				starlightViewModes(),
				// Componentes de vídeo com frontmatter próprio.
				starlightVideos(),
				// Voltar ao topo em páginas longas — o manual tem 500 linhas.
				// O rótulo é uma string única: o plugin não aceita mapa de
				// idiomas, então fica no idioma raiz do portal.
				starlightScrollToTop({
					showTooltip: true,
					tooltipText: 'Voltar ao topo',
					smoothScroll: true,
					showProgressRing: true,
				}),
				// Taxonomia por tags, com páginas de índice geradas.
				starlightTags({
					// `create` evita que uma tag nova usada numa página derrube o
					// build antes de alguém declará-la no `tags.yml`.
					onInlineTagsNotFound: 'create',
				}),
				// Condicionais: só entram quando há schema OpenAPI ou versões
				// declaradas. Ver as funções no topo do arquivo.
				...openApiPlugins(),
				...versionPlugins(),
			],
			customCss: ['./src/styles/custom.css'],
			components: {
				PageTitle: './src/components/PageTitle.astro',
				Hero: './src/components/Hero.astro',
				Search: './src/components/Search.astro',
				Sidebar: './src/components/PortalSidebar.astro',
				Head: './src/components/Head.astro',
				Footer: './src/components/Footer.astro',
			},
			sidebar: [
				{
					label: 'Guias',
					translations: { en: 'Guides', es: 'Guías' },
					items: [{ autogenerate: { directory: 'guides' } }],
				},
				{
					label: 'Referência da API',
					translations: { en: 'API Reference', es: 'Referencia de la API' },
					items: [{ autogenerate: { directory: 'api-reference' } }],
				},
				{
					label: 'Changelog',
					translations: { en: 'Changelog', es: 'Historial de cambios' },
					items: [{ autogenerate: { directory: 'changelog' } }],
				},
			],
		}),
		react(),
		// Busca "warp drive": `/warp?q=termo` cai direto no melhor resultado do
		// Pagefind, e o OpenSearch registra o portal como buscador no navegador.
		// É integração do Astro, não plugin da Starlight.
		starWarp({
			openSearch: {
				enabled: true,
				title: `${portal.companyName} ${portal.portalName}`,
				description: portal.description,
			},
		}),
	],
	vite: {
		resolve: { alias: [monacoEsmAlias] },
	},
});
