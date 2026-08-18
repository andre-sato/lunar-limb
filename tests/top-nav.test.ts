import { describe, it, expect } from 'vitest';
import { buildTopNav, sectionsOf, type SidebarEntry } from '../src/lib/nav/top-nav';

function link(label: string, href: string, isCurrent = false): SidebarEntry {
	return { type: 'link', label, href, isCurrent };
}

function group(label: string, entries: SidebarEntry[]): SidebarEntry {
	return { type: 'group', label, entries };
}

describe('itens do menu', () => {
	it('grupo vira item com submenu, link solto vira item simples', () => {
		const nav = buildTopNav([
			link('Início', '/'),
			group('Guias', [link('Comece por aqui', '/guides/getting-started/')]),
		]);

		expect(nav).toHaveLength(2);
		expect(nav[0]).toMatchObject({ label: 'Início', href: '/', links: [] });
		expect(nav[1].label).toBe('Guias');
		// Sem `href`: o item abre um painel em vez de navegar.
		expect(nav[1].href).toBeUndefined();
		expect(nav[1].links).toHaveLength(1);
	});

	it('achata subgrupos em um nível, guardando de onde cada link veio', () => {
		// Um menu suspenso com submenu dentro de submenu é difícil de operar; a
		// lateral podia aninhar sem limite, o topo não.
		const nav = buildTopNav([
			group('Guias', [
				link('Comece por aqui', '/guides/getting-started/'),
				group('Avançado', [link('Webhooks', '/guides/webhooks/'), link('Filas', '/guides/filas/')]),
			]),
		]);

		expect(nav[0].links.map((entry) => entry.label)).toEqual(['Comece por aqui', 'Webhooks', 'Filas']);
		expect(nav[0].links[0].group).toBeUndefined();
		expect(nav[0].links[1].group).toBe('Avançado');
	});

	it('usa o rótulo do subgrupo mais interno', () => {
		const nav = buildTopNav([
			group('Guias', [group('Avançado', [group('Webhooks', [link('Retentativas', '/a/')])])]),
		]);
		expect(nav[0].links[0].group).toBe('Webhooks');
	});

	it('o destaque sobe do link até o item de primeiro nível', () => {
		// No topo, quem está visível é o item da seção: é ele que precisa marcar
		// onde o leitor está.
		const nav = buildTopNav([
			group('Guias', [link('Comece por aqui', '/guides/getting-started/', true)]),
			group('Changelog', [link('2026-08', '/changelog/2026-08/')]),
		]);

		expect(nav[0].isCurrent).toBe(true);
		expect(nav[1].isCurrent).toBe(false);
	});

	it('link solto marcado como atual continua marcado', () => {
		const nav = buildTopNav([link('Início', '/', true)]);
		expect(nav[0].isCurrent).toBe(true);
	});

	it('grupo vazio não vira botão', () => {
		// Abriria um painel sem nada dentro.
		const nav = buildTopNav([group('Vazio', []), group('Só grupos vazios', [group('Também vazio', [])])]);
		expect(nav).toEqual([]);
	});

	it('sidebar vazia não gera itens', () => {
		expect(buildTopNav([])).toEqual([]);
	});

	it('preserva a ordem da sidebar', () => {
		const nav = buildTopNav([
			group('Guias', [link('a', '/a/')]),
			group('Referência da API', [link('b', '/b/')]),
			group('Changelog', [link('c', '/c/')]),
		]);
		expect(nav.map((item) => item.label)).toEqual(['Guias', 'Referência da API', 'Changelog']);
	});

	it('leva o badge do link adiante', () => {
		const entry: SidebarEntry = {
			type: 'link',
			label: 'Novo',
			href: '/novo/',
			isCurrent: false,
			badge: { text: 'beta' },
		};
		const nav = buildTopNav([group('Guias', [entry])]);
		expect(nav[0].links[0].badge).toBe('beta');
	});
});

describe('seções do painel', () => {
	it('links sem subgrupo formam um bloco sem título', () => {
		const nav = buildTopNav([group('Guias', [link('a', '/a/'), link('b', '/b/')])]);
		const sections = sectionsOf(nav[0]);

		expect(sections).toHaveLength(1);
		expect(sections[0].title).toBeUndefined();
		expect(sections[0].links).toHaveLength(2);
	});

	it('agrupa por título preservando a ordem original', () => {
		const nav = buildTopNav([
			group('Guias', [
				link('solto', '/s/'),
				group('Avançado', [link('a', '/a/'), link('b', '/b/')]),
				group('Operação', [link('c', '/c/')]),
			]),
		]);

		expect(sectionsOf(nav[0]).map((section) => [section.title, section.links.length])).toEqual([
			[undefined, 1],
			['Avançado', 2],
			['Operação', 1],
		]);
	});

	it('item sem links não tem seções', () => {
		const nav = buildTopNav([link('Início', '/')]);
		expect(sectionsOf(nav[0])).toEqual([]);
	});
});
