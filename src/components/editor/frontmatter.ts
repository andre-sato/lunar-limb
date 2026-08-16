import yaml from 'js-yaml';

export interface ParsedDocument {
	frontmatter: Record<string, unknown>;
	body: string;
	hasFrontmatter: boolean;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function splitContent(raw: string): ParsedDocument {
	const match = raw.match(FRONTMATTER_RE);
	if (!match) {
		return { frontmatter: {}, body: raw, hasFrontmatter: false };
	}

	const [, rawYaml, rest] = match;
	let frontmatter: Record<string, unknown> = {};
	try {
		const loaded = yaml.load(rawYaml);
		if (loaded && typeof loaded === 'object' && !Array.isArray(loaded)) {
			frontmatter = loaded as Record<string, unknown>;
		}
	} catch {
		// Invalid YAML mid-edit — keep going with an empty object rather than crashing the form.
	}

	return { frontmatter, body: rest.replace(/^\n+/, ''), hasFrontmatter: true };
}

export function buildContent(frontmatter: Record<string, unknown>, body: string): string {
	const yamlText = yaml.dump(frontmatter, { lineWidth: -1, noRefs: true }).trimEnd();
	return `---\n${yamlText}\n---\n\n${body}`;
}

type FieldPath = string[];

function setPath(target: Record<string, unknown>, pathSegments: FieldPath, value: unknown): void {
	let cursor: Record<string, unknown> = target;
	for (let i = 0; i < pathSegments.length - 1; i++) {
		const key = pathSegments[i];
		const next = cursor[key];
		if (typeof next !== 'object' || next === null || Array.isArray(next)) {
			cursor[key] = {};
		}
		cursor = cursor[key] as Record<string, unknown>;
	}
	cursor[pathSegments[pathSegments.length - 1]] = value;
}

function deletePath(target: Record<string, unknown>, pathSegments: FieldPath): void {
	const chain: Record<string, unknown>[] = [target];
	let cursor: Record<string, unknown> = target;
	for (let i = 0; i < pathSegments.length - 1; i++) {
		const key = pathSegments[i];
		const next = cursor[key];
		if (typeof next !== 'object' || next === null) return;
		cursor = next as Record<string, unknown>;
		chain.push(cursor);
	}
	delete cursor[pathSegments[pathSegments.length - 1]];

	// Clean up now-empty intermediate objects, e.g. an emptied `sidebar: {}`.
	for (let i = chain.length - 1; i > 0; i--) {
		const parent = chain[i - 1];
		const key = pathSegments[i - 1];
		const value = parent[key];
		if (value && typeof value === 'object' && Object.keys(value).length === 0) {
			delete parent[key];
		} else {
			break;
		}
	}
}

/**
 * Returns a new frontmatter object with `pathSegments` set to `value`, or
 * removed entirely when `value` is `undefined`/`''`. Every other field —
 * known or not, at any depth — is left untouched.
 */
export function updateField(
	frontmatter: Record<string, unknown>,
	pathSegments: FieldPath,
	// `boolean` entrou na Fase 5 por causa de `visible`. Note que só `undefined`
	// e `''` removem o campo — `false` é um valor legítimo e precisa ser gravado.
	value: string | number | boolean | undefined
): Record<string, unknown> {
	const next: Record<string, unknown> = JSON.parse(JSON.stringify(frontmatter ?? {}));
	if (value === undefined || value === '') {
		deletePath(next, pathSegments);
	} else {
		setPath(next, pathSegments, value);
	}
	return next;
}
