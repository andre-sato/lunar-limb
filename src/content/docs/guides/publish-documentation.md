---
title: Publique documentação
description: Adicione páginas e mantenha as três áreas do portal atualizadas.
sidebar:
  order: 3
---

Cada arquivo Markdown ou MDX em `src/content/docs/` vira uma página do portal. A organização por diretórios separa conteúdo orientado a tarefas, contratos técnicos e histórico de mudanças.

## Onde criar cada conteúdo

| Tipo | Diretório | Objetivo |
| --- | --- | --- |
| Guia | `src/content/docs/guides/` | Ensinar uma tarefa ou fluxo de integração. |
| Referência de API | `src/content/docs/api-reference/` | Descrever endpoints, campos, autenticação e erros. |
| Changelog | `src/content/docs/changelog/` | Comunicar mudanças relevantes por versão ou data. |

## Crie uma nova página

```md title="src/content/docs/guides/webhooks.md"
---
title: Receba webhooks
description: Valide e processe eventos enviados pela plataforma.
---

# Receba webhooks

Explique o objetivo do recurso e apresente o fluxo de implementação.
```

Ao salvar o arquivo, o Starlight cria a rota e inclui o link na navegação da seção correta.

## Mantenha o conteúdo confiável

- Use guias para decisões e passos práticos.
- Registre todos os contratos estáveis na referência de API.
- Inclua no changelog apenas alterações que possam afetar pessoas que já integram com o produto.
