/* Arquivo sem `import` no topo de propósito: uma declaração de módulo ambiente
   só vale em arquivo global. Dentro de um módulo, `declare module` vira
   aumento de módulo e exige que o módulo já exista — foi o que fez as
   declarações não pegarem quando estavam no env.d.ts. */

/**
 * Componentes da Starlight pelo caminho virtual.
 *
 * O cabeçalho do portal os importa assim, e não pelo pacote, porque é esse
 * caminho que respeita os overrides do projeto: importar
 * `@astrojs/starlight/components/Search.astro` traria a busca padrão e deixaria
 * o assistente de documentação de fora.
 *
 * As declarações são repetidas aqui porque a Starlight as mantém em
 * `virtual-internal.d.ts`, que o pacote não expõe. Referenciar um arquivo
 * interno quebraria numa atualização sem aviso.
 */
declare module 'virtual:starlight/components/Search' {
	const Search: typeof import('@astrojs/starlight/components/Search.astro').default;
	export default Search;
}
declare module 'virtual:starlight/components/SiteTitle' {
	const SiteTitle: typeof import('@astrojs/starlight/components/SiteTitle.astro').default;
	export default SiteTitle;
}
declare module 'virtual:starlight/components/SocialIcons' {
	const SocialIcons: typeof import('@astrojs/starlight/components/SocialIcons.astro').default;
	export default SocialIcons;
}
declare module 'virtual:starlight/components/ThemeSelect' {
	const ThemeSelect: typeof import('@astrojs/starlight/components/ThemeSelect.astro').default;
	export default ThemeSelect;
}
declare module 'virtual:starlight/components/LanguageSelect' {
	const LanguageSelect: typeof import('@astrojs/starlight/components/LanguageSelect.astro').default;
	export default LanguageSelect;
}
