/**
 * Sintaxe da anotação de proveniência (§5).
 *
 * A spec pede uma sintaxe "compatível com Markdown/MDX" e diz para não guardar a
 * proveniência só em banco. Comentário HTML atende às duas coisas: some da página
 * renderizada, sobrevive em `.md` e em `.mdx`, e é versionado pelo Git junto do
 * texto que sustenta — que é o ponto. Proveniência em banco separado divergiria do
 * conteúdo no primeiro `git revert`, e divergindo ela deixa de ser evidência.
 *
 *     <!-- provenance:
 *     source: openapi#/paths/~1auth~1me/get
 *     verifiedAt: 2026-08-18
 *     verifiedBy: Time de Plataforma
 *     -->
 *     Toda requisição autenticada precisa de uma chave de API.
 *
 * Duas granularidades. A anotação acima é da **afirmação**: vale para o parágrafo
 * seguinte. No frontmatter, é da **página**:
 *
 *     provenance:
 *       - source: src/lib/auth/session.ts:42
 *       - source: manual:Time de Plataforma
 *     owner: Time de Plataforma
 *
 * Tudo aqui é puro: recebe o texto do arquivo e devolve estrutura.
 */

import type { Claim, Provenance, SourceType } from './types';

/**
 * Duas formas de comentário, porque `.md` e `.mdx` não são a mesma linguagem.
 *
 * Em Markdown, `<!-- ... -->` é comentário. Em MDX **não é**: o compilador tenta
 * ler aquilo como JSX e o build falha — foi exatamente o que aconteceu na
 * primeira tentativa deste arquivo, com a página de guia em `.mdx`. Lá a forma é
 * `{/* ... *\/}`, que é comentário de JavaScript dentro de expressão JSX.
 *
 * Aceitar as duas é o que permite anotar qualquer página do portal sem que quem
 * escreve precise saber por que a sintaxe muda.
 */
const ANNOTATION = /(?:<!--|\{\s*\/\*)\s*provenance:\s*([\s\S]*?)(?:-->|\*\/\s*\})/g;

/**
 * Deduz o tipo da fonte pela forma da referência.
 *
 * Pedir o tipo explicitamente seria mais seguro e menos usado: quem escreve
 * documentação não vai lembrar de declarar `sourceType: openapi` ao lado de um
 * caminho que já diz `openapi.yaml#/...`. O prefixo explícito continua aceito
 * (`code:`, `test:`, `manual:`) para os casos ambíguos.
 */
export function inferSourceType(source: string): SourceType {
	const explicit = source.match(/^(code|openapi|asyncapi|test|manual|generated):/i);
	if (explicit) return explicit[1].toLowerCase() as SourceType;

	if (/asyncapi[^#]*#/i.test(source)) return 'asyncapi';
	if (/\.(ya?ml|json)#/.test(source)) return 'openapi';
	// Identificador de teste: maiúsculas, hífen e número — `DOC-LINK-001`.
	if (/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/.test(source.trim())) return 'test';
	if (/\.[jt]sx?(?::\d+)?$|\.(py|astro|mjs|cjs)(?::\d+)?$/.test(source)) return 'code';
	if (/^gerado (?:de|a partir)|^generated from/i.test(source)) return 'generated';

	return 'manual';
}

/** Remove o prefixo explícito de tipo, deixando só a referência. */
export function stripSourcePrefix(source: string): string {
	return source.replace(/^(code|openapi|asyncapi|test|manual|generated):\s*/i, '').trim();
}

function parseBlock(raw: string): Provenance[] {
	const entries: Provenance[] = [];
	let current: Partial<Provenance> | null = null;

	const flush = () => {
		if (current?.source) {
			entries.push({
				sourceType: current.sourceType ?? inferSourceType(current.source),
				source: stripSourcePrefix(current.source),
				verifiedAt: current.verifiedAt,
				verifiedBy: current.verifiedBy,
				owner: current.owner,
				freshnessDays: current.freshnessDays,
			});
		}
		current = null;
	};

	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim().replace(/^-\s*/, (match) => (match ? '' : ''));
		if (trimmed === '') continue;

		const match = line.trim().match(/^-?\s*([A-Za-z]+)\s*:\s*(.*)$/);
		if (!match) continue;

		const key = match[1].toLowerCase();
		const value = match[2].trim();

		// Uma nova chave `source` começa uma nova evidência: é assim que a mesma
		// afirmação declara duas fontes sem precisar de sintaxe de lista.
		if (key === 'source') {
			flush();
			current = { source: value };
			continue;
		}

		if (!current) continue;

		if (key === 'sourcetype' || key === 'type') current.sourceType = value.toLowerCase() as SourceType;
		else if (key === 'verifiedat') current.verifiedAt = value;
		else if (key === 'verifiedby') current.verifiedBy = value;
		else if (key === 'owner') current.owner = value;
		else if (key === 'freshnessdays') {
			const days = Number.parseInt(value, 10);
			if (Number.isFinite(days)) current.freshnessDays = days;
		}
	}

	flush();
	return entries;
}

/** O parágrafo que vem depois da anotação — a afirmação que ela sustenta. */
function claimTextAfter(body: string, endIndex: number): string | undefined {
	const rest = body.slice(endIndex);
	const paragraph = rest
		.split(/\r?\n\s*\r?\n/)
		.map((block) => block.trim())
		.find((block) => block !== '' && !block.startsWith('<!--'));

	if (!paragraph) return undefined;
	// Uma frase basta para reconhecer a afirmação no relatório; o texto completo
	// já está na página, e copiá-lo inteiro só duplicaria conteúdo.
	return paragraph.replace(/\s+/g, ' ').slice(0, 240);
}

/**
 * O bloco indentado sob uma chave do frontmatter.
 *
 * Feito por linha, e não por expressão regular com lookahead até o fim do texto:
 * JavaScript não tem `\Z`, e a versão anterior disto falhava calada quando o
 * bloco era o **último** do frontmatter — que é justamente onde ele costuma estar.
 */
function frontmatterSection(raw: string, key: string): string {
	const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!frontmatter) return '';

	const lines = frontmatter[1].split(/\r?\n/);
	const start = lines.findIndex((line) => new RegExp(`^${key}:\\s*$`).test(line));
	if (start === -1) return '';

	const collected: string[] = [];
	for (const line of lines.slice(start + 1)) {
		if (line.trim() === '') continue;
		// Linha sem indentação encerra o bloco: é a próxima chave.
		if (!/^\s/.test(line)) break;
		collected.push(line);
	}

	return collected.join('\n');
}

/**
 * Responsável declarado no frontmatter.
 *
 * Ele **não** vira afirmação. Dizer quem responde pela página é informação de
 * contato, não evidência — e tratá-lo como afirmação sem data fazia toda página
 * com `owner:` aparecer como "não verificada", inclusive as que tinham evidência
 * boa. O selo passava a punir quem tinha se dado o trabalho de dizer quem responde.
 */
export function parsePageOwner(raw: string): string | undefined {
	const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	return frontmatter?.[1].match(/^owner:\s*(.+)$/m)?.[1]?.trim();
}

/**
 * Substitui o conteúdo dos blocos de código por espaço, preservando as linhas.
 *
 * Preservar a contagem de linhas importa: o número que vai para o relatório é o
 * do arquivo, e apagar as cercas de fato deslocaria toda anotação posterior.
 */
function blankCodeFences(raw: string): string {
	const lines = raw.split('\n');
	let fence: string | null = null;

	return lines
		.map((line) => {
			const marker = line.match(/^\s*(`{3,}|~{3,})/);

			if (fence) {
				const closing = marker && marker[1][0] === fence[0] && marker[1].length >= fence.length;
				if (closing) fence = null;
				return '';
			}

			if (marker) {
				fence = marker[1];
				return '';
			}

			return line;
		})
		.join('\n');
}

/**
 * Anotações de proveniência de um arquivo de conteúdo.
 *
 * O frontmatter entra como uma "afirmação" da página inteira, na linha 1 — é o
 * caso mais comum, e exigir anotação por parágrafo desde o começo faria a camada
 * nunca sair do papel.
 */
export function parseProvenance(path: string, raw: string): Claim[] {
	const claims: Claim[] = [];

	const pageEntries = parseBlock(frontmatterSection(raw, 'provenance'));
	if (pageEntries.length > 0) {
		const owner = parsePageOwner(raw);
		claims.push({ path, line: 1, provenance: pageEntries.map((entry) => ({ ...entry, owner: entry.owner ?? owner })) });
	}

	// Anotação dentro de bloco de código é **exemplo**, não declaração. A página
	// que ensina esta sintaxe mostra `source: portal-api.yaml#/paths` de propósito;
	// lê-la como afirmação real fazia o guia de proveniência aparecer no painel de
	// saúde como P0, acusado de citar evidência inexistente. O caso foi encontrado
	// assim, rodando o coletor contra o portal.
	const scannable = blankCodeFences(raw);

	for (const match of scannable.matchAll(ANNOTATION)) {
		const entries = parseBlock(match[1]);
		if (entries.length === 0) continue;

		const before = scannable.slice(0, match.index ?? 0);
		claims.push({
			path,
			line: before.split('\n').length,
			text: claimTextAfter(scannable, (match.index ?? 0) + match[0].length),
			provenance: entries,
		});
	}

	return claims;
}
