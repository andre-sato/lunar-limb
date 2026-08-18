---
title: Customize your portal
description: Adapt the brand, contacts, and main endpoint for a new company.
sidebar:
  order: 2
tags: [guia, configuracao, portal]
---

The portal is designed to be reused. Settings that normally change between implementations are gathered in `src/config/portal.ts`.

## Set the basic identity

Update the following values before your first release:

```ts title="src/config/portal.ts"
export const portal = {
  companyName: 'Your Company',
  portalName: 'Developer Portal',
  description: 'Documentation for integrating products, platforms, and APIs securely.',
  apiBaseUrl: 'https://api.yourcompany.com/v1',
  supportEmail: 'developers@yourcompany.com',
  aiClients: [
    { name: 'ChatGPT', url: 'https://chatgpt.com/' },
    { name: 'Claude', url: 'https://claude.ai/new' },
  ],
} as const;
```

Starlight reads the title and description from this file. The endpoint and email serve as a single reference for anyone maintaining the content.

## Share with AI

Every page includes a **Share with AI** menu. **Copy page** places the title, URL, and readable page content on the clipboard. Choosing an AI client also opens it in a new tab so the copied content can be pasted into the conversation.

Edit `aiClients` to offer only the clients approved by your organization or to add another destination.

The **Ask the documentation** button beside search is a different thing: it answers inside the portal, without sending the reader elsewhere. The question goes to the server, which retrieves the relevant passages from the published pages, applies the guardrails, and only then calls the model. The provider key stays on the server and is never returned by any route — configure it under **Settings → Chatbot**. With no key configured, the assistant returns the passages it found along with their sources.

## Adjust the visual identity

Color variables and interface adjustments are in `src/styles/custom.css`. The theme uses Starlight variables, so light and dark modes remain consistent after colors change.

## Organize navigation

The main menu lives in `astro.config.mjs`. Each area generates links from its directory, so a new Markdown page appears in the corresponding section without manually editing the menu.

:::tip
Keep filenames lowercase and separated by hyphens. They determine each page’s public URL.
:::
