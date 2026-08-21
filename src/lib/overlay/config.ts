/**
 * Leitura do `overlays.yml` (spec § 15, § 32, § 39).
 *
 * Uma **API View** é a abstração que este projeto põe acima do padrão: um nome
 * e a lista ordenada de overlays que a produzem. O padrão OpenAPI Overlay não
 * tem esse conceito — ele descreve um arquivo de transformação, não uma coleção
 * nomeada de transformações — e é essa camada que permite `--view public`
 * significar a mesma coisa na documentação, no SDK e nos testes.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { BASE_VIEW, DEFAULT_CONFIG, type ApiView, type OverlayConfig } from './types';

const CONFIG_FILE = path.resolve(process.cwd(), 'overlays.yml');

type Json = Record<string, unknown>;

export async function loadOverlayConfig(): Promise<OverlayConfig> {
	let parsed: Json | null | undefined;

	try {
		parsed = yaml.load(await readFile(CONFIG_FILE, 'utf-8')) as Json;
	} catch {
		// Sem arquivo, a feature fica desligada e o portal segue lendo a
		// especificação como sempre leu. Uma camada de transformação que se liga
		// sozinha mudaria silenciosamente o que o portal publica.
		return DEFAULT_CONFIG;
	}

	if (!parsed) return DEFAULT_CONFIG;

	const api = (parsed.api ?? {}) as Json;
	const overlays = (parsed.overlays ?? {}) as Json;
	const validation = (overlays.validation ?? {}) as Json;

	const rawViews = (overlays.views ?? api.views ?? {}) as Json;
	const views: ApiView[] = Object.entries(rawViews)
		.map(([name, value]) => {
			const entry = (value ?? {}) as Json;
			const files = Array.isArray(entry.overlays)
				? entry.overlays.filter((file): file is string => typeof file === 'string')
				: [];

			return {
				name,
				overlays: files,
				description: typeof entry.description === 'string' ? entry.description : undefined,
			};
		})
		// View sem overlay nenhum é igual à base, e listá-la faria o seletor do
		// Explorer oferecer duas opções que produzem o mesmo documento.
		.filter((view) => view.overlays.length > 0 && view.name !== BASE_VIEW);

	const boolean = (value: unknown, fallback: boolean) =>
		typeof value === 'boolean' ? value : fallback;

	return {
		specification:
			typeof api.specification === 'string' ? api.specification : DEFAULT_CONFIG.specification,
		enabled: boolean(overlays.enabled, views.length > 0),
		views,
		outputDir: typeof overlays.outputDir === 'string' ? overlays.outputDir : DEFAULT_CONFIG.outputDir,
		failOnUnmatchedTarget: boolean(
			validation.failOnUnmatchedTarget,
			DEFAULT_CONFIG.failOnUnmatchedTarget
		),
		failOnConflict: boolean(validation.failOnConflict, DEFAULT_CONFIG.failOnConflict),
		requireGovernance: boolean(validation.requireGovernance, DEFAULT_CONFIG.requireGovernance),
	};
}

/**
 * Recusa caminho que escape do projeto (spec § 41).
 *
 * Um overlay é um arquivo de configuração que diz ao motor quais arquivos ler.
 * Sem esta checagem, `../../.ssh/id_rsa` em `overlays:` faria o build tentar
 * carregá-lo — e a mensagem de erro publicaria parte do conteúdo.
 */
export function resolveOverlayPath(file: string): string {
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(file)) {
		throw new Error(
			`Overlay remoto recusado: \`${file}\`. Só caminhos locais dentro do projeto são carregados — um build que busca transformação de contrato na rede depende de algo que ninguém revisou.`
		);
	}

	const root = path.resolve(process.cwd());
	const resolved = path.resolve(root, file);

	if (resolved !== root && !resolved.startsWith(root + path.sep)) {
		throw new Error(`Overlay fora do projeto recusado: \`${file}\`.`);
	}

	return resolved;
}
