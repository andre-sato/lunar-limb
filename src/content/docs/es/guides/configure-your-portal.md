---
title: Personaliza tu portal
description: Adapta la marca, los contactos y el endpoint principal para una nueva empresa.
sidebar:
  order: 2
tags: [guia, configuracao, portal]
---

El portal está diseñado para reutilizarse. Las configuraciones que normalmente cambian entre implementaciones están reunidas en `src/config/portal.ts`.

## Configura la identidad básica

Edita los siguientes valores antes de la primera publicación:

```ts title="src/config/portal.ts"
export const portal = {
  companyName: 'Tu Empresa',
  portalName: 'Portal para Desarrolladores',
  description: 'Documentación para integrar productos, plataformas y APIs de forma segura.',
  apiBaseUrl: 'https://api.tuempresa.com/v1',
  supportEmail: 'developers@tuempresa.com',
  aiClients: [
    { name: 'ChatGPT', url: 'https://chatgpt.com/' },
    { name: 'Claude', url: 'https://claude.ai/new' },
  ],
} as const;
```

Starlight obtiene el título y la descripción de este archivo. El endpoint y el correo sirven como una referencia única para quien mantenga el contenido.

## Compartir con IA

Cada página incluye el menú **Compartir con IA**. **Copiar página** coloca el título, la URL y el contenido legible de la página en el portapapeles. Al elegir un cliente de IA, también se abre en otra pestaña para pegar el contenido copiado en la conversación.

Edita `aiClients` para ofrecer solamente los clientes aprobados por tu empresa o para agregar otro destino.

El botón **Preguntar a la IA**, junto a la búsqueda, usa la misma lista. Prepara una pregunta con el contenido de la página actual y abre el cliente elegido con el prompt copiado. Para responder dentro del portal, sustituye este traspaso por una integración de servidor; nunca expongas la clave de un proveedor en el navegador.

## Ajusta la identidad visual

Las variables de color y los ajustes de la interfaz están en `src/styles/custom.css`. El tema usa variables de Starlight, por lo que los modos claro y oscuro se mantienen consistentes al cambiar los colores.

## Organiza la navegación

El menú principal está en `astro.config.mjs`. Cada área genera enlaces desde su directorio, por lo que una nueva página Markdown aparece en la sección correspondiente sin editar el menú manualmente.

:::tip
Mantén los nombres de archivo en minúsculas y separados por guiones. Definen la URL pública de cada página.
:::
