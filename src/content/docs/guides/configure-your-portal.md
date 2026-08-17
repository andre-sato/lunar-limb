---
title: Personalize o portal
description: Adapte marca, contatos e endpoint principal para uma nova empresa.
sidebar:
  order: 2
---

O portal foi estruturado para ser reutilizado. As configurações que costumam mudar de uma implementação para outra ficam reunidas em `src/config/portal.ts`.

## Configure a identidade básica

Edite os valores abaixo antes da primeira publicação:

```ts title="src/config/portal.ts"
export const portal = {
  companyName: 'Sua Empresa',
  portalName: 'Developer Portal',
  description: 'Documentação para integrar produtos, plataformas e APIs com segurança.',
  apiBaseUrl: 'https://api.suaempresa.com/v1',
  supportEmail: 'developers@suaempresa.com',
  aiClients: [
    { name: 'ChatGPT', url: 'https://chatgpt.com/' },
    { name: 'Claude', url: 'https://claude.ai/new' },
  ],
} as const;
```

O título e a descrição usados pelo Starlight são obtidos desse arquivo. O endpoint e o e-mail funcionam como referências únicas para quem mantiver o conteúdo.

## Compartilhamento com IA

Cada página inclui o menu **Compartilhar com IA**. A opção **Copiar página** coloca o título, a URL e o conteúdo legível da página na área de transferência. Ao escolher um cliente de IA, o portal também abre esse cliente em outra aba para que o conteúdo seja colado na conversa.

Edite a lista `aiClients` para disponibilizar apenas os clientes aceitos pela sua empresa ou para adicionar outro destino.

O botão **Perguntar à documentação**, ao lado da busca, é outra coisa: ele responde dentro do próprio portal, sem levar o leitor para fora. A pergunta vai ao servidor, que busca os trechos relevantes nas páginas publicadas, aplica os guardrails e só então chama o modelo. A chave do provedor fica no servidor e nunca é devolvida por rota alguma — configure-a em **Settings → Chatbot**. Sem chave, o assistente devolve os trechos encontrados com as fontes.

## Ajuste a identidade visual

As variáveis de cor e alguns ajustes de interface ficam em `src/styles/custom.css`. O tema usa variáveis do Starlight, portanto os modos claro e escuro permanecem consistentes depois da troca das cores.

## Organize a navegação

O menu principal está em `astro.config.mjs`. Cada área usa a geração automática de links por diretório, então uma nova página Markdown passa a aparecer na seção correspondente sem precisar editar manualmente o menu.

:::tip
Mantenha nomes de arquivos em minúsculas e separados por hífens. Eles definem a URL pública de cada página.
:::
