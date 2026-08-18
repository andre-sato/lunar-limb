/**
 * Leitura e normalização do contexto (§2, §4, §7, §14).
 *
 * Puro: recebe cabeçalhos, cookie e frontmatter e devolve estrutura. Nada aqui
 * confia no que chegou — audiência e experiência vêm do navegador de quem lê, e
 * só valores da lista conhecida sobrevivem à normalização. Um `audience` livre
 * viraria chave de comparação em página, em nome de arquivo e em log.
 */

import {
	AUDIENCES,
	DEFAULT_CONTEXT,
	isAudience,
	isExperience,
	PRIORITY_WEIGHT,
	type Audience,
	type AudienceTarget,
	type DocumentationContext,
	type Experience,
	type PageContextMeta,
} from './types';

/** Nome do cookie de contexto. Sem `httpOnly`: quem escreve nele é o navegador. */
export const CONTEXT_COOKIE = 'll_context';

export interface RawContext {
	audience?: unknown;
	experience?: unknown;
	version?: unknown;
	product?: unknown;
	locale?: unknown;
	role?: unknown;
}

/**
 * Normaliza o que veio de fora.
 *
 * Campo desconhecido some; campo com valor fora da lista some. O resultado é
 * sempre um contexto válido ou vazio — e vazio é um estado legítimo, não um erro.
 */
export function normalizeContext(raw: RawContext | null | undefined): DocumentationContext {
	if (!raw || typeof raw !== 'object') return DEFAULT_CONTEXT;

	const context: DocumentationContext = {};

	if (isAudience(raw.audience)) context.audience = raw.audience;
	if (isExperience(raw.experience)) context.experience = raw.experience;

	// Versão, produto e idioma são texto livre no papel, mas viram comparação de
	// string em vários lugares. Um teto de tamanho e um alfabeto restrito evitam
	// que um valor absurdo chegue às camadas de baixo.
	const safe = (value: unknown): string | undefined => {
		if (typeof value !== 'string') return undefined;
		const trimmed = value.trim();
		// Recusa em vez de truncar: cortar um valor absurdo em 40 caracteres o
		// aceitaria mutilado, e um "v2" que virou outra coisa no caminho é pior que
		// um contexto ausente — comparações passariam a bater com o que ninguém pediu.
		if (trimmed === '' || trimmed.length > 40) return undefined;
		return /^[A-Za-z0-9._-]+$/.test(trimmed) ? trimmed : undefined;
	};

	const version = safe(raw.version);
	const product = safe(raw.product);
	const locale = safe(raw.locale);
	const role = safe(raw.role);

	if (version) context.version = version;
	if (product) context.product = product;
	if (locale) context.locale = locale;
	if (role) context.role = role;

	return context;
}

/** Lê o contexto do cookie, que é um JSON curto escrito pelo próprio navegador. */
export function contextFromCookie(value: string | undefined): DocumentationContext {
	if (!value) return DEFAULT_CONTEXT;
	try {
		return normalizeContext(JSON.parse(decodeURIComponent(value)) as RawContext);
	} catch {
		// Cookie corrompido é o mesmo que cookie ausente: cai no padrão em vez de
		// derrubar a página de quem só queria ler documentação.
		return DEFAULT_CONTEXT;
	}
}

export function contextToCookie(context: DocumentationContext): string {
	return encodeURIComponent(JSON.stringify(context));
}

/** Contexto vindo da query string, que tem precedência sobre o cookie. */
export function contextFromQuery(params: URLSearchParams): DocumentationContext {
	return normalizeContext({
		audience: params.get('audience') ?? undefined,
		experience: params.get('experience') ?? undefined,
		version: params.get('version') ?? undefined,
		product: params.get('product') ?? undefined,
		locale: params.get('locale') ?? undefined,
	});
}

/**
 * Junta as fontes de contexto.
 *
 * Precedência: query > cookie > sessão. A query ganha porque é o link que alguém
 * mandou para outra pessoa ("veja isto na visão de suporte"), e esse link precisa
 * funcionar mesmo para quem já tem preferência salva.
 */
export function mergeContext(...sources: Array<DocumentationContext | undefined>): DocumentationContext {
	const merged: DocumentationContext = {};
	for (const source of sources) {
		if (!source) continue;
		for (const [key, value] of Object.entries(source)) {
			if (value !== undefined && merged[key as keyof DocumentationContext] === undefined) {
				(merged as Record<string, unknown>)[key] = value;
			}
		}
	}
	return merged;
}

// ---------------------------------------------------------------------------
// Frontmatter (§4)
// ---------------------------------------------------------------------------

/**
 * Lê as audiências declaradas pela página.
 *
 * Duas formas, como a spec pede — a lista simples e o mapa com prioridade:
 *
 *     audiences: [developer, support]
 *
 *     audience:
 *       developer: { priority: high }
 *       support: { priority: medium }
 *
 * A lista simples é o caso comum e vale `medium` para todas. O mapa existe para
 * quando importa dizer que a página é *sobretudo* de alguém.
 */
export function parseAudiences(frontmatter: Record<string, unknown> | undefined): AudienceTarget[] {
	if (!frontmatter) return [];

	const list = frontmatter.audiences;
	if (Array.isArray(list)) {
		return list.filter(isAudience).map((audience) => ({ audience, priority: 'medium' as const }));
	}

	const map = frontmatter.audience;
	if (map && typeof map === 'object' && !Array.isArray(map)) {
		const targets: AudienceTarget[] = [];
		for (const [key, value] of Object.entries(map as Record<string, unknown>)) {
			if (!isAudience(key)) continue;
			const priority =
				value && typeof value === 'object' && 'priority' in value
					? String((value as { priority: unknown }).priority)
					: 'medium';
			targets.push({
				audience: key,
				priority: priority === 'high' || priority === 'low' ? priority : 'medium',
			});
		}
		return targets;
	}

	// Uma string única também vale: `audience: developer`.
	if (isAudience(frontmatter.audience)) {
		return [{ audience: frontmatter.audience, priority: 'medium' }];
	}

	return [];
}

// ---------------------------------------------------------------------------
// Pontuação (§7, §8)
// ---------------------------------------------------------------------------

export interface ScoreDetail {
	score: number;
	reasons: string[];
}

/**
 * Quanto uma página combina com o contexto.
 *
 * Usada para **ordenar e destacar**, nunca para esconder (§8). Página que não
 * combina com nada continua acessível, na posição em que sempre esteve — o que a
 * pontuação muda é o que aparece primeiro.
 *
 * Página sem audiência declarada não é penalizada: a maior parte do portal é
 * assim, e empurrá-la para baixo transformaria a adaptação numa reordenação
 * silenciosa de quase tudo.
 */
export function scoreForContext(page: PageContextMeta, context: DocumentationContext): ScoreDetail {
	const reasons: string[] = [];
	let score = 0;

	if (context.audience && page.audiences.length > 0) {
		const match = page.audiences.find((target) => target.audience === context.audience);
		if (match) {
			score += PRIORITY_WEIGHT[match.priority] * 2;
			reasons.push(`escrita para ${context.audience}`);
		}
	}

	if (context.version && page.version) {
		if (page.version === context.version) {
			score += 3;
			reasons.push(`versão ${context.version}`);
		} else {
			// Versão diferente **desce**, mas não some: quem lê pode estar migrando, e
			// a página da outra versão é exatamente o que ajuda nessa hora.
			score -= 2;
			reasons.push(`versão ${page.version}`);
		}
	}

	if (context.product && page.product === context.product) {
		score += 2;
		reasons.push(`produto ${context.product}`);
	}

	if (context.experience && page.experience === context.experience) {
		score += 1;
		reasons.push(`nível ${context.experience}`);
	}

	return { score, reasons };
}

/** As audiências que a página declara, para o seletor mostrar o que existe. */
export function audiencesOf(pages: readonly PageContextMeta[]): Audience[] {
	const found = new Set<Audience>();
	for (const page of pages) for (const target of page.audiences) found.add(target.audience);
	return AUDIENCES.filter((audience) => found.has(audience));
}
