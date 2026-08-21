# Architectural Decision Records

Uma ADR registra **uma decisão**, o contexto em que ela foi tomada e o que ela
custou. Ela não é documentação do sistema — para isso existe
[docs/arquitetura.md](../arquitetura.md), com os diagramas C4.

A diferença importa na prática: a documentação descreve como o sistema é hoje e
muda quando ele muda; uma ADR descreve por que ele ficou assim e **não muda
nunca**. Quando a decisão é revista, a ADR antiga é marcada como substituída e
uma nova é escrita. Reescrever a antiga apagaria a informação mais valiosa do
conjunto: que alguém já pensou nisso, com aqueles dados, e concluiu diferente.

## Índice

| # | Decisão | Status |
| --- | --- | --- |
| [0001](0001-astro-e-starlight.md) | Astro e Starlight como base do portal | Aceita |
| [0002](0002-git-como-fonte-de-verdade.md) | Git é a única fonte de verdade do conteúdo | Aceita |
| [0003](0003-renderizacao-hibrida.md) | Estático por padrão, servidor onde é preciso | Aceita |
| [0004](0004-uma-leitura-do-openapi.md) | Uma leitura do OpenAPI, muitos consumidores | Aceita |
| [0005](0005-camadas-derivadas.md) | Camadas derivadas nunca são fonte de verdade | Aceita |
| [0006](0006-autorizacao-por-capacidade.md) | Autorização por capacidade, num middleware só | Aceita |
| [0007](0007-estado-operacional-fora-do-git.md) | Estado operacional fora do Git | Aceita |
| [0008](0008-nao-medido-nunca-e-zero.md) | Não medido é `null`, nunca zero | Aceita |
| [0009](0009-vinculo-no-frontmatter.md) | O vínculo com o produto vive no frontmatter | Aceita |
| [0010](0010-guardrails-por-construcao.md) | Guardrails de agente por construção | Aceita |
| [0011](0011-telemetria-sem-identidade.md) | Telemetria de leitura sem identidade | Aceita |
| [0012](0012-portoes-que-bloqueiam-pouco.md) | Portões de CI bloqueiam pouco, de propósito | Aceita |
| [0013](0013-avaliacao-mede-o-verificavel.md) | A avaliação de IA mede só o verificável | Aceita |
| [0014](0014-sdk-com-renderer-plugavel.md) | SDK com modelo intermediário e renderer plugável | Aceita |
| [0015](0015-diagramas-como-svg-versionado.md) | Diagramas como SVG versionado, não imagem | Aceita |
| [0016](0016-degradacao-em-vez-de-dependencia.md) | Degradar em vez de depender | Aceita |
| [0017](0017-overlay-antes-do-apimodel.md) | Overlay é transformação antes do `ApiModel` | Aceita |
| [0018](0018-alvo-sem-correspondencia.md) | Alvo sem correspondência bloqueia, e JSONPath é subconjunto declarado | Aceita |

## Formato

Cada ADR tem cinco partes:

- **Contexto** — a situação e a força que empurrou para uma decisão.
- **Decisão** — o que foi decidido, no presente e na voz ativa.
- **Consequências** — o que melhorou, o que piorou, e o que passou a ser
  possível. A seção só está honesta quando tem custo escrito nela.
- **Alternativas consideradas** — o que foi descartado e por quê. Sem isto, a
  ADR não explica a decisão: ela a anuncia.
- **Evidência** — quando a decisão veio de um defeito observado, o defeito.

## Escrevendo uma nova

Copie o arquivo mais recente, incremente o número, e resista a duas tentações:

**Registrar tudo.** Uma ADR para cada escolha de biblioteca transforma o
diretório num changelog, e ninguém lê changelog para entender arquitetura.
Registre o que seria caro reverter ou o que alguém desfaria por engano sem saber
o motivo.

**Escrever depois de esquecer.** A parte que se perde primeiro é a alternativa
descartada — em duas semanas ela vira "acho que a gente tentou algo assim".
