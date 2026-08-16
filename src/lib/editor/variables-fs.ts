import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeVariables, type VariableMap } from '../content/variables';

/**
 * Fase 5 — leitura/escrita das variáveis de conteúdo em runtime.
 *
 * O site publicado importa `content-variables.json` estaticamente (as variáveis
 * são resolvidas em build time). O editor precisa da versão *atual* do arquivo a
 * cada request — daí esta camada separada, que lê do disco.
 */

const VARIABLES_PATH = path.join(process.cwd(), 'src', 'config', 'content-variables.json');

export async function readVariables(): Promise<VariableMap> {
	try {
		const raw = await readFile(VARIABLES_PATH, 'utf-8');
		return normalizeVariables(JSON.parse(raw));
	} catch {
		// Arquivo ausente ou JSON inválido: tratar como "nenhuma variável
		// definida" em vez de derrubar o preview inteiro.
		return {};
	}
}

export async function writeVariables(variables: VariableMap): Promise<void> {
	// Reescreve o arquivo inteiro em ordem alfabética, para que o diff no Git
	// mostre só a variável que mudou, e não uma reordenação.
	const ordered: VariableMap = {};
	for (const name of Object.keys(variables).sort()) {
		ordered[name] = variables[name];
	}
	await writeFile(VARIABLES_PATH, `${JSON.stringify(ordered, null, 2)}\n`, 'utf-8');
}

export { VARIABLES_PATH };
