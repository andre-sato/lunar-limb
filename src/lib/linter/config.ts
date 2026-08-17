/**
 * Style guide configurável (§39, §40).
 *
 * As regras não trazem o style guide embutido: severidade, limiares,
 * terminologia e termos proibidos vêm daqui. O arquivo padrão fica em
 * `styles/default.yaml`, versionado em Git como o resto do projeto, e cada
 * página pode escolher um profile pelo frontmatter.
 *
 * Há um padrão embutido no código porque o linter precisa funcionar num
 * projeto que ainda não criou nenhum `styles/*.yaml` — sem isso, a primeira
 * execução falharia em vez de dar um resultado útil.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import type { LintLanguage, Severity } from './types';

export interface RuleOverride {
	enabled?: boolean;
	severity?: Severity;
	weight?: number;
}

export interface TerminologyEntry {
	term: string;
	alternatives: string[];
}

export interface Thresholds {
	maxSentenceWords: number;
	maxParagraphWords: number;
	maxHeadingWords: number;
	/** Frases longas toleradas antes de a regra reclamar do documento. */
	longSentenceRatio: number;
}

export interface QualityGateConfig {
	enabled: boolean;
	minimumScore: number;
	failOnErrors: boolean;
}

export interface ScoreBand {
	min: number;
	label: string;
}

/** Listas que podem ser globais (array) ou por idioma (objeto). */
type PerLanguage<T> = T[] | Partial<Record<LintLanguage, T[]>>;

export interface RawConfig {
	enabled?: boolean;
	extends?: string;
	rules?: Record<string, RuleOverride>;
	thresholds?: Partial<Thresholds>;
	terminology?: { preferred?: TerminologyEntry[] } | TerminologyEntry[];
	forbiddenTerms?: PerLanguage<string>;
	acronyms?: Record<string, string>;
	qualityGate?: Partial<QualityGateConfig>;
	bands?: ScoreBand[];
	weights?: Partial<Record<string, number>>;
}

export interface ResolvedConfig {
	profile: string;
	enabled: boolean;
	rules: Record<string, RuleOverride>;
	thresholds: Thresholds;
	terminology: TerminologyEntry[];
	forbiddenTerms: Record<LintLanguage, string[]>;
	acronyms: Record<string, string>;
	qualityGate: QualityGateConfig;
	bands: ScoreBand[];
	categoryWeights: Record<string, number>;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
	maxSentenceWords: 35,
	maxParagraphWords: 120,
	maxHeadingWords: 12,
	longSentenceRatio: 0.25,
};

/** Pesos do §46. Somam 1.0. */
export const DEFAULT_CATEGORY_WEIGHTS: Record<string, number> = {
	grammar: 0.15,
	clarity: 0.15,
	conciseness: 0.1,
	structure: 0.15,
	technicalWriting: 0.15,
	consistency: 0.1,
	actionability: 0.1,
	terminology: 0.05,
	readability: 0.05,
	// A completude entra na nota pelo peso das penalidades, não como fatia
	// própria: seções em branco e TODOs são erros graves, não uma dimensão
	// editorial paralela.
	completeness: 0,
};

export const DEFAULT_BANDS: ScoreBand[] = [
	{ min: 9, label: 'Excelente' },
	{ min: 8, label: 'Bom' },
	{ min: 7, label: 'Precisa melhorar' },
	{ min: 5, label: 'Fraco' },
	{ min: 0, label: 'Crítico' },
];

const DEFAULT_FORBIDDEN: Record<LintLanguage, string[]> = {
	'pt-BR': ['simplesmente', 'obviamente', 'claramente', 'facilmente', 'basta'],
	en: ['simply', 'just', 'obviously', 'easily', 'clearly'],
	es: ['simplemente', 'obviamente', 'fácilmente', 'basta'],
};

const DEFAULT_ACRONYMS: Record<string, string> = {
	API: 'Application Programming Interface',
	SDK: 'Software Development Kit',
	SSO: 'Single Sign-On',
	URL: 'Uniform Resource Locator',
	HTTP: 'Hypertext Transfer Protocol',
	HTTPS: 'Hypertext Transfer Protocol Secure',
	JSON: 'JavaScript Object Notation',
	REST: 'Representational State Transfer',
	CLI: 'Command-Line Interface',
	CI: 'Continuous Integration',
	MDX: 'Markdown + JSX',
	YAML: 'YAML Ain’t Markup Language',
	UUID: 'Universally Unique Identifier',
	SLA: 'Service Level Agreement',
};

export const DEFAULT_CONFIG: ResolvedConfig = {
	profile: 'default',
	enabled: true,
	rules: {},
	thresholds: DEFAULT_THRESHOLDS,
	terminology: [],
	forbiddenTerms: DEFAULT_FORBIDDEN,
	acronyms: DEFAULT_ACRONYMS,
	qualityGate: { enabled: true, minimumScore: 8, failOnErrors: true },
	bands: DEFAULT_BANDS,
	categoryWeights: DEFAULT_CATEGORY_WEIGHTS,
};

function normalizePerLanguage(value: PerLanguage<string> | undefined): Record<LintLanguage, string[]> | null {
	if (!value) return null;
	if (Array.isArray(value)) {
		// Lista única: vale para todos os idiomas.
		return { 'pt-BR': value, en: value, es: value };
	}
	return {
		'pt-BR': value['pt-BR'] ?? [],
		en: value.en ?? [],
		es: value.es ?? [],
	};
}

function normalizeTerminology(value: RawConfig['terminology']): TerminologyEntry[] | null {
	if (!value) return null;
	const list = Array.isArray(value) ? value : (value.preferred ?? []);
	return list
		.filter((entry) => entry && typeof entry.term === 'string')
		.map((entry) => ({
			term: entry.term,
			alternatives: Array.isArray(entry.alternatives) ? entry.alternatives.filter((a) => typeof a === 'string') : [],
		}));
}

export function mergeConfig(base: ResolvedConfig, raw: RawConfig, profile: string): ResolvedConfig {
	const forbidden = normalizePerLanguage(raw.forbiddenTerms);
	const terminology = normalizeTerminology(raw.terminology);

	// O YAML pode trazer um peso nulo ou ausente; espalhá-lo direto deixaria
	// `undefined` no mapa e o cálculo do score somaria NaN.
	const weights: Record<string, number> = { ...base.categoryWeights };
	for (const [category, value] of Object.entries(raw.weights ?? {})) {
		if (typeof value === 'number' && Number.isFinite(value)) weights[category] = value;
	}

	return {
		profile,
		enabled: raw.enabled ?? base.enabled,
		rules: { ...base.rules, ...(raw.rules ?? {}) },
		thresholds: { ...base.thresholds, ...(raw.thresholds ?? {}) },
		terminology: terminology ?? base.terminology,
		forbiddenTerms: forbidden ?? base.forbiddenTerms,
		acronyms: { ...base.acronyms, ...(raw.acronyms ?? {}) },
		qualityGate: { ...base.qualityGate, ...(raw.qualityGate ?? {}) },
		bands: raw.bands && raw.bands.length > 0 ? [...raw.bands].sort((a, b) => b.min - a.min) : base.bands,
		categoryWeights: weights,
	};
}

// ---------------------------------------------------------------------------
// Carregamento
// ---------------------------------------------------------------------------

const STYLES_DIR = path.resolve(process.cwd(), 'styles');

/** Impede que um nome de profile escape do diretório de estilos. */
function isSafeProfileName(name: string): boolean {
	return /^[a-zA-Z0-9_-]+$/.test(name);
}

async function readProfileFile(profile: string): Promise<RawConfig | null> {
	if (!isSafeProfileName(profile)) return null;
	try {
		const raw = await readFile(path.join(STYLES_DIR, `${profile}.yaml`), 'utf8');
		const parsed = yaml.load(raw);
		if (!parsed || typeof parsed !== 'object') return null;
		// Aceita tanto o arquivo com raiz `linter:` quanto direto na raiz.
		const record = parsed as Record<string, unknown>;
		const inner = record.linter;
		return (inner && typeof inner === 'object' ? inner : record) as RawConfig;
	} catch {
		return null;
	}
}

export async function listProfiles(): Promise<string[]> {
	try {
		const entries = await readdir(STYLES_DIR);
		return entries
			.filter((name) => name.endsWith('.yaml') || name.endsWith('.yml'))
			.map((name) => name.replace(/\.ya?ml$/, ''))
			.sort();
	} catch {
		return [];
	}
}

const cache = new Map<string, ResolvedConfig>();

export function invalidateConfigCache(): void {
	cache.clear();
}

/**
 * Resolve um profile, seguindo `extends` em cadeia.
 *
 * O limite de profundidade evita laço infinito se dois profiles se estenderem
 * mutuamente — um erro de configuração não deve travar o processo.
 */
export async function loadConfig(profile = 'default'): Promise<ResolvedConfig> {
	const cached = cache.get(profile);
	if (cached) return cached;

	const chain: RawConfig[] = [];
	const seen = new Set<string>();
	let current = profile;

	for (let depth = 0; depth < 8; depth++) {
		if (seen.has(current)) break;
		seen.add(current);

		const raw = await readProfileFile(current);
		if (!raw) break;
		chain.unshift(raw);

		if (typeof raw.extends !== 'string') break;
		current = raw.extends;
	}

	// `default` sempre é a base, mesmo quando o profile não o estende.
	if (profile !== 'default' && !seen.has('default')) {
		const base = await readProfileFile('default');
		if (base) chain.unshift(base);
	}

	let resolved: ResolvedConfig = { ...DEFAULT_CONFIG, profile };
	for (const raw of chain) resolved = mergeConfig(resolved, raw, profile);

	cache.set(profile, resolved);
	return resolved;
}

/** Severidade e habilitação efetivas de uma regra. */
export function ruleSettings(
	config: ResolvedConfig,
	ruleId: string,
	fallbackSeverity: Severity,
	fallbackWeight: number
): { enabled: boolean; severity: Severity; weight: number } {
	const override = config.rules[ruleId] ?? {};
	return {
		enabled: override.enabled !== false,
		severity: override.severity ?? fallbackSeverity,
		weight: override.weight ?? fallbackWeight,
	};
}
