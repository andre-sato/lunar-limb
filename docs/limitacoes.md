# Limitações conhecidas

O que o portal **não** faz hoje, e por quê. A lista existe para que um limite
seja encontrado antes de virar surpresa — e para separar o que foi decisão do
que é trabalho ainda não feito.

Cada camada também declara os seus limites no guia correspondente; aqui ficam
os que atravessam o produto.

- O preview de MDX não executa componentes Astro/Starlight reais (incluindo `<ContentBlock>`/`<IncludePage>` fora do resolver dedicado) — mostra um placeholder com nome e props para componentes genéricos.
- Ainda não há scroll-sync entre editor e preview.
- Resolução de imagem relativa ao pré-visualizar um snippet aberto diretamente (fora de uma página) assume a pasta `content/docs`, então pode ficar imprecisa nesse caso específico.
- Referências quebradas e circulares aparecem no Problems panel e no Content Graph, mas ainda **não bloqueiam o build** em modo strict.
- Mover ou renomear um arquivo quebra as referências a ele (o `id` é o caminho sem extensão) — ainda não há um "rename refactor" que atualize os consumidores.
- O grafo só enxerga a sintaxe que o próprio editor gera (`<ContentBlock id="…" />` / `<IncludePage id="…" />`); referências escritas com props em outra ordem ou `id` vindo de expressão ficam de fora.
- `<If>` só funciona em `.mdx` (é JSX); em `.md` a tag vira texto literal.
- As variáveis são resolvidas em **build time** — mudar uma variável exige novo build para o site publicado refletir. No dev server, salvar variáveis recarrega a página do editor (o JSON é importado pelo build).
- `showIf` aceita uma variável só, com negação opcional; não há expressões booleanas compostas.
- A busca global varre o conteúdo a cada consulta, sem índice — adequado ao volume de um portal, não a dezenas de milhares de arquivos.
- Git awareness é somente leitura: nenhum commit, stage ou checkout parte do editor.
- A leitura da documentação é pública por decisão de produto: gatear as páginas exigiria desligar o prerender da Starlight, o que desativa a busca Pagefind. Conteúdo que não pode ser lido por qualquer um não deve estar no portal.
- Não há "esqueci minha senha" nem tela de perfil: a redefinição é feita por um admin em Settings → Users. `mustChangePassword` é devolvido no login, mas não há tela que force a troca antes de continuar.
- A busca conversacional devolve trechos, não respostas redigidas: quem sintetiza é o leitor. A relevância vem de BM25 sobre o mesmo índice do MCP Server, então ela acerta nome de campo, erro e comando melhor do que pergunta conceitual. As conversas ficam em memória, com TTL — reiniciar o servidor as descarta, e várias réplicas não as compartilham.
- Usuários e sessões ficam em JSON local, adequado a uma instalação; várias réplicas precisariam de um store compartilhado. O limitador de tentativas de login também é por processo.
