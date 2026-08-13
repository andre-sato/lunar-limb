import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { docsLoader, i18nLoader } from '@astrojs/starlight/loaders';
import { docsSchema, i18nSchema } from '@astrojs/starlight/schema';

export const collections = {
	docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
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
			}),
		}),
	}),
};
