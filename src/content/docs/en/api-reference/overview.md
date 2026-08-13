---
title: Overview
description: Common conventions for consuming the API.
sidebar:
  order: 1
---

This section describes the API’s technical contract. The paths and names are neutral examples that help document any product.

## Base URL

```text
https://api.yourcompany.com/v1
```

Use HTTPS in every environment. The version segment (`/v1`) lets the API evolve without interrupting existing integrations.

## Data format

Send and receive UTF-8 JSON. Include the following headers in requests that send a body:

```http
Content-Type: application/json
Accept: application/json
```

## Response structure

API resources should keep predictable field names and stable identifiers:

```json
{
  "id": "res_01HXYZ123",
  "status": "active",
  "created_at": "2026-08-12T12:00:00Z"
}
```

Read about [authentication](/en/api-reference/authentication/) and [errors](/en/api-reference/errors/) before documenting specific endpoints.
