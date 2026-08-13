// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { portal } from './src/config/portal';

// https://astro.build/config
export default defineConfig({
	integrations: [
		starlight({
			title: `${portal.companyName} ${portal.portalName}`,
			description: portal.description,
			customCss: ['./src/styles/custom.css'],
			sidebar: [
				{ label: 'Início', link: '/' },
				{
					label: 'Guias',
					items: [{ autogenerate: { directory: 'guides' } }],
				},
				{
					label: 'Referência da API',
					items: [{ autogenerate: { directory: 'api-reference' } }],
				},
				{
					label: 'Changelog',
					items: [{ autogenerate: { directory: 'changelog' } }],
				},
			],
		}),
	],
});
