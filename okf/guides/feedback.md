---
type: Guide
title: Feedback de página
description: O widget de utilidade no rodapé, o que ele guarda e o que ele deliberadamente não guarda.
resource: https://docs.suaempresa.com/guides/feedback/
tags:
  - guia
  - qualidade
  - portal
status: stable
generated:
  by: process:okf-export
  at: '2026-08-22T12:12:38.074Z'
verified:
  - by: human:mestre
    at: '2026-08-19T00:00:00.000Z'
stale_after: '2027-02-15T00:00:00.000Z'
sources:
  - id: repo
    resource: src/content/docs/guides/feedback.mdx
    title: src/content/docs/guides/feedback.mdx no repositório
    last_modified: '2026-08-22T00:41:25.387Z'
audiences:
  - developer
  - product
owner:
  type: team
  id: documentation
---

No fim de cada página de documentação há um widget **"Esta página foi útil?"** com sim/não e um campo opcional de comentário. A Starlight não traz um componente de feedback nem plugin oficial — o caminho que ela indica é sobrescrever `Footer`, que é o que o projeto faz. As alternativas de mercado são SaaS de terceiros; aqui o retorno dos seus leitores fica no próprio projeto.

O envio é **anônimo**: sem login, sem cookie, sem identificador de visitante. Grava-se caminho, voto, idioma e o comentário; o IP serve só ao limite de envio e não é armazenado.

As respostas ficam em **Settings → Feedback**: proporção de "útil", comentários recentes e **onde mexer primeiro** — páginas com maioria negativa e pelo menos 3 votos, para uma reclamação isolada não mandar o time reescrever conteúdo.

O voto vai para a [observabilidade nativa](/guides/observabilidade-de-leitura.md), e para lugar nenhum além dela. Detalhes em [docs/feedback-de-pagina.md](https://github.com/andre-sato/lunar-limb/blob/master/docs/feedback-de-pagina.md).
