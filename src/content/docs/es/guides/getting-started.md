---
title: Comienza aquí
description: Realiza tu primera llamada a la API en pocos minutos.
sidebar:
  order: 1
tags: [guia, api, autenticacao]
---

Esta guía presenta el flujo mínimo de integración. Los ejemplos usan valores de demostración para que el portal pueda adaptarse a cualquier producto.

## 1. Crea una credencial

En el entorno de tu empresa, crea una clave de API o token de acceso con los permisos necesarios. Nunca expongas esta credencial en aplicaciones que se ejecutan en el navegador.

## 2. Define la URL base

La URL predeterminada de la plantilla está en `src/config/portal.ts`:

```ts title="src/config/portal.ts"
apiBaseUrl: 'https://api.suaempresa.com/v1'
```

Sustitúyela por la dirección de tu API antes de publicar la documentación.

## 3. Realiza una solicitud autenticada

```bash
curl https://api.suaempresa.com/v1/resources \
  --header "Authorization: Bearer TU_CLAVE_DE_API" \
  --header "Accept: application/json"
```

Una respuesta correcta devuelve el estado `200` y un cuerpo JSON. Consulta la [referencia de la API](/es/api-reference/overview/) para conocer las convenciones, autenticación y errores.

## Próximos pasos

- [Personaliza el portal](/es/guides/configure-your-portal/) con la identidad de tu empresa.
- [Publica documentación](/es/guides/publish-documentation/) para nuevas funciones y versiones.
