/**
 * URL pública de uma página a partir do caminho do arquivo.
 *
 * Usada pelo editor para abrir a página depois de salvar. As regras seguem as
 * da própria Starlight, e as duas que não são óbvias:
 *
 * **`slug` no frontmatter vence o caminho.** Uma página em `guides/auth.md` com
 * `slug: autenticacao` é publicada em `/autenticacao/`. Ignorar o campo levaria
 * o editor a abrir uma URL que dá 404.
 *
 * **O prefixo de idioma é preservado.** Em `en/guides/auth.md` o `en/` faz
 * parte da rota, e um `slug` customizado é relativo à raiz daquele idioma —
 * `en/guides/auth.md` com `slug: authentication` vira `/en/authentication/`.
 */

const LOCALE_PREFIXES = ['en', 'es'];

/** Blocos reutilizáveis não têm página: nada a abrir. */
export function hasPublicPage(root: 'docs' | 'snippets'): boolean {
	return root === 'docs';
}

function splitLocale(path: string): { locale: string | null; rest: string } {
	const [first, ...others] = path.split('/');
	if (others.length > 0 && LOCALE_PREFIXES.includes(first)) {
		return { locale: first, rest: others.join('/') };
	}
	return { locale: null, rest: path };
}

export function pageUrlFor(filePath: string, frontmatter?: Record<string, unknown>): string {
	const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
	const { locale, rest } = splitLocale(normalized);

	const rawSlug = frontmatter?.slug;
	const slug =
		typeof rawSlug === 'string' && rawSlug.trim() !== ''
			? rawSlug.trim().replace(/^\/+|\/+$/g, '')
			: rest
					.replace(/\.mdx?$/i, '')
					// `index` é a raiz da sua pasta, não um segmento de rota.
					.replace(/(?:^|\/)index$/i, '');

	const segments = [locale, slug].filter((part): part is string => Boolean(part && part !== ''));
	return segments.length === 0 ? '/' : `/${segments.join('/')}/`;
}
