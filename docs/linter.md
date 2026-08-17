# Documentation Linter e Quality Score

Revisor editorial automatizado para a documentação. Analisa cada página,
aponta problemas com id estável e calcula uma nota de 0 a 10.

O princípio que orienta o desenho:

> O linter deve ajudar a melhorar a documentação, não apenas a deixá-la
> diferente.

Isso tem uma consequência prática: **falso positivo é bug**. Uma regra que
acusa texto correto treina o autor a ignorar o painel, e aí ela custou mais do
que entregou.

---

## 1. Arquitetura

Três responsabilidades, em módulos separados (§82):

```text
  Markdown/MDX
        │
        ▼
  parse.ts          entende o documento, não julga nada
        │
        ▼
  rules/            identificam problemas → findings
        │
        ▼
  score.ts          transforma findings em nota
        │
   ┌────┴─────┐
   ▼          ▼
  editor    dashboard / CLI
```

O parser não conhece regras. As regras não sabem calcular nota. O motor de
score não sabe de onde vieram os findings — ele recebe categoria, severidade e
peso.

| Arquivo | Papel |
| --- | --- |
| `lib/linter/parse.ts` | AST, posições, frases, parágrafos, código, links |
| `lib/linter/rules/` | as regras, agrupadas por assunto |
| `lib/linter/score.ts` | categorias, pesos, penalidades, faixas |
| `lib/linter/config.ts` | style guide em YAML, profiles |
| `lib/linter/directives.ts` | supressão por linha, bloco e frontmatter |
| `lib/linter/lint.ts` | orquestração e agregação de workspace |

---

## 2. O mapeamento de posição

É a parte que mais dá errado num linter e a que menos aparece.

Regras de frase trabalham sobre texto concatenado — um parágrafo pode ter
várias linhas, com ênfase, links e código no meio. Para o marcador cair na
linha certa do Monaco, cada caractere do buffer carrega sua posição real no
arquivo.

Três decisões que vieram de falsos positivos encontrados na calibração:

**Separador entre nós inline só entra quando existe vão no arquivo.** Concatenar
com espaço sempre transformava `**negrito**.` em `negrito .` — e as regras de
espaçamento acusavam 257 problemas inexistentes no conteúdo real.

**Código inline entra como espaço.** Ele ocupa lugar na frase, mas não é prosa:
sem isso, `` `api-essentials` `` era acusado de grafar "API" errado, e um
identificador virava erro de terminologia.

**Regras de formatação leem as linhas cruas, não o buffer.** Espaço duplicado e
espaço antes de pontuação são propriedades do arquivo. Medi-las num texto
reconstruído é medir a reconstrução.

---

## 3. Categorias e pesos

```text
score = grammar·0,15 + clarity·0,15 + conciseness·0,10
      + structure·0,15 + technicalWriting·0,15 + consistency·0,10
      + actionability·0,10 + terminology·0,05 + readability·0,05
      − penalidade global (teto de 3,0)
```

`Preparo para IA` é calculado e exibido **à parte**, para não distorcer a
avaliação editorial (§46). `Completude` não tem fatia própria: TODOs e seções
vazias são erros graves e entram pelo peso das penalidades.

### Por que não é `10 − nº de erros`

A §83 proíbe explicitamente essa conta, e o desenho tem três propriedades que a
evitam:

**Multidimensional.** Uma página sem erro de gramática, mas com estrutura ruim e
instruções vagas, perde nas categorias correspondentes. Há teste comparando
exatamente esses dois perfis.

**Por densidade, não por contagem.** Três problemas em 200 palavras são piores
do que três em 2000. Sem normalizar, páginas longas seriam punidas por serem
longas — e o autor aprenderia a escrever menos.

**Peso por impacto (§49).** Link quebrado pesa 2,0; a palavra "simplesmente"
pesa 0,5. A severidade multiplica: erro ×1, aviso ×0,5, sugestão ×0,2, info ×0.

### Calibração

Contra o conteúdo real do projeto: **8,9 a 10,0**, média 9,7. Um documento
escrito de propósito com linguagem promocional, TODO, título duplicado, imagem
sem alt e link sem destino: **4,8 — Crítico**.

---

## 4. Regras

Todo id é estável, o que permite silenciar, reconfigurar e acompanhar a
evolução sem depender do texto da mensagem.

### Gramática e ortografia

| Id | O que detecta | Padrão |
| --- | --- | --- |
| `GRAMMAR-001` | Palavra repetida em sequência | aviso |
| `GRAMMAR-002` | Espaços duplicados | sugestão |
| `GRAMMAR-003` | Espaço antes de pontuação | sugestão |
| `GRAMMAR-004` | Frase iniciada em minúscula | aviso |

### Clareza

| Id | O que detecta | Padrão |
| --- | --- | --- |
| `CLARITY-001` | Frase acima do limite de palavras | sugestão |
| `CLARITY-002` | Referência ambígua abrindo parágrafo | aviso |
| `CLARITY-003` | Voz passiva | sugestão |
| `CLARITY-004` | Proporção alta de frases longas no documento | info |
| `LINK-001` | Texto de link sem valor descritivo | aviso |
| `LINK-002` | URL exposta como texto do link | sugestão |

### Concisão

| Id | O que detecta | Padrão |
| --- | --- | --- |
| `CONCISENESS-001` | Construção prolixa com equivalente curto | sugestão |

### Estrutura

| Id | O que detecta | Padrão |
| --- | --- | --- |
| `STRUCTURE-001` | Hierarquia de títulos pulando nível | erro |
| `STRUCTURE-002` | Títulos duplicados | aviso |
| `STRUCTURE-003` | Título longo demais | sugestão |
| `STRUCTURE-004` | Título genérico | sugestão |
| `STRUCTURE-005` | Página sem `title` no frontmatter | erro |
| `STRUCTURE-006` | Seção esperada ausente para o tipo de página | aviso |
| `STRUCTURE-007` | Tabela numerada que caberia como lista | sugestão |
| `STRUCTURE-008` | Cabeçalho de tabela vazio | aviso |
| `IMAGE-001` | Imagem sem texto alternativo | erro |
| `IMAGE-002` | Alt genérico ou igual ao nome do arquivo | aviso |

### Technical writing

| Id | O que detecta | Padrão |
| --- | --- | --- |
| `STYLE-001` | Termo proibido pelo style guide | sugestão |
| `TECH-001` | Termo vago, sem informação verificável | sugestão |
| `TECH-MKT-001` | Linguagem promocional | aviso |
| `TECH-ACT-001` | Instrução indireta onde cabe o imperativo | sugestão |
| `TECH-ACCURACY-001` | Afirmação absoluta que merece verificação | aviso |
| `CODE-001` | Bloco de código sem linguagem | aviso |

### Consistência e terminologia

| Id | O que detecta | Padrão |
| --- | --- | --- |
| `CONSISTENCY-001` | Mesma expressão com grafias diferentes | aviso |
| `LINK-003` | Mesmo destino com textos diferentes | info |
| `TERM-001` | Acrônimo sem definição | aviso |
| `TERM-002` | Variante em lugar do termo preferido | aviso |

### Acionabilidade

| Id | O que detecta | Padrão |
| --- | --- | --- |
| `ACTION-001` | Página procedural sem exemplo | aviso |
| `ACTION-002` | Passos escritos como substantivo | sugestão |
| `ACTION-003` | Instrução sem detalhamento | aviso |
| `CODE-003` | Bloco de código sem explicação | sugestão |

### Legibilidade

| Id | O que detecta | Padrão |
| --- | --- | --- |
| `READABILITY-001` | Parágrafo longo demais | sugestão |
| `READABILITY-002` | Métrica de facilidade de leitura | info |

### Completude

| Id | O que detecta | Padrão |
| --- | --- | --- |
| `COMPLETENESS-001` | TODO, FIXME, TBD, WIP, "em breve" | erro |
| `COMPLETENESS-002` | Seção sem conteúdo | erro |
| `COMPLETENESS-003` | Placeholder genérico (`foo`, `bar`) no exemplo | aviso |
| `CODE-002` | Bloco de código vazio | erro |
| `LINK-004` | Link sem destino | erro |

### Preparo para IA

| Id | O que detecta | Padrão |
| --- | --- | --- |
| `AI-001` | Documento longo sem títulos | sugestão |
| `AI-002` | Referência a contexto fora da página | sugestão |
| `AI-003` | Página sem `description` no frontmatter | sugestão |

---

## 5. Idiomas

O portal é nativamente pt-BR, com traduções em `en` e `es`. Um linter só com
regras em inglês não apontaria nada de útil no conteúdo real — por isso as
listas de termos existem nos três idiomas, e o idioma é inferido do caminho
(`en/…`, `es/…`) ou do frontmatter.

A legibilidade usa a fórmula adequada a cada língua: Flesch para inglês, a
adaptação de Martins et al. para português, Fernández Huerta para espanhol.
Aplicar a fórmula inglesa ao português subestima a legibilidade de forma
sistemática.

---

## 6. Configuração

`styles/default.yaml`, versionado em Git. Mudar uma regra é um commit
revisável, não uma configuração escondida.

```yaml
linter:
  thresholds:
    maxSentenceWords: 35
    maxParagraphWords: 120
  qualityGate:
    enabled: true
    minimumScore: 8.0
    failOnErrors: true
  forbiddenTerms:
    pt-BR: [simplesmente, obviamente]
    en: [simply, just]
  terminology:
    preferred:
      - term: chave de API
        alternatives: [API key, chave da API]
  acronyms:
    SSO: Single Sign-On
  rules:
    CLARITY-003:
      severity: suggestion
      weight: 0.3
```

Profiles adicionais ficam no mesmo diretório e herdam com `extends: default`.
Uma página escolhe o seu:

```yaml
---
lint:
  profile: api-docs
---
```

---

## 7. Silenciar regras

A §61 trata falso positivo como preocupação de primeira classe. Três níveis, e
todo silenciamento é **registrado** no resultado — uma regra sistematicamente
ignorada fica visível para ser revista, em vez de desaparecer.

```markdown
<!-- lint-disable-next-line STYLE-001 -->
Este texto é promocional de propósito.

<!-- lint-disable TECH-MKT-001 -->
...
<!-- lint-enable TECH-MKT-001 -->
```

```yaml
---
lint:
  ignore: [STYLE-001, READABILITY-001]
---
```

Diretiva sem id silencia todas as regras. Bloco aberto sem `lint-enable` vale
até o fim do arquivo.

---

## 8. No editor

O painel abaixo do editor mostra a nota, a contagem por severidade e a lista de
problemas. Clicar na nota abre o detalhamento por dimensão; clicar num problema
leva o cursor à linha.

Os findings também aparecem sublinhados no Monaco, num *owner* próprio
(`linter`), separado do erro de renderização — assim um não apaga o outro.

**Correção rápida** aparece só quando é mecânica: trocar uma palavra, remover
espaço duplicado, aplicar o termo preferido. Sugestões subjetivas ("prefira a
voz ativa") não têm botão, porque a §43 pede para não alterar o texto
automaticamente nesses casos.

A análise roda com atraso de 1,2 s após a digitação parar (§65). O autor
continua editando enquanto ela roda, e resultado que chega fora de ordem é
descartado.

---

## 9. CLI e CI

```bash
npm run docs:lint                    # toda a documentação
npm run docs:lint -- --changed       # só o que mudou, mais os consumidores
npm run docs:lint -- --json          # saída para máquina
npm run docs:lint -- --path guides/authentication.mdx
npm run docs:lint -- --min-score 9
```

Códigos de saída (§74): `0` aprovado, `1` quality gate reprovado,
`2` erro de configuração, `3` erro de execução.

`--changed` se apoia no Content Graph: alterar `authentication-warning.md` muda
o texto renderizado de toda página que o inclui, então as consumidoras entram na
análise junto (§76, §77).

---

## 10. Dashboard

**Settings → Quality** mostra nota média, média por dimensão, problemas mais
frequentes e a lista de páginas ordenada por nota. É o que transforma o linter
em governança de documentação, e não num corretor página a página.

Exige `settings.access` + `analytics.read`.

---

## 11. O que o linter não faz

- **Não valida verdade técnica.** A §2 e a §32 são explícitas: ele sinaliza
  afirmações absolutas para revisão, mas nunca declara que uma informação está
  errada. A precisão continua sendo responsabilidade humana.
- **Sem linter semântico (LLM).** Fase 4 do roadmap. A estrutura está pronta —
  `LintFinding` já tem `confidence`, e a regra da §64 (confiança abaixo de 0,70
  não gera erro) tem onde ser aplicada.
- **Sem histórico nem tendência de nota.** Fase 5.
- **Sem comentário automático em pull request.** Fase 5; a §75 já a coloca fora
  da primeira entrega.
- **Sem detecção de conteúdo duplicado entre páginas** (§35): o Content Graph
  vê referências explícitas, não semelhança de texto.
- **Ortografia não é dicionário.** As regras de gramática são estruturais
  (repetição, espaçamento, capitalização); não há verificação palavra a palavra
  contra um léxico.
- **O dashboard analisa tudo a cada visita**, sem cache. Adequado a um portal;
  com milhares de páginas, precisaria de índice.
