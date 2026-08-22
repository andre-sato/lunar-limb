---
type: Guide
title: Agentes de documentação
description: Agentes especializados que pesquisam, rascunham e validam — com guardrails em código, workspace isolado e aprovação humana obrigatória.
resource: https://docs.suaempresa.com/guides/agentes-de-documentacao/
tags:
  - guia
  - qualidade
  - portal
status: stable
generated:
  by: process:okf-export
  at: '2026-08-22T12:12:38.074Z'
sources:
  - id: repo
    resource: src/content/docs/guides/agentes-de-documentacao.mdx
    title: src/content/docs/guides/agentes-de-documentacao.mdx no repositório
    last_modified: '2026-08-22T00:41:25.381Z'
audiences:
  - developer
  - operations
owner:
  type: team
  id: documentation
---

O objetivo desta camada **não é criar outro chatbot**. Um agente genérico produz
"aqui está uma documentação sobre autenticação" e não garante nada: nem que a
implementação foi consultada, nem que a API está correta, nem que os exemplos
funcionam.

Aqui, agentes especializados usam as ferramentas que o portal já tem e produzem
mudanças **verificáveis** — cada afirmação com fonte, cada alteração passando pelo
linter, pelos testes e pela auditoria antes de virar um pull request que uma
pessoa aprova.

```bash
npm run agent -- run --task "Documente a rotação de chaves"
npm run agent -- review <id>     # o diff e a validação
npm run agent -- logs <id>       # fontes, ferramentas, decisões
npm run agent -- approve <id>
```

## Nada é publicado automaticamente

Mesmo com todos os testes verdes. **Aprovar não publica**: o conteúdo continua no
workspace isolado até alguém aplicá-lo, e as duas ações são separadas de
propósito. Juntá-las transformaria "aprovar" e "publicar" no mesmo clique.

## Os cinco agentes

| Agente | O que faz | Precisa de modelo? |
| --- | --- | --- |
| **Pesquisa** | descobre fatos no Twin, no código, nas especificações, no glossário e no Git | não |
| **Redação** | escreve no workspace, a partir das evidências | opcional |
| **Revisão** | linter, precisão técnica, afirmações sem lastro | não |
| **Testes** | Documentation Tests e Contract Tests, no escopo do impacto | não |
| **Auditoria** | proveniência, fontes, afirmações sem suporte | não |

**Quatro dos cinco funcionam sem provedor nenhum.** Sem chave, o Writer não
inventa prosa: ele produz um rascunho estruturado com o que se sabe, de onde veio
e onde falta escrever. A execução segue por revisão, testes e auditoria
normalmente e para na aprovação — com um rascunho honesto em vez de texto
plausível.

## O que faz a execução parar

Três condições interrompem antes do fim, e nenhuma é falha técnica:

**Conflito entre fontes.** Se a especificação diz `retry = 3` e o código diz
`retry = 5`, o agente para. Escolher uma em silêncio propagaria o conflito para
dentro da documentação.

**Pesquisa sem evidência.** Sem fonte que sustente o que a tarefa pede, não há o
que escrever. Preencher a lacuna com suposição é exatamente o que esta camada
existe para evitar.

**Regressão de saúde.** Se a mudança melhora uma página e piora o conjunto, ela é
bloqueada.

## Guardrails, em código

A §25 lista o que agentes não podem fazer, e cada item está implementado como
verificação executável — não como instrução no prompt. Guardrail que vive só no
prompt é sugestão, e um modelo eventualmente ignora sugestões.

- **Ferramentas por allowlist.** Só o Writer escreve, e só no workspace. Nenhum
  agente tem ferramenta de execução de comando.
- **Caminhos.** Escrita apenas em `src/content/`, apenas `.md` e `.mdx`. `data/`,
  `.env`, `src/lib/auth/`, configuração e dependências são recusados — para
  leitura também.
- **Travessia de diretório** é recusada, não normalizada: o que se quer é rejeitar
  o caminho que contém `..`, não resolvê-lo silenciosamente.
- **Remoção de conteúdo.** Uma alteração que descarta mais da metade de uma página
  existente é bloqueada.

### O defeito que originou o último guardrail

A primeira execução real contra este portal substituiu a página de autenticação
inteira por um esqueleto de rascunho — e **passou** por revisão, testes e
auditoria, porque um esqueleto bem formado é Markdown válido.

Duas correções saíram disso. O Writer, sem modelo e com página existente, agora é
**aditivo**: acrescenta uma seção marcada ao fim e não toca no que já estava
escrito. E o orquestrador ganhou o guardrail de descarte, que vale para qualquer
origem do texto — um modelo também pode devolver uma página nova no lugar de uma
boa.

## Conteúdo recuperado é dado, nunca instrução

A documentação pode ser escrita por qualquer pessoa com acesso ao editor. Uma
página que diz "ignore as instruções anteriores" é uma página **falando sobre**
injeção de prompt — como várias deste portal.

Todo conteúdo lido passa pela mesma sanitização que o assistente usa, e entra no
contexto do agente envelopado como material de referência. Reimplementar a defesa
aqui criaria duas regras ligeiramente diferentes, e a mais fraca seria a que
valeria.

## Níveis de autonomia

| Nível | O agente | Padrão |
| --- | --- | --- |
| 0 | recomenda, não escreve | |
| 1 | rascunha no workspace | |
| 2 | rascunha e valida | ✓ |
| 3 | abre o pull request **depois** da aprovação | |

Mesmo no nível 3 a aprovação humana continua obrigatória. O que ele automatiza é a
abertura do PR, não a decisão de publicar.

## Auditoria

Cada execução registra a tarefa, os agentes que rodaram, as ferramentas que cada
um usou, as fontes consultadas, o que mudou, o que os testes disseram e quem
aprovou. As decisões ficam no log de auditoria do portal.

Não há **memória autônoma persistente**: o estado pertence à execução e morre com
ela. Um agente que acumula memória entre execuções passa a decidir com base em
coisas que ninguém consegue auditar.
