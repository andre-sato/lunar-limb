/**
 * Prefixa links absolutos internos com o `base` do site.
 *
 * O problema é específico do GitHub Pages e fácil de descobrir tarde: um *site
 * de projeto* é servido em `https://usuario.github.io/repositorio/`, então o
 * `base` do Astro passa a ser `/repositorio/`. A Astro reescreve o que ela mesma
 * gera — navegação, assets, paginação —, mas **não** reescreve link escrito à
 * mão no Markdown. Todo `[guia](/guides/getting-started/)` do conteúdo apontaria
 * para a raiz do domínio, fora do site, e daria 404.
 *
 * Este plugin roda no HTML já gerado e corrige `href`/`src` que começam com uma
 * barra. Ele é registrado **somente** quando `base` não é `/` — no deploy normal
 * não há transformação alguma.
 *
 * O que ele não toca, e por quê:
 *
 * - URL absoluta com esquema (`https://…`, `mailto:`) — é outro destino;
 * - `//host/caminho` — relativo a protocolo, também é outro destino;
 * - âncora pura (`#secao`) e link relativo (`../outra/`) — já resolvem certo;
 * - caminho que já começa com o `base` — reaplicar duplicaria o prefixo.
 */

import type { Element, Root } from 'hast';
import { visit } from 'unist-util-visit';

/** Atributos que carregam URL e precisam do prefixo. */
const URL_ATTRIBUTES = ['href', 'src', 'poster'] as const;

export function normalizeBase(base: string): string {
	const trimmed = base.trim();
	if (trimmed === '' || trimmed === '/') return '/';
	return `/${trimmed.replace(/^\/+|\/+$/g, '')}/`;
}

export function prefixUrl(value: string, base: string): string {
	const normalized = normalizeBase(base);
	if (normalized === '/') return value;

	// Só caminho absoluto do próprio site. `//` é relativo a protocolo.
	if (!value.startsWith('/') || value.startsWith('//')) return value;
	if (value === normalized || value.startsWith(normalized)) return value;

	return `${normalized}${value.slice(1)}`;
}

export function rehypeBasePath(options: { base: string }) {
	const base = normalizeBase(options.base);

	return (tree: Root) => {
		if (base === '/') return;

		visit(tree, 'element', (node: Element) => {
			for (const attribute of URL_ATTRIBUTES) {
				const value = node.properties?.[attribute];
				if (typeof value !== 'string') continue;
				node.properties[attribute] = prefixUrl(value, base);
			}

			// `srcset` é uma lista de "url descritor". No hast a propriedade se
			// chama `srcSet` — o nome do DOM, não o do atributo — e pode vir como
			// string ou como array, dependendo de como a árvore foi construída.
			const srcSet = node.properties?.srcSet;
			const candidates =
				typeof srcSet === 'string'
					? srcSet.split(',')
					: Array.isArray(srcSet)
						? srcSet.map(String)
						: null;

			if (candidates) {
				const rewritten = candidates.map((candidate) => {
					const parts = candidate.trim().split(/\s+/);
					if (parts[0] === undefined || parts[0] === '') return candidate;
					parts[0] = prefixUrl(parts[0], base);
					return parts.join(' ');
				});
				node.properties.srcSet = Array.isArray(srcSet) ? rewritten : rewritten.join(', ');
			}
		});
	};
}
