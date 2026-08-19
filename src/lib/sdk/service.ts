/**
 * `SdkService` (§13, §14, §20, §24).
 *
 * A camada que toca disco e Git. Ela lê a especificação com `parseOpenApi()` — o
 * mesmo parser do Explorer, dos contratos e do Twin — monta o modelo
 * intermediário e chama o renderer da linguagem.
 *
 * **Local-first** (§24): nada aqui vai à rede. Gerar um SDK não depende de
 * serviço externo, e é isso que diferencia o fluxo de uma plataforma de geração
 * gerenciada.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { parseOpenApi, type ApiModel } from '../api-explorer/model';
import { buildSdkSpecification } from './build';
import { typescriptRenderer } from './typescript';
import { DEFAULT_SDK_CONFIG, type GeneratedFile, type GeneratorConfig, type SdkConfig, type SdkRenderer, type SdkSpecification } from './types';

const run = promisify(execFile);
const ROOT = process.cwd();
const CONFIG_FILE = path.resolve(ROOT, 'sdk.yml');

/**
 * Os renderers disponíveis.
 *
 * Acrescentar Python é acrescentar uma entrada aqui e um arquivo ao lado de
 * `typescript.ts` — nada em `build.ts` muda, que é o ponto da §22.
 */
export const RENDERERS: Record<string, SdkRenderer> = {
	typescript: typescriptRenderer,
};

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

export async function loadSdkConfig(): Promise<SdkConfig> {
	let parsed: Record<string, any> | null | undefined;

	try {
		parsed = yaml.load(await readFile(CONFIG_FILE, 'utf-8')) as Record<string, any>;
	} catch {
		return DEFAULT_SDK_CONFIG;
	}

	const block = (parsed?.sdk ?? parsed ?? {}) as Record<string, any>;
	const generators: Record<string, GeneratorConfig> = {};

	for (const [language, value] of Object.entries<any>(block.generators ?? {})) {
		if (!RENDERERS[language]) continue;

		generators[language] = {
			enabled: value?.enabled !== false,
			output: typeof value?.output === 'string' ? value.output : `generated/${language}`,
			packageName: typeof value?.packageName === 'string' ? value.packageName : DEFAULT_SDK_CONFIG.generators.typescript.packageName,
			version: typeof value?.version === 'string' ? value.version : 'api',
		};
	}

	return {
		spec: typeof block.spec === 'string' ? block.spec : DEFAULT_SDK_CONFIG.spec,
		generators: Object.keys(generators).length > 0 ? generators : DEFAULT_SDK_CONFIG.generators,
		failOnStale: block.failOnStale !== false,
	};
}

// ---------------------------------------------------------------------------
// Leitura da especificação
// ---------------------------------------------------------------------------

export async function readApiModel(config: SdkConfig): Promise<ApiModel> {
	const raw = await readFile(path.resolve(ROOT, config.spec), 'utf-8');
	return parseOpenApi(raw);
}

/** A mesma especificação num ponto anterior do histórico, para o diff. */
export async function readApiModelAt(config: SdkConfig, ref: string): Promise<ApiModel | null> {
	try {
		const { stdout } = await run('git', ['show', `${ref}:${config.spec}`], { cwd: ROOT, maxBuffer: 16 * 1024 * 1024 });
		return parseOpenApi(stdout);
	} catch {
		return null;
	}
}

export function specificationFor(model: ApiModel, generator: GeneratorConfig): SdkSpecification {
	return buildSdkSpecification(model, {
		packageName: generator.packageName,
		// `api` amarra a versão do SDK à da API, que é o que permite dizer
		// "SDK 2.4.0 corresponde a API 2.4.0" sem manter dois números à mão (§21).
		version: generator.version === 'api' ? model.version || '0.0.0' : generator.version,
	});
}

// ---------------------------------------------------------------------------
// Geração
// ---------------------------------------------------------------------------

export interface GenerateResult {
	language: string;
	output: string;
	files: GeneratedFile[];
	specification: SdkSpecification;
	/** Arquivos que mudariam em relação ao que está em disco. */
	changed: string[];
	/** Arquivos em disco que a geração não produz mais. */
	orphaned: string[];
	written: boolean;
}

async function existingFiles(root: string): Promise<Map<string, string>> {
	const found = new Map<string, string>();

	async function walk(dir: string, base = ''): Promise<void> {
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			// `node_modules` e `dist` são produto de build de quem consome o SDK, não
			// da geração: apagá-los seria destruir trabalho que não é nosso.
			if (entry.name === 'node_modules' || entry.name === 'dist') continue;

			const relative = base ? `${base}/${entry.name}` : entry.name;
			if (entry.isDirectory()) await walk(path.join(dir, entry.name), relative);
			else found.set(relative, await readFile(path.join(dir, entry.name), 'utf-8').catch(() => ''));
		}
	}

	await walk(root);
	return found;
}

export interface GenerateOptions {
	/** `false` calcula tudo e não escreve — é o que o `check` usa. */
	write?: boolean;
	language?: string;
}

export async function generateSdk(options: GenerateOptions = {}): Promise<GenerateResult[]> {
	const config = await loadSdkConfig();
	const model = await readApiModel(config);
	const results: GenerateResult[] = [];

	for (const [language, generator] of Object.entries(config.generators)) {
		if (!generator.enabled) continue;
		if (options.language && options.language !== language) continue;

		const renderer = RENDERERS[language];
		if (!renderer) continue;

		const specification = specificationFor(model, generator);
		const files = renderer.render(specification);

		const outputRoot = path.resolve(ROOT, generator.output);
		const existing = await existingFiles(outputRoot);

		const changed = files.filter((file) => existing.get(file.path) !== file.contents).map((file) => file.path);
		const produced = new Set(files.map((file) => file.path));
		const orphaned = [...existing.keys()].filter((file) => !produced.has(file)).sort();

		if (options.write !== false) {
			for (const file of files) {
				const target = path.join(outputRoot, file.path);
				await mkdir(path.dirname(target), { recursive: true });
				await writeFile(target, file.contents, 'utf-8');
			}

			// Arquivo órfão é removido: um recurso que deixou de existir na
			// especificação continuaria compilando e exportando um caminho morto.
			for (const file of orphaned) await rm(path.join(outputRoot, file), { force: true });
		}

		results.push({
			language,
			output: generator.output,
			files,
			specification,
			changed,
			orphaned,
			written: options.write !== false,
		});
	}

	return results;
}
