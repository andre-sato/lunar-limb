/**
 * Integração com o Do11y (https://docservable.com) — observabilidade de
 * documentação.
 *
 * O Do11y é um script sem dependências que captura eventos de engajamento
 * (page view, scroll, cópia de código, busca, feedback…) e os grava numa
 * tabela do Supabase. Ele detecta referrers de plataformas de IA, o que
 * permite comparar como agentes e pessoas usam a documentação.
 *
 * Há duas metades nesta integração:
 *
 *  1. **Coleta** — o script roda no portal publicado. A instalação oficial
 *     para Starlight põe as credenciais em `astro.config.mjs`, que é build
 *     time; aqui elas ficam em `data/integrations.json` para poderem ser
 *     alteradas pela tela de Settings sem rebuild. Ver `Head.astro`.
 *
 *  2. **Leitura** — o dashboard consulta o Supabase pelo servidor, com a
 *     chave `service_role`. Ver `do11y-query.ts`.
 *
 * Sobre as duas chaves, porque a distinção é o ponto sensível:
 *
 *  - a **publishable** é pública por design. Ela vai no HTML do portal para o
 *    script poder inserir eventos; a política de RLS só permite `insert`.
 *  - a **service_role** ignora RLS e lê tudo. Ela nunca sai do servidor: não
 *    é devolvida por nenhuma rota, nem para o admin autenticado.
 */

import { readJson, withFileLock, writeJson } from '../auth/store';

const FILE = 'integrations.json';

export interface Do11yConfig {
	enabled: boolean;
	/** URL do projeto Supabase, ex.: https://abc123.supabase.co */
	supabaseUrl: string;
	/** Chave publishable/anon — pública, usada pelo script no navegador. */
	supabaseKey: string;
	/** Chave service_role — SECRETA, só leitura no servidor. */
	serviceRoleKey: string;
	/** Tabela de destino. O padrão do Do11y é `do11y_events`. */
	table: string;
	/** Opções de comportamento repassadas ao script. */
	trackScrollDepth: boolean;
	trackSectionVisibility: boolean;
	trackOutboundLinks: boolean;
	trackInternalLinks: boolean;
	trackTocClicks: boolean;
	trackFeedback: boolean;
	respectDNT: boolean;
	debug: boolean;
	/** Versão do pacote no CDN. `latest` acompanha as atualizações. */
	scriptVersion: string;
}

export const DEFAULT_CONFIG: Do11yConfig = {
	enabled: false,
	supabaseUrl: '',
	supabaseKey: '',
	serviceRoleKey: '',
	table: 'do11y_events',
	trackScrollDepth: true,
	trackSectionVisibility: true,
	trackOutboundLinks: true,
	trackInternalLinks: true,
	trackTocClicks: true,
	trackFeedback: true,
	// O Do11y não usa cookies nem PII, mas respeitar Do Not Track é o padrão
	// dele e não há motivo para o portal ser menos conservador.
	respectDNT: true,
	debug: false,
	scriptVersion: 'latest',
};

interface IntegrationsFile {
	do11y?: Partial<Do11yConfig>;
}

function coerce(raw: Partial<Do11yConfig> | undefined): Do11yConfig {
	if (!raw) return { ...DEFAULT_CONFIG };
	const result = { ...DEFAULT_CONFIG };
	for (const key of Object.keys(DEFAULT_CONFIG) as Array<keyof Do11yConfig>) {
		const value = raw[key];
		if (value === undefined || value === null) continue;
		if (typeof DEFAULT_CONFIG[key] === 'boolean' && typeof value === 'boolean') {
			(result as Record<string, unknown>)[key] = value;
		} else if (typeof DEFAULT_CONFIG[key] === 'string' && typeof value === 'string') {
			(result as Record<string, unknown>)[key] = value;
		}
	}
	return result;
}

export async function loadDo11yConfig(): Promise<Do11yConfig> {
	const file = await readJson<IntegrationsFile>(FILE, {});
	const config = coerce(file.do11y);

	// Variáveis de ambiente têm precedência: é assim que se configura um
	// deploy sem depender de alguém abrir a tela depois de cada provisionamento.
	if (process.env.DO11Y_SUPABASE_URL) config.supabaseUrl = process.env.DO11Y_SUPABASE_URL;
	if (process.env.DO11Y_SUPABASE_KEY) config.supabaseKey = process.env.DO11Y_SUPABASE_KEY;
	if (process.env.DO11Y_SERVICE_ROLE_KEY) config.serviceRoleKey = process.env.DO11Y_SERVICE_ROLE_KEY;
	if (process.env.DO11Y_TABLE) config.table = process.env.DO11Y_TABLE;
	if (process.env.DO11Y_ENABLED) config.enabled = process.env.DO11Y_ENABLED === 'true';

	return config;
}

export async function saveDo11yConfig(patch: Partial<Do11yConfig>): Promise<Do11yConfig> {
	return withFileLock(FILE, async () => {
		const file = await readJson<IntegrationsFile>(FILE, {});
		const current = coerce(file.do11y);
		const next = coerce({ ...current, ...patch });
		await writeJson(FILE, { ...file, do11y: next });
		return next;
	});
}

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

export interface ValidationResult {
	ok: boolean;
	errors: string[];
}

/**
 * Exige HTTPS na URL do Supabase: a chave publishable viaja nessa conexão, e
 * um endpoint em texto claro entregaria os eventos a qualquer intermediário.
 */
export function validateConfig(config: Do11yConfig): ValidationResult {
	const errors: string[] = [];

	if (!config.enabled) return { ok: true, errors };

	if (!config.supabaseUrl.trim()) {
		errors.push('Informe a URL do projeto Supabase.');
	} else {
		let url: URL | null = null;
		try {
			url = new URL(config.supabaseUrl);
		} catch {
			errors.push('A URL do Supabase é inválida.');
		}
		if (url && url.protocol !== 'https:') errors.push('A URL do Supabase precisa usar HTTPS.');
	}

	if (!config.supabaseKey.trim()) errors.push('Informe a chave publishable do Supabase.');
	if (!config.serviceRoleKey.trim()) {
		errors.push('Informe a chave service_role — sem ela o dashboard não consegue ler os eventos.');
	}
	if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(config.table)) {
		errors.push('Nome de tabela inválido.');
	}

	return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Projeções
// ---------------------------------------------------------------------------

/** O que o navegador pode ver. A `service_role` jamais entra aqui. */
export interface Do11yClientConfig {
	enabled: boolean;
	scriptUrl: string;
	config: Record<string, unknown>;
}

export function toClientConfig(config: Do11yConfig): Do11yClientConfig {
	const usable = config.enabled && config.supabaseUrl.trim() !== '' && config.supabaseKey.trim() !== '';

	if (!usable) return { enabled: false, scriptUrl: '', config: {} };

	return {
		enabled: true,
		scriptUrl: `https://cdn.jsdelivr.net/npm/@manototh/do11y@${config.scriptVersion}/dist/do11y.min.js`,
		config: {
			destination: 'supabase',
			supabaseUrl: config.supabaseUrl,
			supabaseKey: config.supabaseKey,
			supabaseTable: config.table,
			framework: 'starlight',
			trackScrollDepth: config.trackScrollDepth,
			trackSectionVisibility: config.trackSectionVisibility,
			trackOutboundLinks: config.trackOutboundLinks,
			trackInternalLinks: config.trackInternalLinks,
			trackTocClicks: config.trackTocClicks,
			trackFeedback: config.trackFeedback,
			respectDNT: config.respectDNT,
			debug: config.debug,
		},
	};
}

/** O que a tela de administração recebe: segredos mascarados. */
export interface Do11yAdminView extends Omit<Do11yConfig, 'serviceRoleKey' | 'supabaseKey'> {
	supabaseKey: string;
	hasServiceRoleKey: boolean;
	serviceRoleKeyHint: string;
	managedByEnv: boolean;
}

export function toAdminView(config: Do11yConfig): Do11yAdminView {
	const { serviceRoleKey, ...rest } = config;

	return {
		...rest,
		// A publishable é pública (vai no HTML), então mostrá-la não vaza nada
		// que o visitante já não pudesse ler.
		supabaseKey: config.supabaseKey,
		hasServiceRoleKey: serviceRoleKey.trim() !== '',
		// Só os últimos caracteres, para confirmar *qual* chave está gravada
		// sem devolvê-la.
		serviceRoleKeyHint: serviceRoleKey.trim() === '' ? '' : `••••${serviceRoleKey.trim().slice(-4)}`,
		managedByEnv: Boolean(process.env.DO11Y_SERVICE_ROLE_KEY || process.env.DO11Y_SUPABASE_URL),
	};
}

/** SQL de criação da tabela, exibido na tela para copiar. */
export function schemaSql(table: string): string {
	return `create table ${table} (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  payload jsonb not null
);

alter table ${table} enable row level security;
grant insert on ${table} to anon;
grant select on ${table} to service_role;

create policy "Allow anonymous inserts"
  on ${table} for insert
  to anon
  with check (true);`;
}
