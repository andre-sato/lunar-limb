---
type: Guide
title: Assistente de documentação
description: 'O chatbot do portal: recuperação, citação obrigatória, guardrails e o que muda com e sem modelo de linguagem.'
resource: https://docs.suaempresa.com/guides/assistente/
tags:
  - guia
  - ia
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
    resource: src/content/docs/guides/assistente.mdx
    title: src/content/docs/guides/assistente.mdx no repositório
    last_modified: '2026-08-22T00:41:25.382Z'
audiences:
  - developer
  - product
owner:
  type: team
  id: documentation
---

O mesmo pipeline atende os dois modos, e o modelo é a **última** etapa, não a
espinha:

```text
entrada → guardrails → recuperação → autorização → contexto → modelo
        → guardrails de saída → validação de citação → resposta
```

Sem `ANTHROPIC_API_KEY` no ambiente, a etapa do modelo não roda e a resposta são
os trechos com um resumo extrativo. Não é modo degradado: é a configuração
padrão, e a única **imune por construção** a alucinação e a injeção indireta,
porque não há nada a instruir.

### As decisões que valem registro

**A autorização vem antes do contexto.** Filtrar depois da geração significaria
que o modelo já leu o que a pessoa não pode ver — e uma resposta filtrada ainda
vazaria pela forma como foi escrita. O gancho `authorize` roda sobre os trechos
recuperados, antes de qualquer coisa chegar ao prompt.

**Confiança baixa não gera.** Gerar a partir de evidência fraca é exatamente
onde um assistente inventa. Abaixo do limiar, o pipeline devolve os trechos e
diz que não encontrou o suficiente — os trechos continuam ali para quem quiser
julgar sozinho.

**Citação inventada derruba o texto.** Se a resposta cita uma página que não
entrou no contexto, o texto gerado é descartado e os trechos assumem. Uma
citação falsa é pior que nenhuma: dá aparência de fundamento a uma frase que não
tem.

**A credencial vive no ambiente.** Não em `integrations.json`, pelo mesmo motivo
do Algolia e do GitHub: segredo em arquivo de configuração acaba num backup, num
log ou numa resposta de API.

**Falha do provedor não vira resposta inventada.** Cai nos trechos, que
continuam sendo uma resposta útil.

Cada intervenção de guardrail vira evento de auditoria com o tipo, nunca com o
conteúdo da conversa.

### O que ficou de fora

Sugestões de pergunta por página (§14) e o botão "perguntar sobre esta página"
(§15) não foram implementados. O resumo de conversa longa continua sendo o
recorte das mensagens recentes, não um resumo gerado.
