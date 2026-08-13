---
title: Authentication
description: Send credentials securely in every request.
sidebar:
  order: 2
---

Use the `Authorization` header to send an access token in API calls.

```http
Authorization: Bearer YOUR_API_KEY
```

## Example

```bash
curl https://api.yourcompany.com/v1/resources \
  --header "Authorization: Bearer YOUR_API_KEY" \
  --header "Accept: application/json"
```

## Best practices

- Store secrets in a vault or environment variables.
- Use different tokens for development, staging, and production.
- Limit permissions and rotate keys regularly.
- Revoke credentials immediately if exposure is suspected.

A missing, invalid, or unauthorized credential should return `401` or `403`. See all [error codes](/en/api-reference/errors/).
