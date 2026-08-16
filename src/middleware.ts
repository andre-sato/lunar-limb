/**
 * Ponto único de aplicação da autorização.
 *
 * Toda rota sob demanda passa por aqui antes de chegar ao handler. Nenhuma
 * página ou endpoint precisa lembrar de se proteger: a tabela em
 * `lib/auth/guard.ts` decide, e este arquivo obedece.
 *
 * Regra do projeto: **a UI controla a experiência, o backend controla a
 * segurança.** Esconder um botão não é autorização — é cortesia. A negação
 * real acontece neste arquivo.
 *
 * Observação sobre as páginas de documentação: elas são pré-renderizadas
 * (estáticas) e públicas por decisão de produto, portanto não passam por este
 * middleware. O botão "Editar esta página" é uma server island, renderizada
 * sob demanda — e essa requisição, sim, passa por aqui.
 */

import { defineMiddleware } from 'astro:middleware';
import { authorize, normalizePath } from './lib/auth/guard';
import { resolveSession, toAuthUser, SESSION_COOKIE } from './lib/auth/sessions';
import { seedInitialAdmin } from './lib/auth/users';

/** O seed roda uma vez por processo, na primeira requisição. */
let seeded: Promise<void> | null = null;
function ensureSeeded(): Promise<void> {
	if (!seeded) {
		seeded = seedInitialAdmin().catch((error) => {
			console.error('[auth] falha ao semear o administrador inicial:', error);
		});
	}
	return seeded;
}

function isApiPath(pathname: string): boolean {
	return pathname === '/api' || pathname.startsWith('/api/');
}

function json(body: unknown, status: number): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json; charset=utf-8' },
	});
}

export const onRequest = defineMiddleware(async (context, next) => {
	await ensureSeeded();

	const token = context.cookies.get(SESSION_COOKIE)?.value;
	const user = await resolveSession(token);

	// Disponível para páginas e endpoints via `Astro.locals.user`.
	context.locals.user = user;
	context.locals.authUser = toAuthUser(user);

	const pathname = normalizePath(context.url.pathname);
	const decision = authorize(context.locals.authUser, pathname, context.request.method);

	if (decision.kind === 'allow') return next();

	const api = isApiPath(pathname);

	if (decision.kind === 'authenticate') {
		if (api) {
			return json({ error: 'unauthorized', message: 'É necessário entrar para acessar este recurso.' }, 401);
		}
		const next_ = encodeURIComponent(context.url.pathname + context.url.search);
		return context.redirect(`/login?next=${next_}`, 302);
	}

	// decision.kind === 'forbid'
	if (api) {
		// A resposta não diz qual permissão faltou nem se o recurso existe:
		// mensagens de erro não devem mapear a superfície interna para quem
		// não tem acesso a ela.
		return json({ error: 'forbidden', message: 'Você não tem permissão para esta ação.' }, 403);
	}

	return context.rewrite('/403');
});
