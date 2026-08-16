/// <reference types="astro/client" />

import type { AuthUser } from './lib/auth/permissions';
import type { PublicUser } from './lib/auth/users';

declare global {
	namespace App {
		interface Locals {
			/** Usuário autenticado da requisição, ou `null`. Preenchido pelo middleware. */
			user: PublicUser | null;
			/** Forma reduzida consumida pela autorização (`can`, `authorize`). */
			authUser: AuthUser | null;
		}
	}
}

export {};
