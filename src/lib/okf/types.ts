/**
 * Modelo do Open Knowledge Format v0.2 (issue #16).
 *
 * OKF é um formato de **compartilhamento**: um diretório de Markdown com
 * frontmatter YAML que descreve conceitos e os liga entre si, para que um
 * sistema de IA consiga consumir conhecimento curado sem precisar conhecer a
 * plataforma que o produziu.
 *
 * A spec: https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf
 *
 * Por que um modelo tipado e não `Record<string, unknown>`: a conformidade do
 * OKF é estreita (um campo obrigatório) mas as famílias opcionais têm forma
 * exata, e a única forma de garantir que `verified` sai como lista e
 * `generated` sai como par `{by, at}` é o compilador cobrar isso na hora de
 * montar — não o validador reclamar depois de escrever no disco.
 */

/** A versão da spec que este módulo implementa. */
export const OKF_VERSION = '0.2';

/**
 * Nomes reservados pela spec. Todo outro `.md` é um conceito.
 *
 * Importa para o validador: um arquivo reservado **não** precisa de `type`, e
 * cobrar `type` de um `index.md` reprovaria um bundle conformante.
 */
export const RESERVED_FILENAMES = ['index.md', 'log.md'] as const;

/**
 * Convenção de ator da spec (§ Actor Convention).
 *
 *   `human:<id>`            uma pessoa
 *   `process:<id>`          um processo automatizado
 *   `<producer>/<version>`  um agente
 *
 * A distinção não é cosmética: o nível de confiança do conceito é derivado do
 * prefixo `human:`, e escrever `mestre` em vez de `human:mestre` rebaixa uma
 * revisão humana a "confirmada por máquina" sem que ninguém perceba.
 */
export type Actor = string;

export function humanActor(id: string): Actor {
	return `human:${id}`;
}

export function processActor(id: string): Actor {
	return `process:${id}`;
}

/** `true` quando o ator identifica uma pessoa, na convenção da spec. */
export function isHumanActor(actor: Actor): boolean {
	return actor.startsWith('human:') && actor.length > 'human:'.length;
}

/** Ciclo de vida declarado. Ausente significa `stable` (§ status). */
export type OkfStatus = 'draft' | 'stable' | 'deprecated';

/** Registro de criação: quem gerou o conceito e quando. */
export interface OkfGenerated {
	by: Actor;
	at: string;
}

/** Registro de confirmação. A spec aceita lista ou mapa solto; aqui é sempre lista. */
export interface OkfVerification {
	by: Actor;
	at: string;
}

/**
 * Uma fonte de que o conceito deriva.
 *
 * Só `resource` é obrigatório. Os sinais de credibilidade (`author`,
 * `usage_count`, `last_modified`) são fatos objetivos sobre a fonte, não um
 * veredito sobre ela — quem consome decide o que fazer com eles.
 */
export interface OkfSource {
	/** Chave estável, usada por notas de rodapé no corpo para atribuir afirmações. */
	id?: string;
	resource: string;
	title?: string;
	author?: Actor;
	usage_count?: number;
	last_modified?: string;
}

/**
 * Níveis de confiança derivados de `verified` (§ Trust Tiers).
 *
 * Derivado, nunca declarado: um campo `trust: human-reviewed` escrito à mão
 * seria uma afirmação sem evidência, e o ponto do OKF é que a evidência
 * (quem, quando) viaja junto.
 */
export type TrustTier = 'unverified' | 'machine-confirmed' | 'human-reviewed';

export function trustTierOf(verified: readonly OkfVerification[] | undefined): TrustTier {
	if (!verified || verified.length === 0) return 'unverified';
	return verified.some((entry) => isHumanActor(entry.by)) ? 'human-reviewed' : 'machine-confirmed';
}

/**
 * O frontmatter de um conceito.
 *
 * `type` é o único campo que a spec exige. Todo o resto é recomendado ou
 * opcional, e um consumidor conformante não pode recusar o conceito por falta
 * deles — por isso quase tudo aqui é opcional de verdade, e não "opcional mas
 * na prática obrigatório".
 */
export interface OkfFrontmatter {
	/** Obrigatório e não vazio. Tipos não são registrados centralmente. */
	type: string;
	title?: string;
	description?: string;
	/** URI que identifica o ativo descrito — no portal, a URL pública da página. */
	resource?: string;
	tags?: string[];
	generated?: OkfGenerated;
	verified?: OkfVerification[];
	status?: OkfStatus;
	/** ISO 8601. Depois disso o conteúdo deve ser tratado como possivelmente velho. */
	stale_after?: string;
	sources?: OkfSource[];
	/**
	 * Campos fora da spec. A spec manda o consumidor tolerar chaves
	 * desconhecidas, e é isso que deixa o bundle carregar o que o portal sabe e
	 * o OKF ainda não nomeia — dono, produtos, público, traduções.
	 */
	extensions?: Record<string, unknown>;
}

/** Um conceito: um arquivo do bundle. */
export interface OkfConcept {
	/** Caminho relativo à raiz do bundle, POSIX, com extensão. É a identidade. */
	path: string;
	frontmatter: OkfFrontmatter;
	body: string;
}

/** Uma entrada de `index.md`. */
export interface OkfIndexEntry {
	title: string;
	/** Caminho relativo ao bundle, começando com `/`. */
	href: string;
	description?: string;
}

/** Uma seção de `index.md`: um cabeçalho e a lista abaixo dele. */
export interface OkfIndexSection {
	heading: string;
	entries: OkfIndexEntry[];
}

export interface OkfIndex {
	path: string;
	/** Só a raiz do bundle declara a versão (§ Versioning). */
	okfVersion?: string;
	title?: string;
	description?: string;
	sections: OkfIndexSection[];
}

/** Uma entrada de `log.md`, agrupada por dia. */
export interface OkfLogEntry {
	/** ISO 8601 `YYYY-MM-DD`. */
	date: string;
	/** Prefixo convencional: `Update`, `Creation`, `Deprecation`. */
	kind: string;
	text: string;
}

export interface OkfLog {
	path: string;
	/** Mais recente primeiro, como a spec pede. */
	entries: OkfLogEntry[];
}

/** O bundle inteiro, antes de virar bytes. */
export interface OkfBundle {
	concepts: OkfConcept[];
	indexes: OkfIndex[];
	logs: OkfLog[];
}
