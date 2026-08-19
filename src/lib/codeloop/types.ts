/**
 * Documentation-to-Code Loop — modelo (P2.2).
 *
 * O princípio que a spec fixa e que decide a direção das dependências:
 *
 *     Code → Documentation Contract → Documentation
 *
 * A documentação **não** deve fazer o código depender de Markdown. O código não
 * sabe que este portal existe; quem conhece os dois lados é o vínculo declarado
 * na página, e o Digital Twin é quem resolve esse vínculo contra o produto real.
 *
 * Daí a decisão que atravessa o arquivo inteiro: o binding vive no frontmatter da
 * **documentação**, nunca no código. Uma anotação no código que apontasse para
 * uma página inverteria a direção e faria um `git mv` de Markdown quebrar o build
 * do produto.
 */

export type EntityType =
	| 'api'
	| 'schema'
	| 'service'
	| 'function'
	| 'class'
	| 'event'
	| 'database'
	| 'cli'
	| 'config'
	| 'feature';

export const ENTITY_LABEL: Record<EntityType, string> = {
	api: 'Endpoint',
	schema: 'Schema',
	service: 'Serviço',
	function: 'Função',
	class: 'Classe',
	event: 'Evento',
	database: 'Schema de banco',
	cli: 'Comando',
	config: 'Configuração',
	feature: 'Funcionalidade',
};

export interface DocumentationBinding {
	/** Caminho da página, relativo a `src/content/docs`. */
	documentationId: string;
	entityType: EntityType;
	/** `payments.create`, `POST /api/users`, `src/lib/pay.ts#create`. */
	entityId: string;
	version?: string;
	/**
	 * `true` quando a política exige documentação para esta entidade. Um vínculo
	 * obrigatório que perde a página vira falha de CI; um opcional, um aviso.
	 */
	required: boolean;
	/** Linha do frontmatter onde o vínculo foi declarado. */
	line?: number;
}

/** O vínculo, depois de confrontado com o Digital Twin. */
export interface ResolvedBinding extends DocumentationBinding {
	/** `true` quando a entidade existe no produto. */
	resolved: boolean;
	/** Nó do Twin correspondente, quando resolveu. */
	twinNodeId?: string;
	/** Por que não resolveu, quando não resolveu. */
	reason?: string;
}

// ---------------------------------------------------------------------------
// Mudança de código e impacto
// ---------------------------------------------------------------------------

export interface CodeChange {
	/** Faixa de commits: `HEAD~1..HEAD`, ou uma branch base. */
	range: string;
	files: string[];
	/** Entidades do produto tocadas, deduzidas dos arquivos. */
	entities: string[];
}

export interface ImpactedEntity {
	entityId: string;
	entityType: EntityType;
	/** Páginas ligadas a esta entidade. */
	pages: string[];
	/** `true` quando a mudança quebra quem já consome. */
	breaking: boolean;
	detail: string;
}

export interface ImpactedPage {
	path: string;
	/** Entidades desta página que mudaram. */
	entities: string[];
	/** `true` quando a página não foi tocada no mesmo conjunto de mudanças. */
	stale: boolean;
}

export interface BreakingChange {
	entityId: string;
	message: string;
	/** `true` quando existe guia de migração citando a entidade. */
	migrationGuide: boolean;
}

export interface DocumentationImpact {
	changeId: string;
	affectedEntities: ImpactedEntity[];
	affectedPages: ImpactedPage[];
	/** Percentual das entidades tocadas que têm documentação atualizada. */
	coverage: number;
	missingDocumentation: ImpactedEntity[];
	staleExamples: string[];
	breakingChanges: BreakingChange[];
}

// ---------------------------------------------------------------------------
// Consistência, órfãos e não documentados
// ---------------------------------------------------------------------------

export interface ConsistencySlice {
	name: string;
	consistent: number;
	total: number;
	/** `null` quando não há o que medir — nunca 0%. */
	percentage: number | null;
}

export interface ConsistencyReport {
	slices: ConsistencySlice[];
	/** Média das fatias mensuráveis, ou `null`. */
	overall: number | null;
}

export interface DocumentationOrphan {
	documentationId: string;
	entityId: string;
	entityType: EntityType;
	/**
	 * Sempre "potencialmente": a página pode documentar comportamento histórico,
	 * versão anterior ou algo planejado. Mesma política do Digital Twin.
	 */
	reason: string;
}

export interface UndocumentedEntity {
	entityId: string;
	entityType: EntityType;
	/** `true` quando a política exige documentação para este tipo. */
	required: boolean;
	evidence: string[];
}

// ---------------------------------------------------------------------------
// Política (§ Policy Configuration)
// ---------------------------------------------------------------------------

export interface CodeLoopPolicy {
	/** Tipos de entidade que exigem documentação. */
	requiredFor: EntityType[];
	/** Mudança em API pública exige documentação atualizada no mesmo conjunto. */
	requireDocsForApiChanges: boolean;
	/** Mudança incompatível exige guia de migração. */
	requireMigrationGuide: boolean;
	/** Mudança em API exige exemplo na página. */
	requireExamples: boolean;
	/** Cobertura mínima para release. */
	releaseMinimumCoverage: number;
	/** Bloquear merge quando a política for violada. */
	failOnViolation: boolean;
}

export const DEFAULT_POLICY: CodeLoopPolicy = {
	// Só o que é publicado: endpoint, evento e comando de CLI. Exigir documentação
	// de toda função interna transformaria a política numa fila de trabalho
	// impossível, e o primeiro efeito disso é alguém desligá-la inteira.
	requiredFor: ['api', 'event', 'cli'],
	requireDocsForApiChanges: true,
	requireMigrationGuide: true,
	requireExamples: false,
	releaseMinimumCoverage: 95,
	// Ligado por padrão, e só violação de item **obrigatório** bloqueia.
	failOnViolation: true,
};

export interface PolicyViolationReport {
	rule: string;
	message: string;
	entityId?: string;
	/** `error` bloqueia o merge; `warning` não. */
	severity: 'error' | 'warning';
}
