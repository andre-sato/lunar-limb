/**
 * Adaptive Documentation — modelo (§2, §3, §14).
 *
 * O princípio da spec:
 *
 *     One source of truth, multiple contextual experiences.
 *
 * A mesma página serve a quem programa, a quem atende cliente e a quem opera —
 * **sem** duplicar arquivo. `authentication-developer.md` e
 * `authentication-support.md` divergem no terceiro mês e ninguém percebe qual
 * está certo.
 *
 * A restrição que molda a implementação inteira está na §12: personalização não
 * pode remover informação, quebrar navegação, depender só de aparência nem
 * impedir acesso ao conteúdo completo. Por isso o conteúdo de outra audiência
 * **nunca sai da página** — ele é recolhido, com rótulo, e continua alcançável
 * por teclado e leitor de tela. Adaptar é mudar a ordem e o destaque, não
 * esconder.
 */

export const AUDIENCES = ['developer', 'support', 'product', 'operations', 'ai-agent'] as const;

export type Audience = (typeof AUDIENCES)[number];

export const AUDIENCE_LABEL: Record<Audience, string> = {
	developer: 'Quem desenvolve',
	support: 'Quem atende',
	product: 'Produto',
	operations: 'Operações',
	'ai-agent': 'Agente de IA',
};

/** Rótulo curto, para o bloco recolhido no meio do texto. */
export const AUDIENCE_SHORT: Record<Audience, string> = {
	developer: 'desenvolvimento',
	support: 'suporte',
	product: 'produto',
	operations: 'operações',
	'ai-agent': 'agentes de IA',
};

export const EXPERIENCES = ['beginner', 'intermediate', 'advanced'] as const;

export type Experience = (typeof EXPERIENCES)[number];

export const EXPERIENCE_LABEL: Record<Experience, string> = {
	beginner: 'Iniciante',
	intermediate: 'Intermediário',
	advanced: 'Avançado',
};

export interface DocumentationContext {
	audience?: Audience;
	/** Papel no portal (`viewer`, `editor`, `admin`), quando há sessão. */
	role?: string;
	version?: string;
	product?: string;
	locale?: string;
	experience?: Experience;
}

/**
 * O contexto padrão: nenhum.
 *
 * A §14 pede fallback, e o fallback é a documentação como ela é. Sem contexto, a
 * página aparece inteira, na ordem em que foi escrita — que é exatamente o que
 * ela já era antes desta camada existir.
 */
export const DEFAULT_CONTEXT: DocumentationContext = {};

export function isAudience(value: unknown): value is Audience {
	return typeof value === 'string' && (AUDIENCES as readonly string[]).includes(value);
}

export function isExperience(value: unknown): value is Experience {
	return typeof value === 'string' && (EXPERIENCES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Metadados da página (§4)
// ---------------------------------------------------------------------------

export interface AudienceTarget {
	audience: Audience;
	/** `high` empurra a página para cima na lista de recomendações. */
	priority: 'high' | 'medium' | 'low';
}

export const PRIORITY_WEIGHT: Record<AudienceTarget['priority'], number> = {
	high: 3,
	medium: 2,
	low: 1,
};

export interface PageContextMeta {
	path: string;
	title?: string;
	url?: string;
	/**
	 * `slug` declarado no frontmatter, quando há. A URL publicada vem dele e não
	 * do caminho do arquivo — quem monta URL a partir desta estrutura precisa
	 * saber disso para não apontar para uma rota que dá 404.
	 */
	slug?: string;
	audiences: AudienceTarget[];
	tags: string[];
	version?: string;
	product?: string;
	/**
	 * Produtos declarados pela página (issue #18). Lista **vazia** significa
	 * compartilhada: a página vale para todos os produtos.
	 *
	 * Convive com `product`, que é o campo escalar que a adaptação já pontuava
	 * antes de existir navegação por produto. `products` é a lista normalizada
	 * dos dois — quem filtra lê esta, quem pontua continua podendo ler aquele.
	 */
	products: string[];
	experience?: Experience;
}

export interface Recommendation {
	title: string;
	url: string;
	path: string;
	/** Por que esta página foi recomendada — sem isso a lista é adivinhação. */
	reason: string;
	score: number;
}
