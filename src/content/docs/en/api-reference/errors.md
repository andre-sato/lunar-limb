---
title: Errors
description: HTTP status codes and error structures returned by the API.
sidebar:
  order: 3
tags: [api, erros]
---

Errors should use standard HTTP status codes and a JSON body that helps identify and fix the issue.

```json
{
  "error": {
    "code": "invalid_request",
    "message": "The email field must contain a valid address.",
    "request_id": "req_01HXYZ123"
  }
}
```

| Status | When it happens | Next action |
| --- | --- | --- |
| `400` | The request is invalid. | Review fields, formats, and supplied values. |
| `401` | The credential was not recognized. | Validate or renew the token. |
| `403` | The credential lacks the required permission. | Request the appropriate scope. |
| `404` | The resource does not exist or is unavailable. | Confirm the identifier and environment. |
| `429` | The request limit was reached. | Apply progressive backoff and retry. |
| `500` | An unexpected platform failure occurred. | Retry and send the `request_id` to support. |

:::note
Never expose internal details, secrets, or personal data in error messages. The `request_id` is the safe way to correlate an issue with support.
:::
