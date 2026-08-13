// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { portal } from './src/config/portal';

// https://astro.build/config
export default defineConfig({
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
	],
});
