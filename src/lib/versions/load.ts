/**
 * Leitura do registro em disco.
 *
 * Separado do `registry.ts` para que a interpretação continue pura: os testes
 * exercitam o parser sem tocar o sistema de arquivos, e o `astro.config.mjs`
 * chama esta função uma vez no build.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { parseRegistry, type VersionRegistry } from './registry';

export const REGISTRY_FILE = 'versions.yml';

/** Registro vazio: o portal sem versionamento é o caso normal. */
const EMPTY: VersionRegistry = { versions: [], current: null, selectable: [] };

export function loadRegistry(root = process.cwd()): VersionRegistry {
	const file = path.resolve(root, REGISTRY_FILE);
	if (!existsSync(file)) return EMPTY;

	// Erro de leitura **não** é engolido: um registro inválido publicaria um
	// seletor que leva a 404, e é melhor derrubar o build.
	return parseRegistry(readFileSync(file, 'utf-8'));
}
