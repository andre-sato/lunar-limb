---
title: Get started
description: Make your first API call in a few minutes.
sidebar:
  order: 1
tags: [guia, api, autenticacao]
---

This guide introduces the minimum integration flow. The examples use sample values so the portal can be adapted to any product.

## 1. Create a credential

In your company environment, create an API key or access token with the required permissions. Never expose this credential in browser-based applications.

## 2. Set the base URL

The template’s default URL is in `src/config/portal.ts`:

```ts title="src/config/portal.ts"
apiBaseUrl: 'https://api.suaempresa.com/v1'
```

Replace it with your API address before publishing the documentation.

## 3. Make an authenticated request

```bash
curl https://api.suaempresa.com/v1/resources \
  --header "Authorization: Bearer YOUR_API_KEY" \
  --header "Accept: application/json"
```

A successful response returns a `200` status and a JSON body. Read the [API reference](/en/api-reference/overview/) for conventions, authentication, and errors.

## Next steps

- [Customize the portal](/en/guides/configure-your-portal/) with your company identity.
- [Publish documentation](/en/guides/publish-documentation/) for new features and versions.
