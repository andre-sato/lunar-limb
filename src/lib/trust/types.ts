/**
 * Documentation Trust & Provenance — modelo (§3, §4, §6, §8, §9).
 *
 * O princípio da spec:
 *
 *     Every important documentation claim should have evidence.
 *
 * Uma página pode afirmar "chaves de API expiram em 90 dias" sem que exista, em
 * lugar nenhum, o registro de onde isso veio, quem confirmou e quando. Enquanto
 * for verdade, ninguém nota; quando deixar de ser, ninguém descobre. Esta camada
 * dá endereço à afirmação.
 *
 * Um limite que vale declarar aqui, e não em letra pequena: verificar uma
 * evidência é confirmar que **ela existe e continua batendo com o que a página
 * diz onde é possível comparar** — o endpoint citado existe na especificação, o
 * arquivo e a linha citados existem no código. Não é provar que a prosa é
 * verdadeira. `verified` significa "a evidência confere", nunca "a frase está
 * certa", e confundir os dois transformaria o selo em falso conforto.
 */

// ---------------------------------------------------------------------------
// Provenance (§3, §4)
// ---------------------------------------------------------------------------

export type SourceType =
	/** Arquivo de código, opcionalmente com linha: `src/auth/config.ts:42`. */
	| 'code'
	/** Ponteiro numa especificação OpenAPI: `portal-api.yaml#/paths/~1auth~1me/get`. */
	| 'openapi'
	/** Ponteiro numa especificação AsyncAPI. */
	| 'asyncapi'
	/** Identificador de teste: `DOC-LINK-001`, `AUTH-004`. */
	| 'test'
	/** Confirmação humana: `verificado pelo time de Plataforma`. */
	| 'manual'
	/** Conteúdo gerado a partir de outra fonte. */
	| 'generated';

export const SOURCE_TYPES: readonly SourceType[] = ['code', 'openapi', 'asyncapi', 'test', 'manual', 'generated'];

export const SOURCE_TYPE_LABEL: Record<SourceType, string> = {
	code: 'Código',
	openapi: 'OpenAPI',
	asyncapi: 'AsyncAPI',
	test: 'Teste',
	manual: 'Verificação manual',
	generated: 'Gerado',
};

/**
 * Estado da evidência.
 *
 *     verified    a evidência existe e confere
 *     stale       existe, confere, e a última confirmação passou do prazo
 *     unverified  declarada, mas nunca confirmada
 *     invalid     a evidência **não** confere — o endpoint citado não existe mais
 */
export type VerificationStatus = 'verified' | 'stale' | 'unverified' | 'invalid';

export const STATUS_ORDER: Record<VerificationStatus, number> = {
	verified: 0,
	stale: 1,
	unverified: 2,
	invalid: 3,
};

export const STATUS_LABEL: Record<VerificationStatus, string> = {
	verified: 'Verificado',
	stale: 'Verificação vencida',
	unverified: 'Não verificado',
	invalid: 'Evidência inválida',
};

export const STATUS_MARK: Record<VerificationStatus, string> = {
	verified: '✓',
	stale: '⚠',
	unverified: '·',
	invalid: '✗',
};

export interface Provenance {
	sourceType: SourceType;
	/** A referência, como escrita na página. */
	source: string;
	/** ISO 8601, data da última confirmação. */
	verifiedAt?: string;
	/** Quem confirmou — pessoa ou time. Nunca um segredo, nunca um token. */
	verifiedBy?: string;
	/** Responsável pela afirmação, quando declarado. */
	owner?: string;
	/** Prazo de validade próprio, em dias, sobrepondo o padrão. */
	freshnessDays?: number;
}

/**
 * Uma afirmação com endereço.
 *
 * A afirmação em si fica no arquivo de conteúdo, versionada no Git (§14) — a
 * anotação vive junto do texto que ela sustenta, e não num banco à parte, senão
 * as duas coisas divergem no primeiro `git revert`.
 */
export interface Claim {
	/** Página onde a afirmação está, relativa a `src/content/docs`. */
	path: string;
	/** Linha da anotação no arquivo. */
	line: number;
	/** O texto afirmado, quando identificável (o parágrafo seguinte à anotação). */
	text?: string;
	provenance: Provenance[];
}

export interface EvidenceResult {
	provenance: Provenance;
	status: VerificationStatus;
	/** O que foi conferido, em uma frase — o selo tem de poder ser auditado. */
	detail: string;
	/** Dias desde a última confirmação, quando há data. */
	ageDays?: number;
}

export interface VerifiedClaim extends Claim {
	evidence: EvidenceResult[];
	/** O pior estado entre as evidências: uma inválida contamina a afirmação. */
	status: VerificationStatus;
}

// ---------------------------------------------------------------------------
// Trust Score (§9)
// ---------------------------------------------------------------------------

export interface TrustScore {
	/** 0–100. */
	value: number;
	/** Validade das fontes: quantas evidências conferem. */
	sourceValidity: number;
	/** Cobertura por teste: quantas afirmações têm um teste como evidência. */
	testCoverage: number;
	/** Frescor: quão recentes são as confirmações. */
	freshness: number;
	/** Responsável declarado. */
	ownership: number;
}

export interface PageTrust {
	path: string;
	claims: VerifiedClaim[];
	score: TrustScore;
	status: VerificationStatus;
	/** Responsável da página, do frontmatter ou da configuração. */
	owner?: string;
	/** Confirmação mais recente entre as evidências. */
	lastVerified?: string;
}

export interface TrustConfig {
	/** Prazo padrão de validade, em dias (§8). */
	freshnessDays: number;
	/** Responsável por prefixo de caminho, quando a página não declara. */
	owners: Array<{ prefix: string; owner: string }>;
}

export const DEFAULT_TRUST_CONFIG: TrustConfig = {
	// 180 dias, como a spec sugere. Prazo curto transforma o portal num mar de
	// avisos amarelos que ninguém lê; prazo longo deixa a página envelhecer com
	// selo de verificada. Seis meses é o que dá para uma equipe honrar.
	freshnessDays: 180,
	owners: [],
};

/** O pior estado da lista. Uma evidência inválida contamina o conjunto. */
export function worstStatus(statuses: readonly VerificationStatus[]): VerificationStatus {
	if (statuses.length === 0) return 'unverified';
	return statuses.reduce((worst, status) => (STATUS_ORDER[status] > STATUS_ORDER[worst] ? status : worst), 'verified');
}
