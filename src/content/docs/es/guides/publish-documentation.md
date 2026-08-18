---
title: Publica documentación
description: Añade páginas y mantén actualizadas las tres áreas del portal.
sidebar:
  order: 3
tags: [guia, publicacao, portal]
---

Cada archivo Markdown o MDX en `src/content/docs/` se convierte en una página del portal. Los directorios separan contenido orientado a tareas, contratos técnicos e historial de cambios.

## Dónde crear cada tipo de contenido

| Tipo | Directorio | Objetivo |
| --- | --- | --- |
| Guía | `src/content/docs/guides/` | Enseñar una tarea o flujo de integración. |
| Referencia de la API | `src/content/docs/api-reference/` | Describir endpoints, campos, autenticación y errores. |
| Historial de cambios | `src/content/docs/changelog/` | Comunicar cambios relevantes por versión o fecha. |

## Crea una página nueva

```md title="src/content/docs/guides/webhooks.md"
---
title: Recibe webhooks
description: Valida y procesa eventos enviados por la plataforma.
---

# Recibe webhooks

Explica el objetivo del recurso y presenta el flujo de implementación.
```

Al guardar el archivo, Starlight crea la ruta e incluye el enlace en la navegación de la sección correcta.

## Mantén el contenido confiable

- Usa las guías para decisiones y pasos prácticos.
- Registra todos los contratos estables en la referencia de la API.
- Incluye en el historial de cambios solo modificaciones que puedan afectar a quienes ya integran el producto.
