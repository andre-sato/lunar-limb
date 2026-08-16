/**
 * Hashing de senha com scrypt (node:crypto) — sem dependência externa.
 *
 * scrypt é deliberadamente caro em CPU e memória, que é o que se quer contra
 * ataque de dicionário offline caso o arquivo de usuários vaze. Os parâmetros
 * ficam gravados junto do hash, então dá para endurecê-los depois sem
 * invalidar as senhas já existentes.
 */

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
	password: string | Buffer,
	salt: string | Buffer,
	keylen: number,
	options: { N: number; r: number; p: number; maxmem: number }
) => Promise<Buffer>;

const PARAMS = { N: 16384, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

// scrypt precisa de ~128 * N * r bytes; o padrão do Node (32 MB) fica no limite
// para N=16384, então o teto é declarado explicitamente.
const MAX_MEM = 64 * 1024 * 1024;

/** Formato: `scrypt$N$r$p$<salt base64>$<hash base64>` */
export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(SALT_LENGTH);
	const derived = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, {
		...PARAMS,
		maxmem: MAX_MEM,
	});
	return [
		'scrypt',
		PARAMS.N,
		PARAMS.r,
		PARAMS.p,
		salt.toString('base64'),
		derived.toString('base64'),
	].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const parts = stored.split('$');
	if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

	const N = Number.parseInt(parts[1], 10);
	const r = Number.parseInt(parts[2], 10);
	const p = Number.parseInt(parts[3], 10);
	if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

	let salt: Buffer;
	let expected: Buffer;
	try {
		salt = Buffer.from(parts[4], 'base64');
		expected = Buffer.from(parts[5], 'base64');
	} catch {
		return false;
	}
	if (expected.length === 0) return false;

	let derived: Buffer;
	try {
		derived = await scrypt(password.normalize('NFKC'), salt, expected.length, {
			N,
			r,
			p,
			maxmem: MAX_MEM,
		});
	} catch {
		return false;
	}

	// Comparação em tempo constante: um `===` vaza, pelo tempo de resposta,
	// quantos bytes iniciais o atacante acertou.
	if (derived.length !== expected.length) return false;
	return timingSafeEqual(derived, expected);
}

/**
 * Senha inicial legível gerada para o admin semeado. Alfabeto sem caracteres
 * ambíguos, porque essa senha é lida do console e digitada à mão.
 */
export function generatePassword(length = 20): string {
	const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
	const bytes = randomBytes(length);
	let out = '';
	for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
	return out;
}

export interface PasswordPolicyResult {
	ok: boolean;
	message?: string;
}

export function checkPasswordPolicy(password: string): PasswordPolicyResult {
	if (password.length < 12) {
		return { ok: false, message: 'A senha precisa ter ao menos 12 caracteres.' };
	}
	if (password.length > 200) {
		return { ok: false, message: 'A senha precisa ter no máximo 200 caracteres.' };
	}
	return { ok: true };
}
