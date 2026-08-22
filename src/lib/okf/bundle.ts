/**
 * Montagem do bundle OKF (issue #16).
 *
 * Junta o que `collect.ts` leu, traduz com `derive.ts` e acrescenta o que a
 * spec pede e o portal não tem: `index.md` por diretório e um `log.md` na raiz.
 *
 * Duas decisões de forma que valem explicação, porque ambas descartam
 * informação de propósito:
 *
 * **Um conceito por conhecimento, não por idioma.** `en/` e `es/` espelham o
 * português. Emitir os três como conceitos separados daria ao consumidor três
 * nós quase idênticos para a mesma pergunta — e um grafo de conhecimento que
 * responde três vezes a mesma coisa é exatamente o defeito que este portal
 * existe para evitar. O original entra como conceito; as traduções viram um
 * campo `translations` apontando para a URL de cada uma.
 *
 * **Índice não é conceito.** A Starlight tem `index.mdx` com `hero` e
 * `template`; a spec reserva `index.md` para listagem de diretório. Os índices
 * do portal viram listagens; o texto de vitrine deles não sobrevive, e não
 * deveria — ele é apresentação.
 */

import type { GovernanceConfig } from '../governance/types';
import { DEFAULT_LOCALE, LOCALES, type SourceContent, type SourceDocument } from './collect';
import { bundlePathOf, routeOf, toConcept } from './derive';
import { buildRouteMap, rewriteLinks } from './links';
import { serializeConcept, serializeIndex, serializeLog } from './serialize';
import {
	OKF_VERSION,
	type OkfBundle,
	type OkfConcept,
	type OkfIndex,
	type OkfIndexEntry,
	type OkfLog,
} from './types';
import type { OkfFile } from './validate';

export interface BuildOptions {
	siteUrl: string;
	now: number;
	config: GovernanceConfig;
	/** Título do bundle, mostrado no `index.md` da raiz. */
	title: string;
	description?: string;
}

/** Rótulo humano de cada diretório, para os cabeçalhos do índice. */
const SECTION_LABELS: Record<string, string> = {
	guides: 'Guias',
	'api-reference': 'Referência da API',
	changelog: 'Changelog',
	exemplos: 'Exemplos',
	glossary: 'Glossário',
	snippets: 'Blocos reutilizáveis',
};

function labelFor(directory: string): string {
	if (directory === '') return 'Raiz';
	const last = directory.split('/').pop() ?? directory;
	return SECTION_LABELS[last] ?? last.replace(/[-_]/g, ' ');
}

function directoryOf(bundlePath: string): string {
	const parts = bundlePath.split('/');
	parts.pop();
	return parts.join('/');
}

/**
 * Agrupa os espelhos de idioma sob o documento original.
 *
 * A chave é o caminho sem o prefixo de idioma: `en/guides/x.mdx` e
 * `guides/x.mdx` colapsam em `guides/x`. Um espelho sem original correspondente
 * — tradução de uma página que já foi removida — vira conceito próprio, porque
 * o conteúdo existe e descartá-lo perderia conhecimento publicado.
 */
export function groupTranslations(docs: readonly SourceDocument[]): {
	originals: SourceDocument[];
	translationsFor: Map<string, Record<string, string>>;
} {
	const byKey = new Map<string, SourceDocument[]>();

	for (const document of docs) {
		const parts = document.relativePath.split('/');
		if (document.locale !== DEFAULT_LOCALE) parts.shift();
		const key = parts.join('/').replace(/\.mdx?$/i, '');
		const bucket = byKey.get(key) ?? [];
		bucket.push(document);
		byKey.set(key, bucket);
	}

	const originals: SourceDocument[] = [];
	const translationsFor = new Map<string, Record<string, string>>();

	for (const bucket of byKey.values()) {
		const original = bucket.find((document) => document.locale === DEFAULT_LOCALE);
		const mirrors = bucket.filter((document) => document.locale !== DEFAULT_LOCALE);

		if (!original) {
			originals.push(...mirrors);
			continue;
		}

		originals.push(original);
		const bundlePath = bundlePathOf(original);
		if (!bundlePath || mirrors.length === 0) continue;

		const map: Record<string, string> = {};
		for (const mirror of mirrors) map[mirror.locale] = routeOf(mirror);
		translationsFor.set(bundlePath, map);
	}

	return { originals, translationsFor };
}

/** Monta o bundle inteiro em memória. */
export function buildBundle(content: SourceContent, options: BuildOptions): OkfBundle {
	const { originals, translationsFor } = groupTranslations(content.docs);

	const concepts: OkfConcept[] = [];
	const sources = [...originals, ...content.glossary, ...content.snippets];

	for (const document of sources) {
		const bundlePath = bundlePathOf(document);
		const concept = toConcept(document, {
			siteUrl: options.siteUrl,
			now: options.now,
			config: options.config,
			translations: bundlePath ? translationsFor.get(bundlePath) : undefined,
		});
		if (concept) concepts.push(concept);
	}

	concepts.sort((a, b) => a.path.localeCompare(b.path));

	const indexes = buildIndexes(concepts, options);

	// A reescrita acontece depois de montar conceitos e índices porque só então
	// se sabe que rotas viraram arquivo. Fazer isso durante a derivação obrigaria
	// cada conceito a adivinhar o destino dos outros.
	//
	// As rotas de seção (`/exemplos/`) entram apontando para o `index.md` do
	// diretório: no portal elas levam à vitrine da seção, e o equivalente no
	// bundle é a listagem — deixá-las de fora quebraria justamente os links de
	// navegação entre áreas.
	const indexPaths = new Set(indexes.map((index) => index.path));
	const routes = buildRouteMap([
		...sources
			.map((document) => ({ route: routeOf(document), path: bundlePathOf(document) ?? '' }))
			.filter((pair) => pair.route !== '' && pair.path !== ''),
		...sources
			.filter((document) => bundlePathOf(document) === null)
			.map((document) => ({
				route: routeOf(document),
				path: document.relativePath.replace(/\.mdx?$/i, '.md'),
			}))
			.filter((pair) => pair.route !== '' && indexPaths.has(pair.path)),
	]);

	for (const concept of concepts) {
		concept.body = rewriteLinks(concept.body, routes);
	}

	return {
		concepts,
		indexes,
		logs: [buildLog(concepts, options)],
	};
}

/**
 * Um `index.md` por diretório que tenha conceitos, mais o da raiz.
 *
 * A descrição de cada entrada é a `description` do próprio conceito, como a
 * spec recomenda — repetir ali um resumo escrito à mão criaria duas descrições
 * do mesmo conceito, e nada garantiria que continuassem concordando.
 */
export function buildIndexes(concepts: readonly OkfConcept[], options: BuildOptions): OkfIndex[] {
	const byDirectory = new Map<string, OkfIndexEntry[]>();

	for (const concept of concepts) {
		const directory = directoryOf(concept.path);
		const entries = byDirectory.get(directory) ?? [];
		entries.push({
			title: concept.frontmatter.title ?? concept.path,
			href: `/${concept.path}`,
			description: concept.frontmatter.description,
		});
		byDirectory.set(directory, entries);
	}

	const indexes: OkfIndex[] = [];

	// Raiz: uma seção por diretório de primeiro nível, mais os conceitos soltos.
	const rootSections = [...byDirectory.keys()]
		.sort((a, b) => a.localeCompare(b))
		.map((directory) => ({
			heading: labelFor(directory),
			entries: (byDirectory.get(directory) ?? []).sort((a, b) => a.title.localeCompare(b.title)),
		}))
		.filter((section) => section.entries.length > 0);

	indexes.push({
		path: 'index.md',
		okfVersion: OKF_VERSION,
		title: options.title,
		description: options.description,
		sections: rootSections,
	});

	for (const [directory, entries] of byDirectory) {
		if (directory === '') continue;
		indexes.push({
			path: `${directory}/index.md`,
			title: labelFor(directory),
			sections: [
				{
					heading: labelFor(directory),
					entries: [...entries].sort((a, b) => a.title.localeCompare(b.title)),
				},
			],
		});
	}

	return indexes.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * O `log.md` da raiz.
 *
 * Registra a geração, não a história editorial de cada página — essa já vive no
 * Git e no changelog do portal, e copiá-la para cá criaria uma terceira versão
 * dos mesmos fatos. O que o log responde é a pergunta que um consumidor externo
 * do bundle tem e não consegue responder sozinho: quando este material foi
 * extraído, e de que tamanho ele era.
 */
export function buildLog(concepts: readonly OkfConcept[], options: BuildOptions): OkfLog {
	const date = new Date(options.now).toISOString().slice(0, 10);

	return {
		path: 'log.md',
		entries: [
			{
				date,
				kind: 'Update',
				text: `Bundle regenerado a partir do portal: ${concepts.length} conceitos, OKF ${OKF_VERSION}.`,
			},
		],
	};
}

/** O bundle como arquivos, prontos para gravar ou validar. */
export function renderBundle(bundle: OkfBundle): OkfFile[] {
	const files: OkfFile[] = [];

	for (const concept of bundle.concepts) {
		files.push({ path: concept.path, contents: serializeConcept(concept) });
	}
	for (const index of bundle.indexes) {
		files.push({ path: index.path, contents: serializeIndex(index) });
	}
	for (const log of bundle.logs) {
		files.push({ path: log.path, contents: serializeLog(log) });
	}

	return files.sort((a, b) => a.path.localeCompare(b.path));
}

export { LOCALES };
