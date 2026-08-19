/**
 * Documentation bindings (P2.2 — § Documentation Binding).
 *
 * O vínculo entre uma página e uma entidade do produto, declarado no frontmatter:
 *
 *     ---
 *     documentation:
 *       bindings:
 *         - type: api
 *           id: POST /api/payments
 *           version: v3
 *     ---
 *
 * Ele vive na **documentação**, nunca no código. Uma anotação no código apontando
 * para uma página inverteria a direção de dependência que a spec fixa — e faria um
 * `git mv` de Markdown quebrar o build do produto.
 *
 * Um guardrail da spec vale destacar: "não criar bindings arbitrários". Por isso
 * este arquivo **resolve** cada vínculo contra o Digital Twin e marca o que não
 * existe, em vez de aceitar qualquer identificador escrito à mão.
 */

import yaml from 'js-yaml';
import { endpointKey } from '../twin/build';
import { twinId, type TwinGraph } from '../twin/types';
import {
	DEFAULT_POLICY,
	type CodeLoopPolicy,
	type DocumentationBinding,
	type EntityType,
	type ResolvedBinding,
} from './types';

const ENTITY_TYPES: readonly EntityType[] = [
	'api',
	'schema',
	'service',
	'function',
	'class',
	'event',
	'database',
	'cli',
	'config',
	'feature',
];

function isEntityType(value: unknown): value is EntityType {
	return typeof value === 'string' && ENTITY_TYPES.includes(value as EntityType);
}

interface RawFrontmatter {
	documentation?: { bindings?: unknown };
	/** Forma curta, sem o nível `documentation:`. */
	bindings?: unknown;
}

/**
 * Lê os vínculos declarados numa página.
 *
 * Aceita as duas formas — com e sem o nível `documentation:` — porque a spec
 * escreve a longa e a curta é a que alguém digita. Recusar uma delas faria o
 * exemplo da própria spec não funcionar.
 */
export function parseBindings(path: string, raw: string, policy: CodeLoopPolicy = DEFAULT_POLICY): DocumentationBinding[] {
	const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!frontmatter) return [];

	let parsed: RawFrontmatter | null | undefined;
	try {
		parsed = yaml.load(frontmatter[1]) as RawFrontmatter;
	} catch {
		// Frontmatter ilegível: a página continua publicável, só não participa do
		// loop. Derrubar a leitura inteira por um YAML torto seria trocar um
		// defeito pequeno por um grande.
		return [];
	}

	const list = parsed?.documentation?.bindings ?? parsed?.bindings;
	if (!Array.isArray(list)) return [];

	const bindings: DocumentationBinding[] = [];

	for (const entry of list) {
		if (!entry || typeof entry !== 'object') continue;

		const record = entry as Record<string, unknown>;
		const type = record.type;
		const id = record.id;

		if (!isEntityType(type) || typeof id !== 'string' || id.trim() === '') continue;

		bindings.push({
			documentationId: path,
			entityType: type,
			// Endpoint passa pela mesma normalização do Digital Twin: sem isso,
			// `GET /users/{id}` e `GET /users/[id]` seriam vínculos diferentes para o
			// mesmo endpoint.
			entityId: type === 'api' ? normalizeApiId(id) : id.trim(),
			version: typeof record.version === 'string' ? record.version : undefined,
			required: typeof record.required === 'boolean' ? record.required : policy.requiredFor.includes(type),
		});
	}

	return bindings;
}

/** `POST /api/payments` ou `payments.create` — as duas formas aparecem. */
export function normalizeApiId(id: string): string {
	const match = id.trim().match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)$/i);
	return match ? endpointKey(match[1], match[2]) : id.trim();
}

// ---------------------------------------------------------------------------
// Resolução contra o Digital Twin
// ---------------------------------------------------------------------------

/**
 * Confronta cada vínculo com o produto real.
 *
 * O que não resolve **não** é silenciado: ele volta com `resolved: false` e o
 * motivo. Aceitar um identificador inventado transformaria o binding numa
 * declaração de intenção, e a cobertura calculada sobre ele seria ficção.
 */
export function resolveBindings(bindings: readonly DocumentationBinding[], graph: TwinGraph): ResolvedBinding[] {
	const byId = new Map(graph.nodes.map((node) => [node.id, node]));
	const byName = new Map(graph.nodes.map((node) => [node.name, node]));

	return bindings.map((binding) => {
		const candidates = candidateIds(binding);

		for (const candidate of candidates) {
			const node = byId.get(candidate) ?? byName.get(binding.entityId);
			if (node) return { ...binding, resolved: true, twinNodeId: node.id };
		}

		return {
			...binding,
			resolved: false,
			reason:
				binding.entityType === 'api'
					? `Nenhum endpoint \`${binding.entityId}\` no Digital Twin — nem na especificação, nem no código.`
					: `Nenhuma entidade \`${binding.entityId}\` do tipo \`${binding.entityType}\` foi encontrada.`,
		};
	});
}

/** Os identificadores do Twin que um vínculo poderia designar. */
export function candidateIds(binding: DocumentationBinding): string[] {
	switch (binding.entityType) {
		case 'api':
			return [twinId.endpoint(binding.entityId)];
		case 'schema':
			return [twinId.schema(binding.entityId)];
		case 'service':
		case 'function':
		case 'class':
			// Serviço, função e classe vivem no código; o Twin os conhece pelo
			// arquivo. `src/lib/pay.ts#create` designa o arquivo.
			return [twinId.code(binding.entityId.split('#')[0])];
		case 'cli':
			return [twinId.code(`scripts/${binding.entityId}.ts`), twinId.code(binding.entityId)];
		case 'event':
			return [twinId.endpoint(binding.entityId), twinId.schema(binding.entityId)];
		default:
			return [binding.entityId];
	}
}

// ---------------------------------------------------------------------------
// Índice
// ---------------------------------------------------------------------------

export interface BindingIndex {
	/** Todos os vínculos, já resolvidos. */
	bindings: ResolvedBinding[];
	/** Entidade → páginas que a documentam. */
	byEntity: Map<string, string[]>;
	/** Página → entidades que ela documenta. */
	byPage: Map<string, ResolvedBinding[]>;
}

export function indexBindings(bindings: readonly ResolvedBinding[]): BindingIndex {
	const byEntity = new Map<string, string[]>();
	const byPage = new Map<string, ResolvedBinding[]>();

	for (const binding of bindings) {
		const pages = byEntity.get(binding.entityId) ?? [];
		if (!pages.includes(binding.documentationId)) pages.push(binding.documentationId);
		byEntity.set(binding.entityId, pages);

		const entities = byPage.get(binding.documentationId) ?? [];
		entities.push(binding);
		byPage.set(binding.documentationId, entities);
	}

	return { bindings: [...bindings], byEntity, byPage };
}
