/**
 * Changelog automático — modelo (issue #15).
 *
 * A decisão que decide o resto: **o changelog não é o histórico do Git.** Ele é
 * um documento de gestão de mudança, escrito para quem integra com o produto, e
 * a maior parte dos commits de um mês não pertence a ele.
 *
 * Por isso o caminho é sempre `commits → filtro → tradução → documento`, e nunca
 * `commits → documento`. Publicar a lista de commits com formatação bonita
 * produz uma página que o leitor abre uma vez, não reconhece nada, e nunca mais
 * abre — que é pior que não ter changelog, porque consome a confiança dele.
 */

/** As três seções que a spec da issue fixa. */
export type Category = 'feature' | 'fix' | 'docs';

export const CATEGORY_LABEL: Record<Category, string> = {
	feature: '🚀 Novidades',
	fix: '🛠 Correções',
	docs: '📚 Documentação e ciclo de vida',
};

/** Um commit lido segundo a convenção Conventional Commits. */
export interface ConventionalCommit {
	/** `feat`, `fix`, `docs`, `chore`… em minúsculas. Vazio quando não segue a convenção. */
	type: string;
	/** O escopo entre parênteses, quando existe: `feat(pagamentos):`. */
	scope?: string;
	/** O texto depois dos dois-pontos. */
	description: string;
	body: string;
	/** `true` com `!` antes dos dois-pontos ou com rodapé `BREAKING CHANGE:`. */
	breaking: boolean;
	/** O texto que explica a quebra, quando declarado no rodapé. */
	breakingNote?: string;
	/** `true` quando a mensagem não segue a convenção. */
	unconventional: boolean;
}

/** Um item já classificado, pronto para virar linha do documento. */
export interface ChangelogEntry {
	commit: string;
	date: string;
	category: Category;
	/** O texto que vai para a página. Pode ter passado por enriquecimento. */
	text: string;
	/** O texto original do commit, guardado para revisão. */
	original: string;
	scope?: string;
	/**
	 * Produto afetado (issue #18), inferido do escopo do commit quando ele casa
	 * com um id declarado em `organization.yml`.
	 *
	 * Ausente significa "vale para o portal todo", e é o caso comum: a maioria
	 * dos commits não é de um produto só. O changelog continua sendo **um
	 * arquivo por mês** com todos os produtos — este campo agrupa dentro do mês,
	 * não divide em arquivos.
	 */
	product?: string;
	breaking: boolean;
	breakingNote?: string;
	pullRequest?: number;
	/** Endpoints citados e resolvidos contra a especificação. */
	endpoints: string[];
	/**
	 * Depreciação declarada no commit, com a data de fim de vida quando ela
	 * aparece. A spec exige que todo aviso traga a data — sem ela o item entra
	 * marcado como incompleto, em vez de sair sem o aviso.
	 */
	deprecation?: { subject: string; endOfLife?: string; migration?: string };
}

export interface ChangelogSection {
	category: Category;
	entries: ChangelogEntry[];
}

export interface MonthlyChangelog {
	/** `2026-08`. */
	period: string;
	/** Primeiro e último dia considerados, em ISO. */
	from: string;
	to: string;
	sections: ChangelogSection[];
	/** Commits lidos, antes de qualquer filtro. */
	considered: number;
	/** Descartados por serem ruído técnico. */
	filtered: number;
	/**
	 * Itens que precisam de alguém antes de publicar: depreciação sem data de
	 * fim de vida, quebra sem nota, endpoint citado que não existe na
	 * especificação. O documento sai mesmo assim, com o aviso — esconder a
	 * pendência publicaria um changelog que parece completo.
	 */
	warnings: string[];
	/** `true` quando o mês não teve nenhuma mudança de interesse do leitor. */
	empty: boolean;
}

export interface ChangelogConfig {
	/** Tipos de commit que nunca entram no documento. */
	noiseTypes: string[];
	/** Escopos que nunca entram, mesmo com tipo relevante. */
	noiseScopes: string[];
	/** Caminhos cuja alteração isolada não interessa ao leitor. */
	noisePaths: string[];
	/** Onde as páginas são escritas. */
	outputDir: string;
	/** Especificação usada para validar e linkar endpoints. */
	specification: string;
	/** Base dos links de referência da API. */
	apiReferenceBase: string;
	/** Enriquecer o texto com modelo de linguagem, quando houver chave. */
	enrich: boolean;
	/**
	 * Ids de produto declarados em `organization.yml` (issue #18). Um escopo de
	 * commit que casa com um deles vira o produto da entrada.
	 *
	 * Lista vazia desliga a inferência — que é o comportamento de quem só tem um
	 * produto, e o mesmo changelog de antes desta funcionalidade.
	 */
	products: string[];
}

export const DEFAULT_CONFIG: ChangelogConfig = {
	// Ruído técnico segundo a spec: dependência e refatoração interna não mudam
	// nada para quem integra, e enchem a página até ela virar ilegível.
	noiseTypes: ['chore', 'refactor', 'test', 'ci', 'build', 'style', 'perf'],
	noiseScopes: ['deps', 'deps-dev', 'release'],
	noisePaths: ['package-lock.json', '.github/', 'node_modules/'],
	outputDir: 'src/content/docs/changelog',
	specification: 'src/schemas/portal-api.yaml',
	apiReferenceBase: '/api-reference/overview/',
	// Desligado por padrão: sem chave o gerador usa o texto do commit, e com
	// chave ele reescreve. Ligar por padrão faria o resultado depender de um
	// segredo que nem toda instalação tem — ADR-0016.
	enrich: false,
	// Preenchido por quem gera, a partir do registro. O padrão vazio mantém o
	// changelog idêntico ao de antes para quem tem um produto só.
	products: [],
};
