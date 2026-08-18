/// <reference types="astro/client" />
/// <reference types="@astrojs/starlight/virtual" />


import type { AuthUser } from './lib/auth/permissions';
import type { PublicUser } from './lib/auth/users';

declare global {
	namespace App {
		interface Locals {
			/**
			 * Navegação do topo, montada no middleware de rota da Starlight a
			 * partir da árvore completa — antes de ela ser estreitada para a
			 * seção atual, que é o que a barra lateral passa a mostrar.
			 */
			topNav?: import('./lib/nav/top-nav').NavItem[];
			/** Usuário autenticado da requisição, ou `null`. Preenchido pelo middleware. */
			user: PublicUser | null;
			/** Forma reduzida consumida pela autorização (`can`, `authorize`). */
			authUser: AuthUser | null;
		}
	}
}

export {};
