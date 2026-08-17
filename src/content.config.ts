import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { docsLoader, i18nLoader } from '@astrojs/starlight/loaders';
import { docsSchema, i18nSchema } from '@astrojs/starlight/schema';
import { withVisibility } from './lib/content/visibility-loader';

export const collections = {
	// `withVisibility` traduz os campos `visible` e `showIf` (Fase 5) para os
	// mecanismos nativos da Starlight — ver src/lib/content/visibility-loader.ts.
	docs: defineCollection({
		loader: withVisibility(docsLoader()),
		schema: docsSchema({
			extend: z.object({
				/** `false` mantém a página publicada, mas fora da navegação e da busca. */
				visible: z.boolean().optional(),
				/**
				 * Nome de uma variável de `src/config/content-variables.json`. A página só
				 * fica visível quando ela estiver ligada; prefixe com `!` para inverter.
				 */
				showIf: z.string().optional(),
				/**
				 * `true` marca uma página criada por espelhamento de idioma: ela
				 * existe para aparecer na navegação daquele idioma, mas o texto
				 * ainda é o original. Declarado aqui para ser um campo do
				 * projeto, e não um extra tolerado pelo schema.
				 */
				translationPending: z.boolean().optional(),
			}),
		}),
	}),
	// Reusable content blocks (Fase 3 do editor — see src/components/content/).
	// Not part of the Starlight sidebar/routing: these are fragments meant to
	// be pulled into docs pages via <ContentBlock id="..." />, never visited
	// directly.
	snippets: defineCollection({
		loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/snippets' }),
		schema: z.object({
			title: z.string().optional(),
			description: z.string().optional(),
		}),
	}),
	i18n: defineCollection({
		loader: i18nLoader(),
		schema: i18nSchema({
			extend: z.object({
				'aiShare.trigger': z.string().optional(),
				'aiShare.copyPage': z.string().optional(),
				'aiShare.fullContent': z.string().optional(),
				'aiShare.openClient': z.string().optional(),
				'aiShare.copyAndOpen': z.string().optional(),
				'aiShare.copySuccess': z.string().optional(),
				'aiShare.openSuccess': z.string().optional(),
				'aiShare.copyError': z.string().optional(),
				'aiShare.source': z.string().optional(),
				'askAi.trigger': z.string().optional(),
				'askAi.eyebrow': z.string().optional(),
				'askAi.title': z.string().optional(),
				'askAi.close': z.string().optional(),
				'askAi.intro': z.string().optional(),
				'askAi.question': z.string().optional(),
				'askAi.placeholder': z.string().optional(),
				'askAi.respondWith': z.string().optional(),
				'askAi.submit': z.string().optional(),
				'askAi.disclaimer': z.string().optional(),
				'askAi.preparing': z.string().optional(),
				'askAi.copySuccess': z.string().optional(),
				'askAi.copyError': z.string().optional(),
				'askAi.systemPrompt': z.string().optional(),
				'askAi.scopePrompt': z.string().optional(),
				'askAi.sourcePrompt': z.string().optional(),
				'askAi.contextHeading': z.string().optional(),
				'askAi.questionHeading': z.string().optional(),
				'askAi.pageLabel': z.string().optional(),
				'askAi.urlLabel': z.string().optional(),
				'feedback.question': z.string().optional(),
				'feedback.yes': z.string().optional(),
				'feedback.no': z.string().optional(),
				'feedback.commentUp': z.string().optional(),
				'feedback.commentDown': z.string().optional(),
				'feedback.placeholder': z.string().optional(),
				'feedback.send': z.string().optional(),
				'feedback.skip': z.string().optional(),
				'feedback.thanks': z.string().optional(),
				'feedback.error': z.string().optional(),
				// Chatbot de documentação (ver src/components/ChatAssistant.astro).
				'chat.trigger': z.string().optional(),
				'chat.eyebrow': z.string().optional(),
				'chat.title': z.string().optional(),
				'chat.close': z.string().optional(),
				'chat.intro': z.string().optional(),
				'chat.placeholder': z.string().optional(),
				'chat.send': z.string().optional(),
				'chat.sources': z.string().optional(),
				'chat.disclaimer': z.string().optional(),
				'chat.thinking': z.string().optional(),
				'chat.error': z.string().optional(),
				'chat.loginRequired': z.string().optional(),
				'chat.login': z.string().optional(),
				'chat.retrievalOnly': z.string().optional(),
				'chat.clear': z.string().optional(),
				'chat.helpful': z.string().optional(),
				'chat.notHelpful': z.string().optional(),
				'chat.feedbackThanks': z.string().optional(),
				// O plugin `starlight-view-modes` traz en, de, fr e es, mas não
				// pt-BR: sem estas chaves a interface mostrava o identificador
				// cru em vez do rótulo.
				'starlightViewModes.switchesHeading': z.string().optional(),
				'starlightViewModes.defaultMode.title': z.string().optional(),
				'starlightViewModes.zenMode.title': z.string().optional(),
				'starlightViewModes.switchToDefaultMode': z.string().optional(),
				'starlightViewModes.switchToZenMode': z.string().optional(),
			}),
		}),
	}),
};
