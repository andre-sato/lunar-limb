# Integração com o Do11y

[Do11y](https://docservable.com/) é observabilidade de documentação: um script
sem dependências captura eventos de engajamento nas páginas (visualização,
rolagem, cópia de código, busca, feedback) e os grava numa tabela do Supabase.
O diferencial para este projeto é a detecção de **referrers de plataformas de
IA**, que permite comparar como agentes e pessoas usam a documentação.

A integração aparece em **Settings → Analytics**.

---

## 1. As duas metades

```text
  Portal publicado                        Dashboard
  ────────────────                        ─────────
  <head> carregador                       /settings/analytics
        ↓ busca config pública                  ↓
  script do Do11y (CDN)                   consulta pelo servidor
        ↓ insert (chave publishable)            ↓ select (service_role)
        └──────────→  Supabase: do11y_events  ←─┘
```

**Coleta** — o script roda no navegador do leitor e insere eventos usando a
chave *publishable*, cuja política de RLS só permite `insert`.

**Leitura** — o dashboard consulta o Supabase **pelo servidor**, com a chave
*service_role*, que ignora RLS. Essa chave nunca sai do servidor.

---

## 2. As duas chaves

A distinção é o ponto sensível da integração:

| Chave | Vai ao navegador? | Pode | Onde fica |
| --- | --- | --- | --- |
| publishable (anon) | **Sim**, por design | `insert` | HTML do portal |
| service_role | **Nunca** | `select` (ignora RLS) | só no servidor |

A separação está no **tipo**, não numa lembrança de filtrar campo:
`toClientConfig()` constrói o objeto do navegador a partir de campos
específicos e não tem acesso à `service_role`; `toAdminView()` a substitui por
um booleano e os quatro últimos caracteres. Há testes que serializam as duas
projeções e falham se a chave aparecer.

Consequência prática: a tela de administração **não devolve** a chave gravada.
O campo começa vazio e, em branco, preserva a atual.

---

## 3. Por que não a instalação oficial

O guia do Do11y para Starlight põe as credenciais no array `head` do
`astro.config.mjs`:

```js
head: [
  { tag: 'meta', attrs: { name: 'do11y-url', content: 'SUPABASE_PROJECT_URL' } },
  { tag: 'meta', attrs: { name: 'do11y-key', content: 'SUPABASE_PUBLISHABLE_KEY' } },
  { tag: 'meta', attrs: { name: 'do11y-framework', content: 'starlight' } },
  { tag: 'script', attrs: { src: 'https://cdn.jsdelivr.net/npm/@manototh/do11y@latest/dist/do11y.min.js' } },
]
```

Isso é **build time**. Como o requisito é administrar a integração pela tela de
Settings, trocar uma chave passaria a exigir rebuild e redeploy do portal.

O que vai embutido em `src/components/Head.astro` é apenas um carregador que:

1. busca `/api/integrations/do11y/client-config`;
2. define `window.Do11yConfig`;
3. injeta o script do CDN.

A injeção usa `createElement`/`appendChild` porque **script inserido via
`innerHTML` não é executado** pelo navegador.

Três detalhes de comportamento:

- roda depois do evento `load`, para a medição não competir por banda com o
  conteúdo;
- checa `doNotTrack` antes de qualquer requisição;
- qualquer falha é engolida — analytics indisponível não pode quebrar a
  documentação.

O override do `Head` só se aplica a páginas da Starlight, então o editor e o
dashboard ficam fora da medição. O que se quer medir é a documentação, não o
trabalho de quem a escreve.

---

## 4. Configuração

Em **Settings → Analytics → Configurar integração**. Antes, crie a tabela no
Supabase (o SQL está na própria tela):

```sql
create table do11y_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  payload jsonb not null
);

alter table do11y_events enable row level security;
grant insert on do11y_events to anon;
grant select on do11y_events to service_role;

create policy "Allow anonymous inserts"
  on do11y_events for insert
  to anon
  with check (true);
```

A configuração fica em `data/integrations.json`, junto do resto da identidade —
**ignorado pelo Git**, porque contém a `service_role`.

Variáveis de ambiente têm precedência, para provisionar um deploy sem depender
de alguém abrir a tela depois:

```bash
DO11Y_ENABLED=true
DO11Y_SUPABASE_URL=https://abc123.supabase.co
DO11Y_SUPABASE_KEY=sb_publishable_...
DO11Y_SERVICE_ROLE_KEY=sb_secret_...
DO11Y_TABLE=do11y_events
```

Quando alguma delas está definida, a tela avisa que o que for salvo ali não terá
efeito.

---

## 5. O formato dos eventos

O payload segue convenções do OpenTelemetry, com chaves **planas e pontuadas**
— não são objetos aninhados:

```js
payload['url.path']                          // '/guides/authentication'
payload['browser.do11y.referrer_category']   // 'ai'
```

Chaves usadas pelo dashboard:

| Chave | Conteúdo |
| --- | --- |
| `eventName` | `browser.do11y.page_view`, `…scroll_depth`, … |
| `url.path` | caminho da página |
| `session.id` | identificador da sessão |
| `browser.do11y.page_title` | título |
| `browser.do11y.referrer_category` | `ai`, `search-engine`, `social`, `community`, `code-host`, `direct`, `internal`, `other`, `unknown` |
| `browser.do11y.ai_platform` | `ChatGPT`, `Claude`, `Perplexity`, `Gemini`, … (só quando a categoria é `ai`) |
| `device.type` | tipo de dispositivo |

---

## 6. A agregação

`aggregate()` é uma função pura sobre as linhas, testável sem Supabase, sem
rede e sem mock de HTTP.

A decisão que mais afeta os números: **origem, dispositivo e plataforma de IA
são contados uma vez por sessão**, não por evento. Contar por evento faria uma
sessão com 40 eventos pesar 40 vezes na distribuição — e sessões vindas de IA,
que costumam percorrer mais páginas, apareceriam infladas justamente na métrica
que a ferramenta existe para medir.

Como as linhas chegam em ordem decrescente de data, a última escrita por sessão
corresponde ao evento mais antigo dela: a origem de entrada, que é a correta.

Um evento posterior que não repita o atributo não apaga o que já se sabe da
sessão — `scroll_depth`, por exemplo, costuma não carregar o referrer.

### Limite de linhas

A agregação acontece em memória, com teto de 20 000 linhas por consulta. Ao
atingi-lo, os números viram uma amostra do período mais recente e a interface
**diz isso**, em vez de apresentar um total incorreto como se fosse completo.

Para volumes maiores, o caminho é agregar no banco (uma view ou função SQL) e
trocar a implementação de `loadMetrics`; a interface não muda.

---

## 7. Autorização

Duas capacidades novas, ambas só de admin na configuração inicial:

| Rota | Exige |
| --- | --- |
| `GET /api/integrations/do11y/client-config` | — (pública) |
| `GET /api/admin/analytics/do11y` | `settings.access` + `analytics.read` |
| `GET/PUT/POST /api/admin/integrations/do11y` | `settings.access` + `integrations.manage` |

A rota pública é pública de propósito: as páginas de documentação são estáticas
e anônimas, e o carregador precisa buscá-la. O que ela devolve é exatamente o
que já apareceria no HTML na instalação oficial.

Separar `analytics.read` de `integrations.manage` deixa possível, sem tocar no
mecanismo, um papel futuro que veja as métricas sem poder mexer nas
credenciais.

---

## 8. Limites conhecidos

- **Sem retenção nem expurgo**: quem apaga eventos antigos é o Supabase, não o
  portal.
- **Sem "quantos leram até o fim"**: `scroll_depth` e `section_visible` são
  coletados, mas o dashboard ainda os mostra só na distribuição por tipo de
  evento.
- **Sem comparação entre períodos** ("+12% vs. semana anterior").
- **Consultas não são cacheadas**: cada carregamento da tela consulta o
  Supabase.
- **A versão do script no CDN é `latest` por padrão** — cômodo para receber
  correções, mas significa que uma mudança no pacote chega sem aviso. Fixe uma
  versão se isso importar.
