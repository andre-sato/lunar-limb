/**
 * Impacto, política, consistência, órfãos e não documentados (P2.2).
 *
 * Puro: recebe os vínculos resolvidos, o que mudou e a política, e devolve o
 * veredito. Quem lê disco e Git é `service.ts`.
 *
 * Um guardrail da spec organiza este arquivo: **não considerar somente texto para
 * determinar cobertura**. Uma página que menciona `POST /payments` numa frase não
 * documenta o endpoint; o que conta é o vínculo declarado, resolvido contra o
 * Digital Twin. A menção em texto entra como sinal fraco e aparece marcada como
 * tal — nunca como cobertura.
 */

import type {
	BreakingChange,
	CodeLoopPolicy,
	ConsistencyReport,
	ConsistencySlice,
	DocumentationImpact,
	DocumentationOrphan,
	EntityType,
	ImpactedEntity,
	ImpactedPage,
	PolicyViolationReport,
	ResolvedBinding,
	UndocumentedEntity,
} from './types';

export interface AnalyzeImpactInput {
	changeId: string;
	/** Entidades do produto tocadas pela mudança. */
	changedEntities: Array<{ entityId: string; entityType: EntityType; breaking?: boolean; detail?: string }>;
	/** Páginas de documentação tocadas no mesmo conjunto de mudanças. */
	changedPages: readonly string[];
	/** Entidade → páginas que a documentam, do índice de vínculos. */
	byEntity: ReadonlyMap<string, string[]>;
	/** Páginas que contêm guia de migração. */
	migrationGuides?: readonly string[];
	/** Exemplos considerados obsoletos por outra camada (contratos). */
	staleExamples?: readonly string[];
	policy: CodeLoopPolicy;
}

/**
 * O impacto documental de uma mudança de código.
 *
 * A cobertura aqui é específica e vale definir: das entidades **tocadas pela
 * mudança**, quantas têm documentação que também foi atualizada no mesmo
 * conjunto. Não é a cobertura geral do portal — essa é do Digital Twin. São duas
 * perguntas diferentes, e misturá-las faria um PR pequeno herdar a nota do portal
 * inteiro.
 */
export function analyzeImpact(input: AnalyzeImpactInput): DocumentationImpact {
	const changedPages = new Set(input.changedPages);

	const affectedEntities: ImpactedEntity[] = input.changedEntities.map((entity) => ({
		entityId: entity.entityId,
		entityType: entity.entityType,
		pages: input.byEntity.get(entity.entityId) ?? [],
		breaking: entity.breaking ?? false,
		detail: entity.detail ?? 'entidade alterada',
	}));

	const pageMap = new Map<string, ImpactedPage>();

	for (const entity of affectedEntities) {
		for (const page of entity.pages) {
			const existing = pageMap.get(page) ?? { path: page, entities: [], stale: !changedPages.has(page) };
			existing.entities.push(entity.entityId);
			pageMap.set(page, existing);
		}
	}

	// Entidade sem página vinculada: falta documentação. Entidade com página que
	// **não** foi atualizada junto: documentação potencialmente defasada — e essa
	// distinção decide o que a CI faz.
	const missingDocumentation = affectedEntities.filter((entity) => entity.pages.length === 0);

	const documented = affectedEntities.filter((entity) =>
		entity.pages.some((page) => changedPages.has(page))
	).length;

	const breakingChanges: BreakingChange[] = affectedEntities
		.filter((entity) => entity.breaking)
		.map((entity) => ({
			entityId: entity.entityId,
			message: entity.detail,
			migrationGuide: (input.migrationGuides ?? []).length > 0,
		}));

	return {
		changeId: input.changeId,
		affectedEntities,
		affectedPages: [...pageMap.values()].sort((a, b) => a.path.localeCompare(b.path)),
		coverage: affectedEntities.length === 0 ? 100 : Math.round((documented / affectedEntities.length) * 100),
		missingDocumentation,
		staleExamples: [...(input.staleExamples ?? [])],
		breakingChanges,
	};
}

// ---------------------------------------------------------------------------
// Política (§ Documentation Policy, § CI Gate)
// ---------------------------------------------------------------------------

/**
 * Confronta o impacto com a política.
 *
 * Só `error` bloqueia o merge, e só para entidade cujo tipo a política declara
 * obrigatório. Bloquear por aviso — uma função interna sem página, uma API com
 * documentação um commit atrás — levaria a equipe a desligar o portão inteiro, e
 * aí nem o obrigatório seria verificado.
 */
export function evaluatePolicy(impact: DocumentationImpact, policy: CodeLoopPolicy): PolicyViolationReport[] {
	const violations: PolicyViolationReport[] = [];

	for (const entity of impact.missingDocumentation) {
		const required = policy.requiredFor.includes(entity.entityType);

		violations.push({
			rule: 'requiredDocumentation',
			entityId: entity.entityId,
			severity: required ? 'error' : 'warning',
			message: required
				? `\`${entity.entityId}\` mudou e não tem página vinculada. A política exige documentação para \`${entity.entityType}\`.`
				: `\`${entity.entityId}\` mudou e não tem página vinculada.`,
		});
	}

	if (policy.requireDocsForApiChanges) {
		for (const page of impact.affectedPages.filter((entry) => entry.stale)) {
			const touchesApi = page.entities.some((entity) => /^[A-Z]+ \//.test(entity));

			violations.push({
				rule: 'apiChanges.requireDocs',
				severity: touchesApi ? 'error' : 'warning',
				message: `\`${page.path}\` documenta ${page.entities.join(', ')}, que mudou, e não foi atualizada no mesmo conjunto.`,
			});
		}
	}

	if (policy.requireMigrationGuide) {
		for (const breaking of impact.breakingChanges.filter((change) => !change.migrationGuide)) {
			violations.push({
				rule: 'breakingChanges.requireMigrationGuide',
				entityId: breaking.entityId,
				severity: 'error',
				message: `\`${breaking.entityId}\` tem mudança incompatível e não há guia de migração atualizado.`,
			});
		}
	}

	if (policy.requireExamples) {
		for (const example of impact.staleExamples) {
			violations.push({
				rule: 'apiChanges.requireExamples',
				severity: 'warning',
				message: `O exemplo em \`${example}\` pode não refletir mais o contrato.`,
			});
		}
	}

	return violations;
}

export function blocksMerge(violations: readonly PolicyViolationReport[], policy: CodeLoopPolicy): boolean {
	return policy.failOnViolation && violations.some((violation) => violation.severity === 'error');
}

// ---------------------------------------------------------------------------
// Consistência (§ Consistency Score)
// ---------------------------------------------------------------------------

export interface ConsistencyInput {
	bindings: readonly ResolvedBinding[];
	/** Endpoints declarados no produto. */
	endpoints: readonly string[];
	/** Schemas declarados. */
	schemas: readonly string[];
	/** Comandos de CLI conhecidos. */
	commands: readonly string[];
	/** Exemplos que o Contract Testing aprovou e reprovou. */
	examples?: { valid: number; invalid: number };
}

/**
 * Quanto código e documentação concordam.
 *
 * Cada fatia é "vínculos que resolvem sobre vínculos declarados" — não "páginas
 * que mencionam o nome". Fatia sem nada declarado vem como `null`, e não como
 * 0%: um portal que ainda não usa vínculos de CLI não tem inconsistência de CLI,
 * tem ausência de dado.
 */
export function computeConsistency(input: ConsistencyInput): ConsistencyReport {
	const sliceFor = (name: string, type: EntityType): ConsistencySlice => {
		const relevant = input.bindings.filter((binding) => binding.entityType === type);
		const consistent = relevant.filter((binding) => binding.resolved).length;

		return {
			name,
			consistent,
			total: relevant.length,
			percentage: relevant.length === 0 ? null : Math.round((consistent / relevant.length) * 100),
		};
	};

	const slices: ConsistencySlice[] = [
		sliceFor('Endpoints', 'api'),
		sliceFor('Schemas', 'schema'),
		sliceFor('Serviços', 'service'),
		sliceFor('Comandos', 'cli'),
		sliceFor('Eventos', 'event'),
	];

	if (input.examples && input.examples.valid + input.examples.invalid > 0) {
		const total = input.examples.valid + input.examples.invalid;
		slices.push({
			name: 'Exemplos',
			consistent: input.examples.valid,
			total,
			percentage: Math.round((input.examples.valid / total) * 100),
		});
	}

	const measurable = slices.map((slice) => slice.percentage).filter((value): value is number => value !== null);

	return {
		slices,
		overall: measurable.length === 0 ? null : Math.round(measurable.reduce((sum, value) => sum + value, 0) / measurable.length),
	};
}

// ---------------------------------------------------------------------------
// Órfãos e não documentados
// ---------------------------------------------------------------------------

/**
 * Documentação apontando para entidade que não existe.
 *
 * Mesma política do Digital Twin, e pelo mesmo motivo: **potencialmente** órfã. A
 * página pode documentar comportamento histórico, uma versão anterior ou algo
 * ainda planejado, e um veredito automático transformaria documentação legítima
 * em alarme.
 */
export function findOrphans(bindings: readonly ResolvedBinding[]): DocumentationOrphan[] {
	return bindings
		.filter((binding) => !binding.resolved)
		.map((binding) => ({
			documentationId: binding.documentationId,
			entityId: binding.entityId,
			entityType: binding.entityType,
			reason:
				`${binding.reason ?? 'A entidade não foi encontrada.'} ` +
				'Pode ser comportamento histórico, versão anterior ou algo planejado — confira antes de tratar como defeito.',
		}))
		.sort((a, b) => a.documentationId.localeCompare(b.documentationId));
}

export interface UndocumentedInput {
	/** Entidades públicas do produto, por tipo. */
	entities: Array<{ entityId: string; entityType: EntityType; evidence: string[] }>;
	byEntity: ReadonlyMap<string, string[]>;
	policy: CodeLoopPolicy;
}

export function findUndocumented(input: UndocumentedInput): UndocumentedEntity[] {
	return input.entities
		.filter((entity) => (input.byEntity.get(entity.entityId) ?? []).length === 0)
		.map((entity) => ({
			entityId: entity.entityId,
			entityType: entity.entityType,
			required: input.policy.requiredFor.includes(entity.entityType),
			evidence: entity.evidence,
		}))
		.sort((a, b) => Number(b.required) - Number(a.required) || a.entityId.localeCompare(b.entityId));
}

// ---------------------------------------------------------------------------
// Release (§ Release Documentation Coverage)
// ---------------------------------------------------------------------------

export interface ReleaseCoverageInput {
	newEntities: readonly string[];
	changedEntities: readonly string[];
	removedEntities: readonly string[];
	breakingEntities: readonly string[];
	byEntity: ReadonlyMap<string, string[]>;
	/** Páginas atualizadas dentro da release. */
	updatedPages: readonly string[];
	migrationGuides: readonly string[];
}

export interface ReleaseCoverage {
	slices: ConsistencySlice[];
	overall: number | null;
	summary: { added: number; changed: number; removed: number; documented: number; missing: number };
}

export function computeReleaseCoverage(input: ReleaseCoverageInput): ReleaseCoverage {
	const updated = new Set(input.updatedPages);

	const sliceFor = (name: string, entities: readonly string[], requireUpdate = true): ConsistencySlice => {
		const documented = entities.filter((entity) => {
			const pages = input.byEntity.get(entity) ?? [];
			if (pages.length === 0) return false;
			return requireUpdate ? pages.some((page) => updated.has(page)) : true;
		}).length;

		return {
			name,
			consistent: documented,
			total: entities.length,
			percentage: entities.length === 0 ? null : Math.round((documented / entities.length) * 100),
		};
	};

	const slices = [
		sliceFor('APIs novas', input.newEntities),
		sliceFor('APIs alteradas', input.changedEntities),
		{
			name: 'Guias de migração',
			consistent: input.breakingEntities.length === 0 ? 0 : input.migrationGuides.length > 0 ? input.breakingEntities.length : 0,
			total: input.breakingEntities.length,
			percentage:
				input.breakingEntities.length === 0 ? null : input.migrationGuides.length > 0 ? 100 : 0,
		},
	];

	const measurable = slices.map((slice) => slice.percentage).filter((value): value is number => value !== null);

	const documented = slices.reduce((sum, slice) => sum + slice.consistent, 0);
	const total = slices.reduce((sum, slice) => sum + slice.total, 0);

	return {
		slices,
		overall: measurable.length === 0 ? null : Math.round(measurable.reduce((sum, value) => sum + value, 0) / measurable.length),
		summary: {
			added: input.newEntities.length,
			changed: input.changedEntities.length,
			removed: input.removedEntities.length,
			documented,
			missing: total - documented,
		},
	};
}
