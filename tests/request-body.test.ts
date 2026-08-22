import { describe, expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { readJsonObject } from '../src/lib/auth/api';

/**
 * O corpo das requisições de API (issue #19).
 *
 * Escrito depois de uma rodada de bug hunt que encontrou 18 endpoints
 * devolvendo 500 para corpo malformado. Eram três defeitos com a mesma raiz —
 * o corpo era presumido objeto:
 *
 *   1. corpo vazio: `request.json()` lança, e o `catch` da rota mandava tudo
 *      para 500 com a mensagem do interpretador;
 *   2. corpo `null`/`[]`/`"texto"`: **não** lança. O `as Record<string,
 *      unknown>` prometia um objeto, e o `TypeError` estourava na linha
 *      seguinte;
 *   3. `plan.files: [null]` no lote: a lista era conferida, as entradas não.
 *
 * O teste de varredura no fim é o que impede a classe de voltar: uma rota nova
 * que leia `request.json()` sem o helper reprova aqui, e não meses depois em
 * produção.
 */

function req(body: string | undefined): Request {
	return new Request('http://localhost/api/teste', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body,
	});
}

describe('readJsonObject', () => {
	it('aceita um objeto JSON', async () => {
		const result = await readJsonObject(req('{"a":1}'));

		expect(result).toEqual({ ok: true, value: { a: 1 } });
	});

	it('recusa corpo vazio sem repetir a mensagem do interpretador', async () => {
		const result = await readJsonObject(req(undefined));

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).not.toMatch(/JSON input|Unexpected token/i);
		expect(result.error).toContain('Corpo inválido');
	});

	it('recusa JSON malformado', async () => {
		const result = await readJsonObject(req('nao-e-json'));

		expect(result.ok).toBe(false);
	});

	// O caso que passava despercebido: JSON válido que não é objeto. Um
	// `try/catch` em volta do `json()` não pega nenhum destes.
	it.each([
		['null', 'null'],
		['lista', '[]'],
		['string', '"texto"'],
		['número', '123'],
		['booleano', 'true'],
	])('recusa corpo que é %s — JSON válido, mas não objeto', async (_label, payload) => {
		const result = await readJsonObject(req(payload));

		expect(result.ok).toBe(false);
	});

	it('aceita objeto vazio: `{}` é um objeto, e a rota decide o que falta', async () => {
		const result = await readJsonObject(req('{}'));

		expect(result).toEqual({ ok: true, value: {} });
	});
});

describe('rotas de API', () => {
	async function apiFiles(): Promise<string[]> {
		const root = path.resolve(process.cwd(), 'src/pages/api');
		const found: string[] = [];

		async function visit(dir: string): Promise<void> {
			for (const entry of await readdir(dir, { withFileTypes: true })) {
				const absolute = path.join(dir, entry.name);
				if (entry.isDirectory()) await visit(absolute);
				else if (entry.name.endsWith('.ts')) found.push(absolute);
			}
		}

		await visit(root);
		return found;
	}

	/**
	 * Rotas que leem o corpo sem o helper, com motivo.
	 *
	 * A lista é curta de propósito: cada entrada é uma rota que trata o caso por
	 * conta própria e foi conferida à mão. Acrescentar uma linha aqui é uma
	 * decisão consciente; esquecer o helper numa rota nova, não.
	 */
	const EXCEPTIONS: Readonly<Record<string, string>> = {
		// `normalizeSidebar` roda dentro do mesmo `try`, então corpo malformado e
		// configuração inválida caem no mesmo 400 — que é o certo para os dois.
		'src/pages/api/editor/sidebar.ts': 'normaliza dentro do try; qualquer corpo inválido vira 400',
		// Telemetria: `body ?? {}` já absorve `null`, e a rota responde 204 a
		// praticamente tudo por design — medir nunca pode quebrar a leitura.
		'src/pages/api/observe.ts': 'trata `null` com `?? {}` e nunca falha por corpo',
	};

	/**
	 * Nenhuma rota nova chama `request.json()` diretamente.
	 *
	 * A varredura é grosseira de propósito: não julga se o tratamento está certo,
	 * só se a rota passou pelo lugar onde o tratamento existe. Foi a ausência
	 * desse ponto único que deixou dezoito rotas errarem de três maneiras
	 * diferentes — inclusive `/api/auth/login`, que é pública e anterior à
	 * autenticação.
	 */
	it('leem o corpo pelo helper, não por `request.json()` solto', async () => {
		const offenders: string[] = [];

		for (const file of await apiFiles()) {
			const relative = path.relative(process.cwd(), file).split(path.sep).join('/');
			if (relative in EXCEPTIONS) continue;

			const source = await readFile(file, 'utf-8');
			if (source.includes('request.json()')) offenders.push(relative);
		}

		expect(offenders).toEqual([]);
	});

	it('as exceções ainda existem — uma lista que apodrece não protege nada', async () => {
		const present = new Set(
			(await apiFiles()).map((file) => path.relative(process.cwd(), file).split(path.sep).join('/'))
		);

		for (const route of Object.keys(EXCEPTIONS)) {
			expect(present.has(route), `${route} está na lista de exceções mas não existe mais`).toBe(true);
		}
	});
});
