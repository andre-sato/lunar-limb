---
title: Publish documentation
description: Add pages and keep the portal’s three areas current.
sidebar:
  order: 3
---

Every Markdown or MDX file in `src/content/docs/` becomes a portal page. Directories separate task-oriented content, technical contracts, and the history of changes.

## Where to create each type of content

| Type | Directory | Purpose |
| --- | --- | --- |
| Guide | `src/content/docs/guides/` | Teach a task or integration flow. |
| API reference | `src/content/docs/api-reference/` | Describe endpoints, fields, authentication, and errors. |
| Changelog | `src/content/docs/changelog/` | Communicate relevant changes by version or date. |

## Create a new page

```md title="src/content/docs/guides/webhooks.md"
---
title: Receive webhooks
description: Validate and process events sent by the platform.
---

# Receive webhooks

Explain the resource goal and show the implementation flow.
```

After saving the file, Starlight creates the route and includes the link in the correct section navigation.

## Keep content reliable

- Use guides for practical decisions and steps.
- Record all stable contracts in the API reference.
- Add to the changelog only changes that may affect people already integrating with the product.
