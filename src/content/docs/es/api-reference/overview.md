---
title: Descripción general
description: Convenciones comunes para consumir la API.
sidebar:
  order: 1
---

Esta sección describe el contrato técnico de la API. Las rutas y nombres presentados son ejemplos neutrales para orientar la documentación de cualquier producto.

## URL base

```text
https://api.tuempresa.com/v1
```

Usa HTTPS en todos los entornos. El segmento de versión (`/v1`) permite que la API evolucione sin interrumpir las integraciones existentes.

## Formato de datos

Envía y recibe JSON con UTF-8. Incluye los siguientes encabezados en las llamadas que envían un cuerpo:

```http
Content-Type: application/json
Accept: application/json
```

## Estructura de respuesta

Los recursos de la API deben mantener nombres de campos predecibles e identificadores estables:

```json
{
  "id": "res_01HXYZ123",
  "status": "active",
  "created_at": "2026-08-12T12:00:00Z"
}
```

Consulta [autenticación](/es/api-reference/authentication/) y [errores](/es/api-reference/errors/) antes de documentar endpoints específicos.
