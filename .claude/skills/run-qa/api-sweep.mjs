#!/usr/bin/env node
/**
 * Varredura de robustez das rotas de API (issue #19).
 *
 * Sobe uma instância isolada, entra como administrador e bate em toda rota de
 * `src/pages/api` com corpos que um cliente quebrado (ou hostil) mandaria.
 * Procura uma coisa só: **500**. Um 400 é a rota recusando entrada ruim, que é
 * o trabalho dela; um 500 é a rota estourando, que nunca é.
 *
 * Foi assim que a rodada de bug hunt encontrou 18 endpoints devolvendo 500 —
 * incluindo `/api/auth/login`, que é público e anterior à autenticação. Os
 * corpos abaixo não são criativos de propósito: `null` e vazio acharam quase
 * tudo. O valor está em passar em **todas** as rotas, não em ser esperto.
 *
 *   node .claude/skills/run-qa/api-sweep.mjs                 sobe tudo sozinho
 *   node .claude/skills/run-qa/api-sweep.mjs --port 4330     usa servidor já no ar
 *   node .claude/skills/run-qa/api-sweep.mjs --json
 *
 * Saída: 0 nenhum 500 · 1 encontrou 500 · 3 erro de execução.
 */

import { spawn } from 'node:child_process';
import { readdir, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';

const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';

const DATA_DIR = '.verify-qa-sweep';
const EMAIL = 'qa-sweep@example.com';
// Credencial de instância descartável: os dados vivem em DATA_DIR, que é
// apagado no fim. Nunca aponte este script para uma instância real.
const PASSWORD = 'qa-sweep-local-only';

/**
 * Os corpos. Dois grupos, e o segundo é o que pega mais gente:
 *
 *   - inválidos de sintaxe: `request.json()` lança;
 *   - **válidos, mas não objeto**: `null`, `[]`, `"txt"`, `123`, `true` não
 *     lançam nada. A rota só descobre no `body.campo`, e aí é TypeError.
 */
const PAYLOADS = [
	['vazio', undefined],
	['nao-json', 'nao-e-json'],
	['null', 'null'],
	['lista', '[]'],
	['string', '"txt"'],
	['numero', '123'],
	['booleano', 'true'],
	['objeto-vazio', '{}'],
	// Estrutura certa, entrada podre: a lista existe, o item dentro dela não.
	['plano-com-null', '{"op":"replace-apply","plan":{"files":[null]}}'],
];

const METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

function arg(name, fallback = undefined) {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : fallback;
}

/** As rotas, tiradas do sistema de arquivos — não de uma lista que envelhece. */
async function discoverRoutes(root = 'src/pages/api') {
	const routes = [];

	async function visit(dir, prefix) {
		for (const entry of await readdir(dir, { withFileTypes: true })) {
			const absolute = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				await visit(absolute, `${prefix}/${entry.name}`);
			} else if (entry.name.endsWith('.ts')) {
				// Rota dinâmica precisaria de um id de verdade para dizer algo; sem
				// ele, o 404 esconderia justamente o 500 que se procura.
				if (entry.name.includes('[')) continue;
				const base = entry.name.replace(/\.ts$/, '');
				routes.push(base === 'index' ? prefix : `${prefix}/${base}`);
			}
		}
	}

	await visit(path.resolve(process.cwd(), root), '/api');
	return routes.sort();
}

async function waitFor(url, attempts = 60) {
	for (let i = 0; i < attempts; i++) {
		try {
			const response = await fetch(url);
			if (response.ok) return true;
		} catch {
			// Servidor ainda subindo.
		}
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
	return false;
}

async function main() {
	const json = process.argv.includes('--json');
	const existingPort = arg('--port');
	const port = existingPort ?? '4399';
	const base = `http://localhost:${port}`;

	let server = null;

	if (!existingPort) {
		await rm(DATA_DIR, { recursive: true, force: true });
		await mkdir(DATA_DIR, { recursive: true });

		server = spawn('npx', ['astro', 'dev', '--port', port], {
			env: {
				...process.env,
				PORTAL_DATA_DIR: DATA_DIR,
				PORTAL_ADMIN_EMAIL: EMAIL,
				PORTAL_ADMIN_PASSWORD: PASSWORD,
			},
			stdio: 'ignore',
			shell: process.platform === 'win32',
		});
	}

	try {
		if (!(await waitFor(`${base}/api/auth/me`))) {
			console.error(`Servidor não respondeu em ${base}.`);
			return 3;
		}

		// A sessão importa: sem ela o middleware devolve 401 antes de o handler
		// ver o corpo, e a varredura mediria a autorização em vez da robustez.
		const login = await fetch(`${base}/api/auth/login`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
		});

		const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
		if (!login.ok && !existingPort) {
			console.error('Falha ao autenticar na instância de varredura.');
			return 3;
		}

		const routes = await discoverRoutes();
		const findings = [];
		let requests = 0;

		for (const route of routes) {
			for (const [label, body] of PAYLOADS) {
				for (const method of METHODS) {
					requests++;
					let status = 0;
					let snippet = '';
					try {
						const response = await fetch(`${base}${route}`, {
							method,
							headers: {
								'content-type': 'application/json',
								cookie,
								// O Astro barra escrita sem `Origin` como se fosse formulário
								// de outro site; sem isto, DELETE nunca chega ao handler.
								origin: base,
							},
							body,
						});
						status = response.status;
						if (status === 500) snippet = (await response.text()).slice(0, 120);
					} catch (error) {
						snippet = error instanceof Error ? error.message : String(error);
					}

					if (status === 500) findings.push({ method, route, payload: label, snippet });
				}
			}
		}

		if (json) {
			console.log(JSON.stringify({ requests, routes: routes.length, findings }, null, 2));
		} else {
			console.log('');
			console.log(`${BOLD}Varredura de API${RESET}  ${routes.length} rotas · ${requests} requisições`);
			console.log('');
			if (findings.length === 0) {
				console.log(`  ${GREEN}nenhuma resposta 500${RESET}`);
			} else {
				console.log(`  ${RED}${findings.length} resposta(s) 500${RESET}`);
				for (const finding of findings) {
					console.log(`  ${RED}500${RESET} ${finding.method.padEnd(6)} ${finding.route}  ${DIM}${finding.payload}${RESET}`);
					console.log(`      ${DIM}${finding.snippet.replace(/\s+/g, ' ')}${RESET}`);
				}
			}
			console.log('');
		}

		return findings.length === 0 ? 0 : 1;
	} finally {
		if (server) {
			server.kill();
			await rm(DATA_DIR, { recursive: true, force: true }).catch(() => {});
		}
	}
}

main()
	.then((code) => process.exit(code))
	.catch((error) => {
		console.error(error instanceof Error ? error.stack : error);
		process.exit(3);
	});
