---
title: Personalize o portal
description: Adapte marca, contatos e endpoint principal para uma nova empresa.
sidebar:
  order: 2
---

O portal foi estruturado para ser reutilizado. As configurações que normalmente mudam de uma implementação para outra ficam reunidas em `src/config/portal.ts`.

## Configure a identidade básica

Edite os valores abaixo antes da primeira publicação:

```ts title="src/config/portal.ts"
export const portal = {
  companyName: 'Sua Empresa',
  portalName: 'Developer Portal',
  description: 'Documentação para integrar produtos, plataformas e APIs com segurança.',
  apiBaseUrl: 'https://api.suaempresa.com/v1',
  supportEmail: 'developers@suaempresa.com',
} as const;
```

O título e a descrição usados pelo Starlight são obtidos desse arquivo. O endpoint e o e-mail funcionam como referências únicas para quem mantiver o conteúdo.

## Ajuste a identidade visual

As variáveis de cor e alguns ajustes de interface ficam em `src/styles/custom.css`. O tema usa variáveis do Starlight, portanto os modos claro e escuro permanecem consistentes depois da troca das cores.

## Organize a navegação

O menu principal está em `astro.config.mjs`. Cada área usa a geração automática de links por diretório, então uma nova página Markdown passa a aparecer na seção correspondente sem precisar editar manualmente o menu.

:::tip
Mantenha nomes de arquivos em minúsculas e separados por hífens. Eles definem a URL pública de cada página.
:::
