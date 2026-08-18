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
import starlightOpenAPI from 'starlight-openapi';
import starlightVersions from 'starlight-versions';
import { portal } from './src/config/portal';
import { rehypeBasePath } from './src/lib/deploy/rehype-base-path';
import starlightDocSearch from '@astrojs/starlight-docsearch';
import { algoliaCredentials } from './src/config/search';
import { getGlossaryIndex } from './src/lib/glossary/loader';
import { describeConflicts } from './src/lib/glossary/index-build';
import { remarkGlossary } from './src/lib/glossary/remark-glossary';

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

/**
 * Publicação estática (GitHub Pages).
 *
 * `PORTAL_TARGET=pages` marca o build cujo destino é um servidor de arquivos.
 * O output continua sendo `server`: as páginas da Starlight já são pré-
 * renderizadas mesmo nesse modo, e o deploy publica `dist/client`. Trocar para
 * `output: 'static'` faria as rotas de API — que existem e são necessárias no
 * deploy com Node — quebrarem o build.
 *
 * O efeito prático do flag está em `src/config/deploy.ts`: os componentes que
 * dependem de servidor não são renderizados.
 */
/**
 * Busca pelo Algolia DocSearch (`@astrojs/starlight-docsearch`).
 *
 * Registrado só quando as três credenciais estão no ambiente — elas são suas e
 * não entram no repositório. Sem elas, a busca continua sendo o Pagefind, que
 * não depende de serviço externo. Ver `src/config/search.ts`.
 *
 * O plugin avisa no build que existe um override de `Search` e não o substitui.
 * É esperado: o override é nosso e compõe o DocSearch com o assistente de
 * documentação, que fica ao lado da busca. Remover o override para "resolver" o
 * aviso tiraria o assistente do cabeçalho.
 *
 * O Pagefind segue ligado mesmo com o Algolia ativo, porque a busca "warp"
 * (`/warp?q=termo`) consulta aquele índice. São coisas diferentes: o Algolia é a
 * interface de busca; o índice local é o que responde ao atalho.
 */
function docSearchPlugins() {
	const credentials = algoliaCredentials();
	if (!credentials) return [];

	return [
		starlightDocSearch({
			appId: credentials.appId,
			apiKey: credentials.apiKey,
			indexName: credentials.indexName,
		}),
	];
}

/**
 * Stub do módulo virtual do DocSearch.
 *
 * `DocSearch.astro` importa `virtual:starlight/docsearch-config` no script do
 * cliente, e esse módulo só existe quando o plugin está registrado. Como o
 * componente é importado estaticamente pelo nosso `Search.astro`, sem o stub o
 * build quebraria justamente na configuração mais comum: a que não tem Algolia.
 */
function docSearchStub() {
	if (algoliaCredentials()) return [];

	const id = 'virtual:starlight/docsearch-config';
	const resolved = `\0${id}`;
	return [
		{
			name: 'docsearch-config-stub',
			/** @param {string} source */
			resolveId: (source) => (source === id ? resolved : undefined),
			/** @param {string} moduleId */
			load: (moduleId) => (moduleId === resolved ? 'export default {};' : undefined),
		},
	];
}

/**
 * `base` para site de projeto no Pages (`usuario.github.io/repositorio`).
 *
 * Vazio para site de usuário/organização ou domínio próprio, onde a raiz é `/`.
 */
/**
 * Glossário: índice carregado uma vez, no build (§28).
 *
 * Montar o índice por página custaria uma leitura de disco por arquivo. Aqui ele
 * é montado uma vez e o transformer recebe a referência pronta.
 *
 * Forma disputada por duas definições vira aviso no build (§18): em silêncio,
 * uma das duas simplesmente nunca apareceria, e ninguém descobriria olhando a
 * página.
 */
const glossaryIndex = await getGlossaryIndex({ fresh: true });
for (const conflict of describeConflicts(glossaryIndex)) {
	console.warn(`
[glossário] ${conflict}
`);
}

const basePath = (process.env.PAGES_BASE || '/').trim();
const normalizedBase = basePath === '' || basePath === '/' ? '/' : `/${basePath.replace(/^\/+|\/+$/g, '')}/`;

/**
 * Prerender das páginas de tag.
 *
 * O `starlight-tags` injeta uma rota dinâmica com `getStaticPaths`. Num projeto
 * de output `server`, a Astro ignora `getStaticPaths` e chama a página sob
 * demanda — sem os dados que ela espera, o que dá 500 em cada `/tags/<tag>`.
 * O aviso aparece no build ("getStaticPaths() ignored in dynamic page"), mas o
 * arquivo é do pacote e não dá para acrescentar `export const prerender = true`
 * nele.
 *
 * Este hook marca a rota como pré-renderizada de fora, que é para isso que ele
 * existe. O índice `/tags` já funcionava; o que estava quebrado era a página de
 * cada tag.
 */
function prerenderTagPages() {
	return {
		name: 'prerender-tag-pages',
		hooks: {
			/** @param {{ route: { component: string, prerender: boolean } }} options */
			'astro:route:setup': ({ route }) => {
				if (route.component.includes('starlight-tags')) route.prerender = true;
			},
		},
	};
}

// https://astro.build/config
export default defineConfig({
	base: normalizedBase,
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
				// Só entra quando o site é servido na raiz. Com um `base` de
				// subcaminho, o validador e o `rehypeBasePath` trabalham em
				// quadros diferentes: o validador confere os caminhos como
				// escritos na fonte, e o prefixo é acrescentado na renderização.
				// O resultado é acusar como quebrados links que o HTML final
				// traz corretos — conferido no HTML gerado. A validação continua
				// valendo no build de raiz, que é o do desenvolvimento e do PR.
				...(normalizedBase === '/' ? [starlightLinksValidator({
					errorOnRelativeLinks: false,
					errorOnInvalidHashes: true,
					// Rotas que não são entradas de conteúdo da Starlight: o
					// validador não as vê no grafo de documentação e as acusaria
					// como quebradas. São de duas naturezas — páginas próprias do
					// portal (editor, administração) e rotas injetadas por outros
					// plugins (tags, busca warp).
					exclude: [
						'/editor',
						'/editor/**',
						'/settings',
						'/settings/**',
						'/login',
						'/403',
						'/tags',
						'/tags/**',
						'/atualizacoes',
						'/glossary',
						'/glossary/**',
						'/warp',
						'/warp.xml',
					],
				})] : []),
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
				...docSearchPlugins(),
			],
			customCss: ['./src/styles/custom.css'],
			// Middleware de rota da Starlight: desliga a coluna lateral, já que a
			// navegação passou para o topo. Ver src/lib/nav/route-middleware.ts.
			routeMiddleware: './src/lib/nav/route-middleware.ts',
			components: {
				PageTitle: './src/components/PageTitle.astro',
				Hero: './src/components/Hero.astro',
				Search: './src/components/Search.astro',
				Header: './src/components/PortalHeader.astro',
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
		prerenderTagPages(),
		starWarp({
			openSearch: {
				enabled: true,
				title: `${portal.companyName} ${portal.portalName}`,
				description: portal.description,
			},
		}),
	],
	markdown: {
		remarkPlugins: [[remarkGlossary, { index: glossaryIndex }]],
		// Só entra em cena quando o site é servido sob um subcaminho: a Astro
		// reescreve os links que ela gera, mas não os escritos à mão no Markdown.
		rehypePlugins: normalizedBase === '/' ? [] : [[rehypeBasePath, { base: normalizedBase }]],
	},
	vite: {
		resolve: { alias: [monacoEsmAlias] },
		plugins: [...docSearchStub()],
	},
});
