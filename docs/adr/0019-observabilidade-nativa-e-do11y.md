# ADR-0019 — Observabilidade nativa e Do11y

**Status:** Proposta · **Data:** 2026-08 · **Nível C4:** Contêiner

> Esta ADR responde à [issue #9](https://github.com/andre-sato/lunar-limb/issues/9):
> *comparar se a observabilidade nativa já cobre o que o Do11y se propõe a fazer.*
> Ela fica como **proposta** porque a conclusão implica retirar uma integração, e
> essa é uma decisão de produto, não de implementação.

## Contexto

O portal tem duas camadas de medição de leitura, construídas em momentos
diferentes e por caminhos diferentes:

- **`src/lib/observe/`** — nativa, 980 linhas, escrita junto com o Gap Mining.
- **`src/lib/integrations/do11y/`** — integração com um serviço externo, 1.465
  linhas contando painel e documentação, gravando numa tabela do Supabase.

Elas aparecem em telas separadas: **Settings → Observability** é a nativa,
**Settings → Analytics** é o Do11y. As duas medem leitura de documentação, e
ninguém escreveu por que as duas existem.

## O que cada uma mede

| | Nativa | Do11y |
| --- | :-: | :-: |
| Visualizações por página | ✓ | ✓ |
| Sessões | ✓ | ✓ |
| Páginas mais lidas | ✓ | ✓ |
| Feedback de página | ✓ | ✓ |
| Eventos por dia | ✓ | ✓ |
| **Busca sem resultado** | ✓ | — |
| **Clique em resultado, refinamento, abandono** | ✓ | — |
| **Jornadas de navegação** | ✓ | — |
| **Lacunas comportamentais, com confiança e evidência** | ✓ | — |
| **Tempo de permanência (mediana)** | ✓ | — |
| **Origem do tráfego (referrer)** | — | ✓ |
| **Dispositivo** | — | ✓ |
| **Fatia de leitura vinda de plataformas de IA** | — | ✓ |
| **Profundidade de rolagem, visibilidade de seção** | — | ✓ |
| Alimenta o Gap Mining | ✓ | — |
| Alimenta o Health Score | ✓ | — |
| Funciona sem serviço externo | ✓ | — |

Duas observações que a tabela sozinha não dá.

**A nativa está ligada no pipeline; o Do11y não.** `src/lib/observe/service` é
importado por `src/lib/gaps/service.ts` e `src/lib/health/service.ts`. O Do11y é
importado por `Head.astro` (para injetar o script) e pelo seu próprio painel.
Nada consome os dados dele — eles existem para serem olhados.

**A nativa mede qualidade de resposta; o Do11y mede engajamento.** Busca sem
resultado, abandono e refinamento respondem *a pessoa encontrou o que
procurava?*. Visualizações e profundidade de rolagem respondem *a pessoa
passou tempo aqui?* — que para documentação é quase o contrário de uma boa
notícia.

## As quatro coisas que só o Do11y tem

**Origem do tráfego e dispositivo** não são lacunas: são recusas. A
[ADR-0011](0011-telemetria-sem-identidade.md) decidiu que o evento nativo **não
tem onde guardar** referrer nem user-agent — não é uma política aplicada na
consulta, é a forma do tipo. Adotá-las de volta por outra porta desfaz a decisão
sem revisá-la.

**Profundidade de rolagem** é uma lacuna real e de valor baixo. "Leu 80% da
página" não distingue quem entendeu de quem procurava e desistiu no fim.

**A fatia de leitura vinda de plataformas de IA** é a única coisa genuinamente
valiosa da lista — e é aqui que a análise vira algo além de uma tabela.

## O achado

O Do11y detecta leitura de IA **pelo referrer**. Isso captura uma pessoa que
clicou num link dentro do ChatGPT.

Não captura nada do que este portal construiu para agentes:

```text
llms.txt              ← agente lê, sem referrer, sem JavaScript
llms-full.txt         ← idem
/md/<página>          ← Markdown bruto, idem
Servidor MCP          ← nem passa por HTTP do portal
```

Nenhuma dessas superfícies executa JavaScript, então o beacon do Do11y nunca
dispara nelas. **Nada no portal as conta** — verificado: não há registro de
acesso em `src/pages/md/`, em `src/pages/llms*.ts` nem no MCP.

Ou seja: a métrica que justifica a integração mede a fatia menos interessante da
leitura por IA, e deixa de fora exatamente a fatia para a qual o portal tem uma
feature dedicada e um guia próprio.

E medir a fatia certa **não precisa do Do11y nem viola a ADR-0011**: contar
requisições a `/md/*`, `llms.txt` e às ferramentas do MCP é contagem por rota, do
lado do servidor. Sem referrer, sem user-agent, sem identidade, sem serviço
externo.

## Decisão proposta

**A observabilidade nativa cobre o que decide trabalho de documentação, e o
Do11y não acrescenta nada que o portal tenha decidido querer.**

Três consequências:

1. **Retirar a integração com o Do11y** — 1.465 linhas, uma tela, três rotas de
   API, um script de terceiros no `<head>` de toda página, e duas credenciais de
   Supabase para operar.
2. **Settings → Analytics deixa de existir**, e a observabilidade fica numa tela
   só. Hoje a tela de Analytics é o painel do Do11y: com a integração desligada —
   que é o padrão — ela é um formulário de configuração e nada mais.
3. **Medir leitura por agentes na origem certa**: contagem por rota das
   superfícies legíveis por máquina, alimentando a mesma camada nativa.

## Consequências

**O que melhora.** Uma resposta para "como a documentação está sendo usada", em
vez de duas telas que se contradizem em silêncio. Nenhum script de terceiros no
`<head>`. Nenhuma credencial de Supabase para rotacionar. E a leitura por agentes
passa a ser medida onde ela acontece.

**O que se perde.** Origem do tráfego, dispositivo e profundidade de rolagem —
as três coisas que a ADR-0011 já havia recusado, agora recusadas
explicitamente em vez de disponíveis por uma porta lateral.

Também se perde o dashboard hospedado: quem quisesse levar os eventos para uma
ferramenta de BI perde o caminho pronto. A camada nativa expõe `--json` nas
CLIs, que é o caminho de saída, e é menos conveniente.

**O risco.** Se a operação depende hoje dos números do Do11y, retirá-lo tira uma
série histórica. Vale confirmar se alguém a usa antes de agir — a integração vem
desligada por padrão, então é possível que nunca tenha sido ligada em produção.

## Alternativas consideradas

**Manter as duas.** É o estado atual, e o custo dele não é o código: é a segunda
resposta para a mesma pergunta. Duas telas de "como a documentação é usada" com
números diferentes é o padrão que a [ADR-0005](0005-camadas-derivadas.md)
rejeita em toda outra camada do portal.

**Retirar a nativa e ficar com o Do11y.** Descartado sem hesitar: o Gap Mining e
o Health Score consomem a nativa, e o Do11y não mede busca sem resultado, que é
o sinal mais forte de lacuna que o portal tem.

**Manter o Do11y só pela fatia de IA.** Foi a hipótese mais promissora até a
verificação acima. Ele mede a fatia errada.

**Absorver referrer e dispositivo na camada nativa** para fechar a diferença.
Descartado por contrariar a ADR-0011 — e essa decisão merece ser revista de
frente, com o seu próprio registro, se alguém quiser esses dados.
