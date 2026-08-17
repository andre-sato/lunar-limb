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

## Como a documentação vai ao ar

O portal roda de duas formas, e cada uma serve a um propósito.

Com **servidor Node**, tudo funciona: as páginas, o editor, o login, o painel de
administração, o assistente de busca e o feedback das páginas. É o modo do
desenvolvimento e o do portal interno.

No **GitHub Pages**, só o site de documentação vai ao ar. O Pages entrega
arquivos, e editor, login e as demais funções precisam de um processo
respondendo. Os botões desses recursos não aparecem nas páginas publicadas — é
melhor não oferecê-los do que oferecer um botão que falha.

A publicação acontece sozinha a cada mudança aprovada no branch principal. Antes
de publicar, a automação roda os testes, o linter de documentação e a validação
de links: uma página com link quebrado ou nota abaixo do mínimo não chega ao ar.

O conteúdo escrito no editor entra nessa mesma esteira. Salvar grava o arquivo
Markdown no repositório; a partir do commit, a publicação segue o caminho acima.
