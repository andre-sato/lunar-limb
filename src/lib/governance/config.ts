/**
 * Leitura do `governance.yml` (P3.1).
 *
 * A regra mais específica vence: `api-reference/` ganha de `` (o padrão), e a
 * página ganha de qualquer regra. Empatar por ordem de declaração faria a mesma
 * página mudar de dono conforme alguém reordenasse o arquivo.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { parseActor, parseInterval } from './parse';
import {
	DEFAULT_CONFIG,
	type ApprovalTrigger,
	type GovernanceConfig,
	type GovernanceRule,
	type PageGovernance,
	type Severity,
	type TeamDefinition,
} from './types';

const CONFIG_FILE = path.resolve(process.cwd(), 'governance.yml');
const TRIGGERS: readonly ApprovalTrigger[] = ['public-api', 'breaking-change', 'security-sensitive'];

function ruleFrom(raw: Record<string, unknown>, rulePath: string): GovernanceRule {
	return {
		path: rulePath,
		owner: parseActor(raw.owner),
		reviewer: parseActor(raw.reviewer),
		approver: parseActor(raw.approver),
		reviewIntervalDays: parseInterval((raw.review as Record<string, unknown>)?.interval ?? raw.interval),
	};
}

export async function loadGovernanceConfig(): Promise<GovernanceConfig> {
	let parsed: Record<string, unknown> | null | undefined;

	try {
		parsed = yaml.load(await readFile(CONFIG_FILE, 'utf-8')) as Record<string, unknown>;
	} catch {
		return DEFAULT_CONFIG;
	}

	const block = (parsed?.governance ?? parsed ?? {}) as Record<string, unknown>;

	const teams: TeamDefinition[] = Array.isArray(block.teams)
		? block.teams
				.map((entry) => {
					const record = (entry ?? {}) as Record<string, unknown>;
					const id = typeof record.id === 'string' ? record.id : undefined;
					if (!id) return null;
					const team: TeamDefinition = { id, label: typeof record.label === 'string' ? record.label : id };
					if (Array.isArray(record.members)) team.members = record.members.filter((m): m is string => typeof m === 'string');
					return team;
				})
				.filter((team): team is TeamDefinition => team !== null)
		: [];

	const rules: GovernanceRule[] = Array.isArray(block.rules)
		? block.rules
				.map((entry) => {
					const record = (entry ?? {}) as Record<string, unknown>;
					const rulePath = typeof record.path === 'string' ? record.path.replace(/^\/+|\/+$/g, '') : null;
					return rulePath === null ? null : ruleFrom(record, rulePath);
				})
				.filter((rule): rule is GovernanceRule => rule !== null)
		: [];

	const approval = (block.approval ?? {}) as Record<string, unknown>;
	const approvalRequiredFor = Array.isArray(approval.required)
		? approval.required.filter((entry): entry is ApprovalTrigger => TRIGGERS.includes(entry as ApprovalTrigger))
		: DEFAULT_CONFIG.approvalRequiredFor;

	const slaBlock = (block.sla ?? {}) as Record<string, unknown>;
	const sla = { ...DEFAULT_CONFIG.sla };
	for (const key of Object.keys(sla) as Severity[]) {
		const value = parseInterval(slaBlock[key]);
		if (value !== undefined) sla[key] = value;
	}

	return {
		teams,
		defaults: ruleFrom((block.defaults ?? {}) as Record<string, unknown>, ''),
		rules,
		approvalRequiredFor,
		sla,
		securitySensitive: Array.isArray(block.securitySensitive)
			? block.securitySensitive.filter((entry): entry is string => typeof entry === 'string')
			: [],
		failOnExpired: block.failOnExpired === true,
	};
}

/**
 * A regra que vale para um caminho: a de prefixo mais longo.
 *
 * Comparar por comprimento e não por ordem de declaração é o que garante que
 * `api-reference/authentication.md` obedeça à regra de `api-reference/` mesmo
 * que ela esteja escrita depois da regra geral.
 */
export function ruleFor(rules: readonly GovernanceRule[], pagePath: string): GovernanceRule | undefined {
	return rules
		.filter((rule) => rule.path === '' || pagePath === rule.path || pagePath.startsWith(`${rule.path}/`))
		.sort((a, b) => b.path.length - a.path.length)[0];
}

/**
 * Junta o que a página declara com o que a regra herda.
 *
 * A página sempre vence, e cada campo herdado registra **de onde veio**. Sem
 * essa marca, a tela mostraria um dono e ninguém saberia se alguém o escolheu
 * para aquela página ou se ele caiu de um padrão que vale para 200 páginas.
 */
export function applyRules(page: PageGovernance, config: GovernanceConfig): PageGovernance {
	const rule = ruleFor(config.rules, page.path);
	const merged: PageGovernance = { ...page, inherited: { ...page.inherited } };

	const inherit = <K extends 'owner' | 'reviewer' | 'approver'>(key: K) => {
		if (merged[key]) return;
		const fromRule = rule?.[key];
		const fromDefault = config.defaults[key];
		if (fromRule) {
			merged[key] = fromRule;
			merged.inherited[key] = rule!.path === '' ? 'padrão' : `regra \`${rule!.path}\``;
		} else if (fromDefault) {
			merged[key] = fromDefault;
			merged.inherited[key] = 'padrão';
		}
	};

	inherit('owner');
	inherit('reviewer');
	inherit('approver');

	if (merged.reviewIntervalDays === undefined) {
		const interval = rule?.reviewIntervalDays ?? config.defaults.reviewIntervalDays;
		if (interval !== undefined) {
			merged.reviewIntervalDays = interval;
			merged.inherited.interval = rule?.reviewIntervalDays !== undefined && rule.path !== '' ? `regra \`${rule.path}\`` : 'padrão';
		}
	}

	// Normaliza o time para o `id` declarado, e só então aplica o rótulo.
	//
	// Sem isto o mesmo time aparece duas vezes no relatório: as páginas antigas
	// escrevem `owner: Time de Documentação` (o rótulo), a regra do
	// `governance.yml` diz `documentation` (o id), e a lista de donos mostrou
	// "Time de Documentação — 38 páginas" e "Time de Documentação — 9 páginas"
	// como se fossem dois times diferentes.
	for (const key of ['owner', 'reviewer', 'approver'] as const) {
		const actor = merged[key];
		if (!actor || actor.type !== 'team') continue;
		const team = findTeam(config, actor.id);
		if (team) merged[key] = { type: 'team', id: team.id, label: team.label };
	}

	return merged;
}

/** Sem acento, sem caixa, sem espaços: `Time de Documentação` casa com `documentation`? Não — mas `Documentação` casa com `documentacao`. */
function fold(value: string): string {
	return value
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '');
}

/** O time, procurado pelo `id` e depois pelo rótulo — nessa ordem. */
export function findTeam(config: GovernanceConfig, id: string): TeamDefinition | undefined {
	return (
		config.teams.find((team) => team.id === id) ??
		config.teams.find((team) => fold(team.id) === fold(id) || fold(team.label) === fold(id))
	);
}

export function isSecuritySensitive(pagePath: string, config: GovernanceConfig): boolean {
	return config.securitySensitive.some((prefix) => pagePath === prefix || pagePath.startsWith(`${prefix.replace(/\/+$/, '')}/`));
}
