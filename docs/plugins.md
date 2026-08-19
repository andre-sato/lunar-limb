# Plugins da comunidade Starlight

> Extraído do README quando cada feature ganhou o seu guia. O guia explica **como
> usar**; este documento explica **como funciona** e por que foi construído assim.

Os plugins da comunidade Starlight em uso, com o que cada um resolve.

Detalhes em **[Plugins da comunidade](/guides/plugins/)**.

### O plugin avaliado antes

`@simonhyll/starlight-glossary` foi examinado antes de escrever qualquer código,
como a spec exige. Está em `0.1.0-alpha`, publicado em junho de 2024, com 148
linhas no total: o schema de configuração é um objeto vazio, `libs/content.ts`
tem uma linha, e a rota do glossário devolve conteúdo fixo de exemplo
("Semver", "This is some content") em vez de ler termos.

Não há matcher, tooltip, aliases nem transformer de AST — ou seja, nenhum dos
requisitos obrigatórios da avaliação. Daí o transformer próprio.
