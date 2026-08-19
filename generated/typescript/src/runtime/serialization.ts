// Gerado. Não edite à mão.

/** Substitui `{parametro}` pelos valores informados, já codificados. */
export function buildPath(template: string, values: Record<string, unknown>): string {
	return template.replace(/\{([^}]+)\}/g, (whole, name: string) => {
		const value = values[name];
		// Marcador sem valor fica como está: é mais honesto que uma URL
		// silenciosamente errada, e o servidor devolve um 404 que aponta o problema.
		return value === undefined || value === null ? whole : encodeURIComponent(String(value));
	});
}

/** Monta a query string, omitindo o que não foi informado. */
export function buildQuery(values: Record<string, unknown>): string {
	const parts: string[] = [];

	for (const [name, value] of Object.entries(values)) {
		if (value === undefined || value === null) continue;

		// Array vira parâmetro repetido — a forma que o OpenAPI chama de `explode`
		// e a que mais servidores aceitam sem configuração.
		if (Array.isArray(value)) {
			for (const entry of value) parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(entry))}`);
			continue;
		}

		parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
	}

	return parts.length === 0 ? '' : `?${parts.join('&')}`;
}
