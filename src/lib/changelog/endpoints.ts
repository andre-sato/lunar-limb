/**
 * Endpoints citados no changelog, resolvidos contra a especificação (issue #15).
 *
 * A spec pede que os endpoints virem referência clicável. O detalhe que decide a
 * qualidade disso: **só vira link o que existe na especificação.**
 *
 * Um regex que transforma qualquer `POST /alguma-coisa` em link produz páginas
 * com links quebrados para endpoints que nunca existiram — e o changelog é lido
 * justamente por quem vai tentar usar aquilo. Um endpoint citado que não resolve
 * sai como código, não como link, e entra na lista de pendências da geração.
 *
 * A validação usa o `ApiModel` do parser único (ADR-0004). Abrir o YAML aqui
 * daria uma segunda leitura da mesma especificação, e a segunda envelheceria.
 */

import type { ApiModel } from '../api-explorer/model';

/** `GET /v1/cobrancas`, `POST /auth/login`. Pontuação final não entra no caminho. */
const MENTION = /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/[^\s,;)\]]*)/g;

/** `/v1/cobrancas/{id}` e `/v1/cobrancas/[id]` são o mesmo endpoint. */
export function normalizePath(path: string): string {
	return path.replace(/\[([^\]]+)\]/g, '{$1}').replace(/\/+$/, '') || '/';
}

/** Tira a pontuação que a frase deixou grudada no caminho. */
function trimTrailing(path: string): string {
	return path.replace(/[.,;:!?)\]]+$/, '');
}

export interface EndpointLink {
	method: string;
	path: string;
	/** `true` quando o endpoint existe na especificação. */
	resolved: boolean;
	/** Presente só quando resolveu. */
	href?: string;
}

/**
 * Os endpoints citados num texto, com o veredito de cada um.
 *
 * O caminho da especificação pode ter prefixo de servidor (`/api`) que o texto
 * do commit não escreve, então a comparação aceita sufixo — `POST /auth/login`
 * casa com `POST /api/auth/login`. Sem isso, quase nenhuma citação resolveria, e
 * a feature viraria um gerador de código formatado.
 */
export function findEndpoints(text: string, model: ApiModel | null, referenceBase: string): EndpointLink[] {
	const found: EndpointLink[] = [];
	const seen = new Set<string>();

	for (const match of text.matchAll(MENTION)) {
		const method = match[1].toUpperCase();
		const path = normalizePath(trimTrailing(match[2]));
		const key = `${method} ${path}`;
		if (seen.has(key)) continue;
		seen.add(key);

		const operation = model?.operations.find((candidate) => {
			if (candidate.method.toUpperCase() !== method) return false;
			const declared = normalizePath(candidate.path);
			return declared === path || declared.endsWith(path) || path.endsWith(declared);
		});

		found.push(
			operation
				? { method, path, resolved: true, href: `${referenceBase}#${anchorFor(method, operation.path)}` }
				: { method, path, resolved: false }
		);
	}

	return found;
}

/** A âncora que a referência de API usa para uma operação. */
export function anchorFor(method: string, path: string): string {
	return `${method}-${path}`
		.toLowerCase()
		.replace(/[{}]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

/**
 * Reescreve o texto trocando as citações resolvidas por link.
 *
 * O que não resolveu vira `código`, que é honesto: o leitor vê o endpoint, e não
 * recebe um link que não leva a lugar nenhum.
 */
export function linkEndpoints(text: string, links: readonly EndpointLink[]): string {
	if (links.length === 0) return text;

	return text.replace(MENTION, (whole, rawMethod: string, rawPath: string) => {
		const method = rawMethod.toUpperCase();
		const clean = normalizePath(trimTrailing(rawPath));
		const trailing = rawPath.slice(trimTrailing(rawPath).length);
		const link = links.find((candidate) => candidate.method === method && candidate.path === clean);

		if (!link) return whole;
		const label = `${method} ${clean}`;

		return (link.resolved ? `[\`${label}\`](${link.href})` : `\`${label}\``) + trailing;
	});
}
