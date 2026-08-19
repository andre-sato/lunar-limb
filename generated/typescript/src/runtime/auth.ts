// Gerado. Não edite à mão.

/**
 * Credenciais vêm de quem constrói o cliente e nunca são gravadas no código
 * gerado — o gerador lê `securitySchemes`, não valores.
 * A especificação declara 1 esquema(s) por cookie (portal_session).
 * O SDK não os envia: cookie é responsabilidade do agente HTTP, e forjá-lo aqui
 * quebraria a sessão de quem já está autenticado no navegador.
 */
export interface AuthOptions {
	/** Chave de API. */
	apiKey?: string;
}

export function applyAuth(headers: Record<string, string>, options: AuthOptions): void {
	// Nada a aplicar: a especificação não declara esquema suportado.
}
