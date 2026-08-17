/**
 * Prepara `dist/client` para publicação no GitHub Pages.
 *
 *   npm run build:pages                  constrói e verifica
 *   npm run build:pages -- --verify-only só verifica (o build já rodou na CI)
 *
 * O script roda o `astro build` com `PORTAL_TARGET=pages` em vez de deixar isso
 * na linha de comando: `VAR=valor comando` não funciona no PowerShell, e o
 * projeto é desenvolvido no Windows.
 *
 * Depois do build, faz três coisas que ele não faz:
 *
 * **`.nojekyll`.** A Astro emite os assets em `_astro/`, e o Jekyll ignora
 * diretórios que começam com sublinhado. Sem esse arquivo o site sobe sem CSS
 * nem JavaScript — e a página parece "quase funcionando", o que atrasa o
 * diagnóstico.
 *
 * **`404.html`.** A Astro já gera a página; o Pages a serve automaticamente para
 * caminho inexistente. A verificação existe para o dia em que ela sumir.
 *
 * **Conferência do que foi publicado.** Nenhum artefato do servidor pode ir para
 * um servidor de arquivos: se `dist/client` contiver rota de API, alguém trocou o
 * modo de build e o resultado seria um endpoint publicado como texto.
 *
 * Códigos de saída: 0 ok · 1 conteúdo inesperado no pacote · 2 build ausente.
 */

import { access, readdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const CLIENT_DIR = path.resolve(process.cwd(), 'dist/client');

const EXIT_OK = 0;
const EXIT_UNEXPECTED = 1;
const EXIT_NO_BUILD = 2;

async function exists(target: string): Promise<boolean> {
	try {
		await access(target);
		return true;
	} catch {
		return false;
	}
}

async function countFiles(dir: string): Promise<number> {
	let total = 0;
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		total += entry.isDirectory() ? await countFiles(path.join(dir, entry.name)) : 1;
	}
	return total;
}

/** Roda `astro build` com o alvo estático marcado. */
function runBuild(): boolean {
	console.log('\n  astro build  (PORTAL_TARGET=pages)\n');
	// Comando numa única string: com `shell: true` e lista de argumentos, o Node
	// avisa que os argumentos não são escapados. Aqui eles são literais nossos,
	// mas a forma sem lista é a que não carrega a ressalva.
	const result = spawnSync('npx astro build', {
		stdio: 'inherit',
		shell: true,
		env: { ...process.env, PORTAL_TARGET: 'pages' },
	});
	return result.status === 0;
}

async function main(): Promise<number> {
	if (!process.argv.includes('--verify-only') && !runBuild()) {
		console.error('\nO build falhou; nada a publicar.\n');
		return EXIT_NO_BUILD;
	}

	if (!(await exists(CLIENT_DIR))) {
		console.error('\nNão encontrei dist/client. Rode o build antes:');
		console.error('  PORTAL_TARGET=pages npm run build\n');
		return EXIT_NO_BUILD;
	}

	const problems: string[] = [];

	// Rota de API em pacote estático significa que o build saiu no modo errado.
	if (await exists(path.join(CLIENT_DIR, 'api/chat'))) {
		problems.push('dist/client contém rotas de API — o build não foi feito com PORTAL_TARGET=pages.');
	}

	const nojekyll = path.join(CLIENT_DIR, '.nojekyll');
	if (!(await exists(nojekyll))) {
		await writeFile(nojekyll, '', 'utf-8');
		console.log('  criado    .nojekyll  (o Jekyll ignoraria _astro/)');
	} else {
		console.log('  presente  .nojekyll');
	}

	for (const required of ['index.html', '404.html', 'pagefind', '_astro']) {
		const target = path.join(CLIENT_DIR, required);
		if (await exists(target)) {
			console.log(`  presente  ${required}`);
		} else {
			problems.push(`faltando em dist/client: ${required}`);
		}
	}

	console.log(`\n  ${await countFiles(CLIENT_DIR)} arquivos prontos em dist/client\n`);

	if (problems.length > 0) {
		for (const problem of problems) console.error(`  erro  ${problem}`);
		console.error('');
		return EXIT_UNEXPECTED;
	}

	return EXIT_OK;
}

main().then(
	(code) => process.exit(code),
	(error) => {
		console.error(error);
		process.exit(EXIT_UNEXPECTED);
	}
);
