/**
 * Gera páginas de referência a partir de especificações AsyncAPI.
 *
 *   npm run docs:asyncapi              gera para todos os arquivos encontrados
 *   npm run docs:asyncapi -- --check   falha se a página gerada estiver desatualizada
 *
 * Lê `src/schemas/*.asyncapi.{yaml,yml,json}` e escreve em
 * `src/content/docs/api-reference/`. O `--check` serve para CI: garante que
 * ninguém editou a página gerada à mão nem mexeu na especificação sem regerar.
 *
 * Códigos de saída: 0 ok · 1 desatualizado (--check) · 2 documento inválido.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AsyncApiError, generateReferencePage, parseAsyncApi } from '../src/lib/asyncapi/generate';

const SCHEMAS_DIR = path.resolve(process.cwd(), 'src/schemas');
const OUTPUT_DIR = path.resolve(process.cwd(), 'src/content/docs/api-reference');

const EXIT_OK = 0;
const EXIT_OUTDATED = 1;
const EXIT_INVALID = 2;

/** Reconhece pelo nome quais arquivos são AsyncAPI. */
const ASYNCAPI_FILE = /\.asyncapi\.(ya?ml|json)$/i;

function outputNameFor(file: string): string {
	return `${file.replace(ASYNCAPI_FILE, '')}.md`;
}

async function main(): Promise<number> {
	const check = process.argv.includes('--check');

	let files: string[];
	try {
		files = (await readdir(SCHEMAS_DIR)).filter((file) => ASYNCAPI_FILE.test(file)).sort();
	} catch {
		console.log('Nenhum diretório src/schemas — nada a gerar.');
		return EXIT_OK;
	}

	if (files.length === 0) {
		console.log('Nenhuma especificação AsyncAPI em src/schemas — nada a gerar.');
		return EXIT_OK;
	}

	let outdated = 0;

	for (const file of files) {
		const sourcePath = path.join(SCHEMAS_DIR, file);
		const raw = await readFile(sourcePath, 'utf-8');

		let page: string;
		try {
			const document = parseAsyncApi(raw);
			page = generateReferencePage(document, {
				sourcePath: `src/schemas/${file}`,
				// Depois das páginas escritas à mão da referência.
				sidebarOrder: 10,
				// `eventos` porque AsyncAPI descreve canais e mensagens, não rotas
				// HTTP — é o que separa esta referência da de uma API REST.
				tags: ['api', 'eventos'],
			});
		} catch (error) {
			if (error instanceof AsyncApiError) {
				console.error(`\n${file}: ${error.message}\n`);
				return EXIT_INVALID;
			}
			throw error;
		}

		const target = path.join(OUTPUT_DIR, outputNameFor(file));
		const existing = await readFile(target, 'utf-8').catch(() => null);

		if (existing === page) {
			console.log(`  sem alteração  ${path.relative(process.cwd(), target)}`);
			continue;
		}

		if (check) {
			outdated++;
			console.error(
				`  desatualizado  ${path.relative(process.cwd(), target)} — rode \`npm run docs:asyncapi\``
			);
			continue;
		}

		await writeFile(target, page, 'utf-8');
		console.log(`  ${existing === null ? 'criado        ' : 'atualizado    '} ${path.relative(process.cwd(), target)}`);
	}

	return outdated > 0 ? EXIT_OUTDATED : EXIT_OK;
}

main().then(
	(code) => process.exit(code),
	(error) => {
		console.error(error);
		process.exit(EXIT_INVALID);
	}
);
