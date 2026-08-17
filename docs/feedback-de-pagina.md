# Feedback de página

O widget "Esta página foi útil?" no fim de cada página de documentação, e a
leitura das respostas em **Settings → Feedback**.

---

## 1. O que a Starlight oferece

Nada, nativamente: a Starlight **não tem componente de feedback** nem plugin
oficial. O que ela documenta é o mecanismo para acrescentar um — sobrescrever o
componente `Footer`, que renderiza no fim de toda página de documentação.

As alternativas prontas do ecossistema (PushFeedback, Feelback, Encatch,
Forminit) são serviços de terceiros: exigem conta e enviam o retorno dos seus
leitores para fora. Como o portal já tem camada de dados própria, o widget aqui
é nativo — o dado fica no projeto.

Com a integração do Do11y ligada, o mesmo clique também vira um evento
`feedback` no Supabase, via `feedbackSelector`. As duas contagens coexistem: a
do portal funciona sozinha, a do Do11y entra de bônus.

---

## 2. O fluxo

```text
  fim da página de documentação
            │
     "Esta página foi útil?"   [👍 Sim]  [👎 Não]
            │
            ├── voto gravado IMEDIATAMENTE  ──→ data/feedback.json
            │
            ▼
     "O que faltou nesta página?" (opcional)
            │
            ├── [Enviar]  ──→ comentário ANEXADO ao voto
            └── [Agora não]
            │
            ▼
       "Obrigado pelo retorno."
```

O voto vai no clique, antes do comentário. Quem fechar a página em seguida —
que é a maioria — não some da contagem.

O comentário chega depois e **anexa** ao registro existente. Gravar um segundo
registro contaria o mesmo voto duas vezes e estragaria justamente a métrica que
o widget existe para produzir. Por isso o `POST /api/feedback` tem duas formas:

```jsonc
// voto novo → devolve { ok, id }
{ "path": "/guides/auth/", "locale": "pt-BR", "rating": "down" }

// comentário para um voto já enviado
{ "id": "<uuid>", "comment": "faltou um exemplo de curl" }
```

O rótulo do campo muda conforme o voto: "o que faltou?" só faz sentido depois
de um polegar para baixo.

---

## 3. Anonimato

Sem login, sem cookie, sem identificador de visitante. O que se grava é o
caminho da página, o voto, o idioma e — se houver — o comentário.

O IP é usado apenas para o limite de envio, em memória, e **não é gravado**
junto do voto.

Exigir cadastro para dizer "isto não ajudou" eliminaria exatamente o retorno
que interessa, então a rota é pública. O preço disso é ser alvo de abuso, e a
mitigação é:

- limite de 20 envios por IP a cada 10 minutos;
- validação estrita do caminho (só interno);
- comentário limitado a 500 caracteres;
- arquivo limitado a 5000 registros, descartando os mais antigos.

O navegador guarda em `localStorage` que já votou naquela página e passa a
mostrar o agradecimento. Isso é conveniência: **não é** controle de duplicidade,
e o servidor não é enganado por ele — quem quiser votar de novo consegue, e é
por isso que existe o limite por IP.

---

## 4. Validação do caminho

O caminho vem do navegador e é exibido como link no painel administrativo. Sem
validação, alguém poderia gravar `https://site-malicioso.example` e fazer o
painel apresentar um link externo como se fosse uma página do portal.

`normalizePath` aceita apenas caminho interno (`/…`, nunca `//…`), rejeita
`javascript:`, limita o tamanho e descarta query e fragmento — `/guia?utm=x` e
`/guia#secao` são a mesma página e não podem virar linhas separadas no
relatório.

Comentários são texto livre de visitantes anônimos. O painel os renderiza como
texto pelo React, e nada usa `dangerouslySetInnerHTML`.

---

## 5. A leitura

**Settings → Feedback**, com recorte de 7, 30, 90 dias ou tudo:

- proporção de "útil" no período;
- **Onde mexer primeiro** — páginas com maioria negativa;
- comentários recentes, ligados à página;
- todas as páginas avaliadas.

### O limiar que evita conclusão precipitada

Uma página entra em "onde mexer primeiro" só com **3 votos ou mais**. Sem esse
piso, uma página com um único voto negativo lideraria a lista de piores — e o
time reescreveria conteúdo com base na opinião de uma pessoa.

O número é `MIN_VOTES_FOR_ATTENTION`. Num portal com muito tráfego, vale
aumentá-lo.

---

## 6. Autorização

| Rota | Exige |
| --- | --- |
| `POST /api/feedback` | — (pública, anônima) |
| `GET /api/admin/feedback` | `settings.access` + `analytics.read` |
| `/settings/feedback` | `settings.access` |

A leitura reaproveita `analytics.read` em vez de criar uma permissão quase
idêntica: feedback agregado é analytics.

---

## 7. Onde o widget aparece

Em todas as páginas de documentação, nos três idiomas, com os textos vindo de
`src/content/i18n/*.json` (chaves `feedback.*`).

Fica **acima** do rodapé padrão da Starlight (paginação, "editar esta página",
data de atualização): a pergunta pertence ao fim do conteúdo, não ao fim da
navegação.

Não aparece na página inicial, que usa `template: splash` — ali não há um
documento que se "leia até o fim", e perguntar rende ruído em vez de sinal.

---

## 8. Limites conhecidos

- **Não impede voto repetido de verdade**: o `localStorage` é conveniência e o
  limite por IP é a única barreira real. Para um portal onde isso importe, o
  caminho é um identificador de sessão assinado.
- **Sem notificação**: ninguém é avisado quando chega um comentário; é preciso
  abrir a tela.
- **Sem resposta ao leitor**: o retorno é de mão única, e o comentário é
  anônimo — não há como responder.
- **Sem exportação** (CSV/webhook) nem retenção configurável além do teto de
  5000 registros.
- **`needsAttention` não pondera tráfego**: uma página com 3 votos negativos
  pesa igual a uma com 300.
