/**
 * Persistência dos dados de identidade.
 *
 * Usuários, sessões e auditoria **não são conteúdo** — eles não pertencem ao
 * Markdown nem ao Git. Ficam em JSON sob `data/`, que é ignorado pelo Git:
 * hash de senha, token de sessão e a chave HMAC não devem ir para o
 * repositório.
 *
 * O princípio arquitetural do projeto continua valendo: Markdown/MDX segue
 * sendo a fonte de verdade **do conteúdo**. Esta camada guarda só identidade.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const DATA_DIR = path.resolve(process.cwd(), 'data');

export function dataPath(file: string): string {
	return path.join(DATA_DIR, file);
}

async function ensureDataDir(): Promise<void> {
	await mkdir(DATA_DIR, { recursive: true });
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
	try {
		const raw = await readFile(dataPath(file), 'utf8');
		return JSON.parse(raw) as T;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException)?.code;
		if (code === 'ENOENT') return fallback;
		// JSON corrompido é um erro de operação, não algo a esconder: falhar
		// aqui é melhor do que servir uma lista de usuários vazia e, com ela,
		// semear um admin novo por cima de uma instalação existente.
		throw new Error(`Não foi possível ler data/${file}: ${(error as Error).message}`);
	}
}

/**
 * Escrita atômica: grava num temporário e renomeia. Sem isso, um processo
 * morto no meio da escrita deixaria `users.json` truncado — e um arquivo de
 * usuários truncado é uma porta destrancada.
 */
export async function writeJson(file: string, value: unknown): Promise<void> {
	await ensureDataDir();
	const target = dataPath(file);
	const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
	await rename(temporary, target);
}

/**
 * Serializa leitura-modificação-escrita por arquivo.
 *
 * O servidor Node é single-threaded, mas `await` no meio de um
 * read-modify-write permite que outra requisição entre e leia o estado antigo,
 * perdendo a alteração de uma das duas. Uma fila por arquivo elimina a janela.
 */
const queues = new Map<string, Promise<unknown>>();

export function withFileLock<T>(file: string, operation: () => Promise<T>): Promise<T> {
	const previous = queues.get(file) ?? Promise.resolve();
	const next = previous.then(operation, operation);
	// A fila ignora o resultado (e o erro) da operação anterior: uma falha não
	// pode travar o arquivo para sempre.
	queues.set(
		file,
		next.catch(() => undefined)
	);
	return next;
}

/**
 * Chave usada para assinar cookies de sessão.
 *
 * Vem de `AUTH_SECRET` quando definida — é assim que se deve rodar em
 * produção, e é o que mantém as sessões válidas entre reinícios e réplicas.
 * Sem ela, uma chave aleatória é gerada e guardada em `data/secret` para o
 * ambiente de desenvolvimento continuar utilizável.
 */
let cachedSecret: string | null = null;

export async function getAuthSecret(): Promise<string> {
	if (cachedSecret) return cachedSecret;

	const fromEnv = process.env.AUTH_SECRET;
	if (fromEnv && fromEnv.length >= 32) {
		cachedSecret = fromEnv;
		return cachedSecret;
	}
	if (fromEnv && fromEnv.length > 0) {
		throw new Error('AUTH_SECRET precisa ter ao menos 32 caracteres.');
	}

	await ensureDataDir();
	const secretFile = dataPath('secret');
	if (existsSync(secretFile)) {
		cachedSecret = (await readFile(secretFile, 'utf8')).trim();
		if (cachedSecret.length >= 32) return cachedSecret;
	}

	cachedSecret = randomBytes(48).toString('base64url');
	await writeFile(secretFile, `${cachedSecret}\n`, { encoding: 'utf8', mode: 0o600 });
	return cachedSecret;
}

/** Só para os testes: descarta o segredo memoizado. */
export function resetSecretCache(): void {
	cachedSecret = null;
}
