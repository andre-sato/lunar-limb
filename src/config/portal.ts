/**
 * Central white-label settings for the developer portal.
 *
 * Update these values when adapting this starter to a new company or product.
 */
export const portal = {
	companyName: 'Sua Empresa',
	portalName: 'Developer Portal',
	description:
		'Documentação para integrar produtos, plataformas e APIs com segurança.',
	apiBaseUrl: 'https://api.suaempresa.com/v1',
	/**
	 * URL pública do portal. Usada pelo sitemap e pelo registro OpenSearch (a
	 * busca "warp"), que precisam de URL absoluta. Em desenvolvimento vale o
	 * localhost; em produção defina `SITE_URL` no ambiente do build.
	 */
	siteUrl: 'https://docs.suaempresa.com',
	supportEmail: 'developers@suaempresa.com',
	aiClients: [
		{ name: 'ChatGPT', url: 'https://chatgpt.com/' },
		{ name: 'Claude', url: 'https://claude.ai/new' },
		{ name: 'Gemini', url: 'https://gemini.google.com/app' },
		{ name: 'Microsoft Copilot', url: 'https://copilot.microsoft.com/' },
	],
} as const;
