import { defineConfig } from 'vitest/config';

// Os testes cobrem só a camada pura + de filesystem do editor (src/lib/editor),
// que é Node puro — não precisam do runtime do Astro nem de jsdom.
export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts'],
		environment: 'node',
	},
});
