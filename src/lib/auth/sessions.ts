/**
 * Sessões.
 *
 * O cookie carrega apenas um token aleatório de 256 bits; o estado fica no
 * servidor. Isso é o que torna possível encerrar uma sessão de verdade —
 * logout, desativação de usuário e troca de senha invalidam na hora, coisa que
 * um token autocontido (JWT) não permite sem uma lista de revogação.
 *
 * O que é gravado em disco é o **SHA-256 do token**, não o token: quem ler
 * `data/sessions.json` não consegue se passar por ninguém.
 */

import { createHash, randomBytes } from 'node:crypto';
import { readJson, withFileLock, writeJson } from './store';
import { readJson as readUsersJson } from './store';
import type { AuthUser } from './permissions';
import type { User, PublicUser } from './users';
import { toPublicUser } from './users';

const FILE = 'sessions.json';
const USERS_FILE = 'users.json';

export const SESSION_COOKIE = 'portal_session';

/** Sete dias. Curto o bastante para limitar o estrago, longo o bastante para não irritar. */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface SessionRecord {
	/** SHA-256 do token, em hex. O token puro só existe no cookie. */
	tokenHash: string;
	userId: string;
	createdAt: string;
	expiresAt: string;
	lastSeenAt: string;
}

function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

async function readSessions(): Promise<SessionRecord[]> {
	return readJson<SessionRecord[]>(FILE, []);
}

function isExpired(session: SessionRecord, now = Date.now()): boolean {
	return new Date(session.expiresAt).getTime() <= now;
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
	const token = randomBytes(32).toString('base64url');
	const now = new Date();
	const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

	await withFileLock(FILE, async () => {
		const sessions = await readSessions();
		const alive = sessions.filter((session) => !isExpired(session, now.getTime()));
		alive.push({
			tokenHash: hashToken(token),
			userId,
			createdAt: now.toISOString(),
			expiresAt: expiresAt.toISOString(),
			lastSeenAt: now.toISOString(),
		});
		await writeJson(FILE, alive);
	});

	return { token, expiresAt };
}

/**
 * Resolve o token no usuário atual.
 *
 * O papel e o status vêm **do arquivo de usuários a cada requisição**, nunca do
 * cookie. É isso que faz "desativar usuário" e "rebaixar papel" valerem
 * imediatamente, sem esperar a sessão expirar.
 */
export async function resolveSession(token: string | undefined | null): Promise<PublicUser | null> {
	if (!token) return null;

	const tokenHash = hashToken(token);
	const sessions = await readSessions();
	const session = sessions.find((candidate) => candidate.tokenHash === tokenHash);
	if (!session || isExpired(session)) return null;

	const users = await readUsersJson<User[]>(USERS_FILE, []);
	const user = users.find((candidate) => candidate.id === session.userId);
	if (!user) return null;
	if (user.status !== 'active') return null;

	return toPublicUser(user);
}

export async function destroySession(token: string | undefined | null): Promise<void> {
	if (!token) return;
	const tokenHash = hashToken(token);
	await withFileLock(FILE, async () => {
		const sessions = await readSessions();
		await writeJson(
			FILE,
			sessions.filter((session) => session.tokenHash !== tokenHash)
		);
	});
}

/** Usada ao desativar um usuário ou trocar sua senha. */
export async function destroySessionsForUser(userId: string): Promise<void> {
	await withFileLock(FILE, async () => {
		const sessions = await readSessions();
		await writeJson(
			FILE,
			sessions.filter((session) => session.userId !== userId)
		);
	});
}

export async function purgeExpiredSessions(): Promise<void> {
	await withFileLock(FILE, async () => {
		const sessions = await readSessions();
		const alive = sessions.filter((session) => !isExpired(session));
		if (alive.length !== sessions.length) await writeJson(FILE, alive);
	});
}

export interface CookieOptions {
	httpOnly: true;
	secure: boolean;
	sameSite: 'lax';
	path: string;
	expires?: Date;
	maxAge?: number;
}

/**
 * `httpOnly` impede leitura por JavaScript (XSS não rouba a sessão);
 * `sameSite=lax` cobre CSRF nas requisições cross-site; `secure` é ligado fora
 * de desenvolvimento, onde o TLS existe.
 */
export function sessionCookieOptions(expiresAt: Date): CookieOptions {
	return {
		httpOnly: true,
		secure: process.env.NODE_ENV === 'production',
		sameSite: 'lax',
		path: '/',
		expires: expiresAt,
	};
}

export function clearedCookieOptions(): CookieOptions {
	return {
		httpOnly: true,
		secure: process.env.NODE_ENV === 'production',
		sameSite: 'lax',
		path: '/',
		maxAge: 0,
	};
}

/** Forma que a autorização consome — o mínimo, sem dados pessoais. */
export function toAuthUser(user: PublicUser | null): AuthUser | null {
	if (!user) return null;
	return { id: user.id, role: user.role, status: user.status };
}
