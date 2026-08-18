---
title: Autenticación
description: Envía credenciales de forma segura en todas las solicitudes.
sidebar:
  order: 2
tags: [api, seguranca, autenticacao]
---

Usa el encabezado `Authorization` para enviar un token de acceso en llamadas a la API.

```http
Authorization: Bearer TU_CLAVE_DE_API
```

## Ejemplo

```bash
curl https://api.tuempresa.com/v1/resources \
  --header "Authorization: Bearer TU_CLAVE_DE_API" \
  --header "Accept: application/json"
```

## Buenas prácticas

- Guarda secretos en una bóveda o en variables de entorno.
- Usa tokens distintos para desarrollo, pruebas y producción.
- Limita los permisos y rota las claves periódicamente.
- Revoca la credencial inmediatamente si sospechas una exposición.

Una credencial ausente, inválida o sin permiso debe devolver `401` o `403`. Consulta todos los [códigos de error](/es/api-reference/errors/).
