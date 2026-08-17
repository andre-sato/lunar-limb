/**
 * Espelhamento de páginas nos outros idiomas.
 *
 * Criar uma página no idioma raiz (pt-BR) cria a entrada correspondente em
 * `en/` e `es/`. O conteúdo **não** é traduzido — o que se cria é o lugar da
 * tradução, com o mesmo título e um aviso de que o texto ainda está no idioma
 * original.
 *
 * Por que isto importa na prática: a Starlight monta uma navegação por idioma.
 * Sem o arquivo correspondente, quem lê em inglês simplesmente não vê que a
 * página existe — e ninguém descobre que falta traduzir. Com o espelho, a
 * página aparece na navegação marcada como pendente, o que transforma uma
 * ausência invisível numa fila de trabalho visível.
 *
 * Um espelho nunca sobrescreve arquivo existente: se alguém já traduziu, o
 * trabalho dessa pessoa vale mais que a consistência automática.
 */

import yaml from 'js-yaml';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function splitFrontmatter(raw: string): { data: Record<string, unknown>; body: string } {
	const match = raw.match(FRONTMATTER_RE);
	if (!match) return { data: {}, body: raw };

	let data: Record<string, unknown> = {};
	try {
		const loaded = yaml.load(match[1]);
		if (loaded && typeof loaded === 'object' && !Array.isArray(loaded)) {
			data = loaded as Record<string, unknown>;
		}
	} catch {
		// YAML inválido: o espelho ainda é criado, só sem herdar campos.
	}

	return { data, body: raw.slice(match[0].length) };
}

/** Idiomas com pasta própria em `content/docs`, além da raiz. */
export const MIRROR_LOCALES = ['en', 'es'] as const;

export type MirrorLocale = (typeof MIRROR_LOCALES)[number];

/** Aviso inserido no corpo do espelho, por idioma. */
const PENDING_NOTICE: Record<MirrorLocale, string> = {
	en: ':::caution[Translation pending]\nThis page has not been translated yet. The content below is the original text in Portuguese.\n:::',
	es: ':::caution[Traducción pendiente]\nEsta página aún no fue traducida. El contenido a continuación está en portugués.\n:::',
};

/** Descrição usada quando a página original não tem uma. */
const PENDING_DESCRIPTION: Record<MirrorLocale, string> = {
	en: 'Translation pending.',
	es: 'Traducción pendiente.',
};

/**
 * `true` quando o caminho é uma página do idioma raiz.
 *
 * Um arquivo já dentro de `en/` ou `es/` não gera espelhos — senão criar a
 * tradução em inglês tentaria criar `es/en/…`.
 */
export function isRootLocalePath(relativePath: string): boolean {
	const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
	if (normalized === '') return false;
	const first = normalized.split('/')[0];
	return !(MIRROR_LOCALES as readonly string[]).includes(first);
}

export function mirrorPathFor(relativePath: string, locale: MirrorLocale): string {
	return `${locale}/${relativePath.replace(/\\/g, '/').replace(/^\/+/, '')}`;
}

/**
 * Monta o conteúdo do espelho.
 *
 * O frontmatter é reconstruído campo a campo, e não copiado: `visible`,
 * `showIf` e `sidebar` precisam acompanhar (uma página oculta no original não
 * pode aparecer na tradução), mas `slug` não — ele é por idioma, e copiá-lo
 * colidiria com a página original.
 */
export function buildMirrorContent(originalContent: string, locale: MirrorLocale): string {
	const { data, body } = splitFrontmatter(originalContent);

	const title = typeof data.title === 'string' && data.title.trim() !== '' ? data.title.trim() : 'Sem título';
	const description =
		typeof data.description === 'string' && data.description.trim() !== ''
			? data.description.trim()
			: PENDING_DESCRIPTION[locale];

	const lines = ['---', `title: ${quote(title)}`, `description: ${quote(description)}`];

	// Campos que mudam a visibilidade da página têm de acompanhar o original.
	for (const key of ['visible', 'showIf', 'order', 'template', 'draft'] as const) {
		const value = data[key];
		if (value === undefined) continue;
		lines.push(`${key}: ${typeof value === 'string' ? quote(value) : String(value)}`);
	}

	// Marca de espelho: é o que permite distinguir "ainda não traduzido" de
	// "traduzido", em vez de depender de alguém lembrar.
	lines.push('translationPending: true');
	lines.push('---');

	const notice = PENDING_NOTICE[locale];
	const originalBody = body.trim();

	return `${lines.join('\n')}\n\n${notice}\n\n${originalBody}\n`;
}

function quote(value: string): string {
	// Aspas duplas com escape: um título com `:` quebraria o YAML sem elas.
	return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export interface MirrorTarget {
	locale: MirrorLocale;
	path: string;
	content: string;
}

/** Os espelhos a criar para uma página do idioma raiz. */
export function planMirrors(relativePath: string, content: string): MirrorTarget[] {
	if (!isRootLocalePath(relativePath)) return [];

	return MIRROR_LOCALES.map((locale) => ({
		locale,
		path: mirrorPathFor(relativePath, locale),
		content: buildMirrorContent(content, locale),
	}));
}

export interface MirrorResult {
	created: string[];
	skipped: string[];
	failed: Array<{ path: string; reason: string }>;
}

/**
 * Cria os espelhos, tolerando falhas individuais.
 *
 * A criação da página original já aconteceu quando isto roda. Se o espelho em
 * espanhol falhar, a página em português não pode ser desfeita nem a resposta
 * virar erro — o que se faz é relatar, e a interface avisa.
 */
export async function createMirrors(
	relativePath: string,
	content: string,
	createDocument: (path: string, content: string) => Promise<void>
): Promise<MirrorResult> {
	const result: MirrorResult = { created: [], skipped: [], failed: [] };

	for (const target of planMirrors(relativePath, content)) {
		try {
			await createDocument(target.path, target.content);
			result.created.push(target.path);
		} catch (error) {
			// 409 significa "já existe" — tradução feita à mão, que se preserva.
			const status = (error as { status?: number } | null)?.status;
			if (status === 409) {
				result.skipped.push(target.path);
				continue;
			}
			result.failed.push({
				path: target.path,
				reason: error instanceof Error ? error.message : 'erro desconhecido',
			});
		}
	}

	return result;
}
