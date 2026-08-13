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
	supportEmail: 'developers@suaempresa.com',
	aiClients: [
		{ name: 'ChatGPT', url: 'https://chatgpt.com/' },
		{ name: 'Claude', url: 'https://claude.ai/new' },
		{ name: 'Gemini', url: 'https://gemini.google.com/app' },
		{ name: 'Microsoft Copilot', url: 'https://copilot.microsoft.com/' },
	],
} as const;
