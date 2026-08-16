// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import react from '@astrojs/react';
import node from '@astrojs/node';
import { portal } from './src/config/portal';

// https://astro.build/config
export default defineConfig({
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
			customCss: ['./src/styles/custom.css'],
			components: {
				PageTitle: './src/components/PageTitle.astro',
				Hero: './src/components/Hero.astro',
				Search: './src/components/Search.astro',
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
	],
});
