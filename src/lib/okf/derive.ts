/**
 * Tradução do conteúdo do portal para o vocabulário do OKF (issue #16).
 *
 * O diagnóstico que motivou este módulo: o portal **já sabe** quase tudo que o
 * OKF pede — título, descrição, tags, dono, quando a página foi revisada e por
 * quem, de quanto em quanto tempo ela vence. O que faltava era dizer isso no
 * vocabulário da spec. Nenhum campo aqui inventa informação; cada um aponta
 * para um campo que já existia no frontmatter ou no `governance.yml`.
 *
 * O mapa, campo a campo:
 *
 *   OKF                 vem de
 *   ------------------  --------------------------------------------------
 *   type                `type` explícito, ou derivado da pasta
 *   title               `title`
 *   description         `description`
 *   resource            URL pública da página
 *   tags                `tags`
 *   status              `governance.review.state` / `deprecated`
 *   verified[]          `governance.review.by` + `.at`
 *   stale_after         `review.at` + `review.interval`
 *   generated           este gerador, no momento da geração
 *   sources[]           o arquivo do repositório que originou o conceito
 *
 * O que **não** é traduzido, e por quê: `sidebar`, `hero` e `template` são
 * decisões de apresentação da Starlight. Um conceito OKF descreve conhecimento,
 * não em que ordem ele aparece num menu, e carregar isso para o bundle daria a
 * um consumidor externo campos que ele não tem como interpretar.
 */

import { stripMdxMachinery } from '../ai-readable/llms';
import { applyRules } from '../governance/config';
import { governanceFromFrontmatter } from '../governance/parse';
import { reviewStatus } from '../governance/review';
import type { GovernanceConfig, PageGovernance } from '../governance/types';
import type { SourceDocument } from './collect';
import { DEFAULT_LOCALE } from './collect';
import {
	humanActor,
	processActor,
	type OkfConcept,
	type OkfFrontmatter,
	type OkfSource,
	type OkfStatus,
	type OkfVerification,
} from './types';

/** Quem assina a geração, na convenção de ator da spec. */
export const GENERATOR_ACTOR = processActor('okf-export');

/**
 * Tipo por pasta.
 *
 * A spec não registra tipos centralmente — "type" é livre. Os nomes aqui são os
 * que o portal já usa para falar do próprio conteúdo, em inglês porque o bundle
 * é feito para ser consumido fora daqui e `type` é uma chave, não texto de
 * interface.
 */
const TYPE_BY_SECTION: Record<string, string> = {
	guides: 'Guide',
	'api-reference': 'API Reference',
	changelog: 'Changelog',
	exemplos: 'Example',
	examples: 'Example',
	reference: 'Reference',
};

const TYPE_BY_COLLECTION: Record<SourceDocument['collection'], string> = {
	docs: 'Documentation Page',
	glossary: 'Glossary Term',
	snippets: 'Content Snippet',
};

/** Pasta de primeiro nível, já descontado o prefixo de idioma. */
export function sectionOf(relativePath: string, locale: string): string | null {
	const parts = relativePath.split('/');
	if (locale !== DEFAULT_LOCALE) parts.shift();
	return parts.length > 1 ? (parts[0] ?? null) : null;
}

/**
 * O `type` do conceito.
 *
 * Um `type` escrito à mão no frontmatter sempre vence. A derivação por pasta é
 * um padrão razoável, não uma imposição: quando ela erra — uma página de
 * runbook dentro de `guides/`, por exemplo — quem escreve corrige declarando o
 * tipo, sem precisar mexer no gerador.
 */
export function typeOf(document: SourceDocument): string {
	const declared = document.frontmatter.type;
	if (typeof declared === 'string' && declared.trim() !== '') return declared.trim();

	if (document.collection !== 'docs') return TYPE_BY_COLLECTION[document.collection];

	const section = sectionOf(document.relativePath, document.locale);
	return (section && TYPE_BY_SECTION[section]) ?? TYPE_BY_COLLECTION.docs;
}

/**
 * Caminho do conceito dentro do bundle.
 *
 * `.mdx` vira `.md` porque o OKF é markdown puro — o que sai daqui já passou
 * pelo `stripMdxMachinery`, então a extensão `.mdx` prometeria uma sintaxe que
 * o arquivo não tem mais.
 *
 * `index.mdx` da Starlight **não** entra como conceito: `index.md` é nome
 * reservado pela spec para o índice do diretório, e um conceito com esse nome
 * seria lido como listagem por qualquer consumidor conformante.
 */
export function bundlePathOf(document: SourceDocument): string | null {
	const base = document.relativePath.replace(/\.mdx?$/i, '');
	if (base === 'index' || base.endsWith('/index')) return null;

	const prefix =
		document.collection === 'docs'
			? ''
			: document.collection === 'glossary'
				? 'glossary/'
				: 'snippets/';

	return `${prefix}${base}.md`;
}

/** URL pública da página, na mesma regra que o `collectPages` já usa. */
export function routeOf(document: SourceDocument): string {
	if (document.collection !== 'docs') return '';
	const base = document.relativePath.replace(/\.mdx?$/i, '');
	return `/${base}/`.replace(/\/+/g, '/').replace(/\/index\/$/, '/');
}

/**
 * Ciclo de vida no vocabulário do OKF.
 *
 * O portal tem cinco estados de revisão; o OKF tem três. `in-review`,
 * `approved` e `published` viram todos `stable` porque, do ponto de vista de
 * quem consome o conhecimento, os três dizem a mesma coisa: o conteúdo vale.
 *
 * `review-required` **não** vira `deprecated`. Uma página vencida continua
 * correta até que alguém mostre o contrário; o que ela perdeu foi frescor, e
 * frescor se expressa em `stale_after`, não em status. Trocar os dois faria o
 * consumidor descartar conteúdo bom.
 */
export function statusOf(governance: PageGovernance, frontmatter: Record<string, unknown>): OkfStatus {
	if (frontmatter.deprecated === true) return 'deprecated';
	if (governance.state === 'draft') return 'draft';
	if (frontmatter.draft === true) return 'draft';
	return 'stable';
}

/**
 * As confirmações registradas.
 *
 * Só existe `verified` quando alguém **declarou** ter revisado. Derivar isso do
 * Git seria tentador e errado: um commit que conserta uma vírgula não é uma
 * revisão, e tratá-lo como tal daria ao conceito um nível de confiança
 * "human-reviewed" que ninguém concedeu.
 */
export function verificationsOf(governance: PageGovernance): OkfVerification[] {
	if (!governance.reviewedAt) return [];

	const at = new Date(governance.reviewedAt);
	if (Number.isNaN(at.getTime())) return [];

	// Só quem foi **nomeado** vira confirmação. Cair no dono da página quando
	// `review.by` está ausente escreveria `human:documentation` — um time no
	// lugar onde a spec espera uma pessoa, e é desse prefixo que o consumidor
	// deriva "revisado por humano". A página fica sem `verified`, que é o que de
	// fato se sabe: houve revisão, ninguém assinou. O dono continua declarado no
	// campo `owner`.
	const who = governance.reviewedBy;
	if (!who) return [];

	return [{ by: humanActor(who), at: at.toISOString() }];
}

/**
 * Quando o conteúdo vence, pela regra de revisão que já governa a página.
 *
 * Passa pelo `reviewStatus` de sempre em vez de somar dias aqui: o intervalo
 * pode vir da página ou de uma regra do `governance.yml`, e recalcular isso por
 * fora produziria um `stale_after` que discorda do painel de governança sobre a
 * mesma página.
 */
export function staleAfterOf(
	governance: PageGovernance,
	config: GovernanceConfig,
	now: number
): string | undefined {
	const status = reviewStatus({
		page: governance,
		config,
		intervalDays: governance.reviewIntervalDays,
		now,
	});
	return status.dueAt ?? undefined;
}

/**
 * Um documento do portal como conceito OKF.
 *
 * `null` quando o documento não vira conceito — índices da Starlight, que a
 * spec reserva para listagem de diretório.
 */
export interface DeriveOptions {
	siteUrl: string;
	/** Momento da geração, para `generated.at` e para o cálculo de vencimento. */
	now: number;
	/** O mesmo `governance.yml` que o resto do portal lê. */
	config: GovernanceConfig;
	/** Traduções conhecidas do mesmo conceito, por idioma. */
	translations?: Record<string, string>;
}

export function toConcept(document: SourceDocument, options: DeriveOptions): OkfConcept | null {
	const bundlePath = bundlePathOf(document);
	if (!bundlePath) return null;

	const frontmatter = document.frontmatter;
	// `applyRules` resolve o que a página não declarou mas o `governance.yml`
	// impõe — dono e intervalo herdados. Sem isso, uma página governada por regra
	// sairia do bundle como se ninguém respondesse por ela.
	const governance = applyRules(
		governanceFromFrontmatter(document.relativePath, frontmatter),
		options.config
	);

	const title =
		asText(frontmatter.title) ??
		asText(frontmatter.term) ??
		bundlePath.replace(/\.md$/, '').split('/').pop() ??
		bundlePath;

	const route = routeOf(document);
	const source: OkfSource = {
		id: 'repo',
		resource: document.repoPath,
		title: `${document.repoPath} no repositório`,
		last_modified: document.modifiedAt,
	};
	// Mesmo cuidado do `verified`: `human:` identifica pessoa. Um time dono não
	// entra aqui — ele já viaja em `owner`, onde o tipo vai junto e ninguém
	// confunde os dois.
	if (governance.owner?.type === 'user') source.author = humanActor(governance.owner.id);

	const extensions: Record<string, unknown> = {};
	if (governance.owner) {
		extensions.owner = { type: governance.owner.type, id: governance.owner.id };
	}
	const audiences = asStringArray(frontmatter.audiences);
	if (audiences.length > 0) extensions.audiences = audiences;
	const products = asStringArray(frontmatter.products);
	if (products.length > 0) extensions.products = products;
	const aliases = asStringArray(frontmatter.aliases);
	if (aliases.length > 0) extensions.aliases = aliases;
	if (document.locale !== DEFAULT_LOCALE) extensions.language = document.locale;
	if (options.translations && Object.keys(options.translations).length > 0) {
		extensions.translations = options.translations;
	}

	const okfFrontmatter: OkfFrontmatter = {
		type: typeOf(document),
		title,
		description: asText(frontmatter.description),
		resource: route === '' ? undefined : `${options.siteUrl.replace(/\/$/, '')}${route}`,
		tags: asStringArray(frontmatter.tags),
		status: statusOf(governance, frontmatter),
		generated: { by: GENERATOR_ACTOR, at: new Date(options.now).toISOString() },
		verified: verificationsOf(governance),
		stale_after: staleAfterOf(governance, options.config, options.now),
		sources: [source],
		extensions,
	};

	return {
		path: bundlePath,
		frontmatter: okfFrontmatter,
		body: stripMdxMachinery(document.body),
	};
}

function asText(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] {
	if (typeof value === 'string') return [value];
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is string => typeof item === 'string');
}
