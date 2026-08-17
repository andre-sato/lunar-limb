/**
 * Supressão de regras (§59, §60, §61).
 *
 * A §61 trata falso positivo como preocupação de primeira classe: "o objetivo
 * não é fazer o autor lutar contra o Linter". Por isso toda regra pode ser
 * silenciada em três níveis, e cada silenciamento é **registrado** no
 * resultado — assim uma regra sistematicamente ignorada fica visível para ser
 * revista, em vez de sumir sem deixar rastro.
 *
 *   <!-- lint-disable-next-line STYLE-001 -->   uma linha
 *   <!-- lint-disable STYLE-001 -->             a partir daqui
 *   <!-- lint-enable STYLE-001 -->              volta a valer
 *
 *   ---
 *   lint:
 *     ignore: [STYLE-001]
 *     profile: api-docs
 *   ---
 */

export interface SuppressionRecord {
	ruleId: string;
	line: number | null;
	reason: 'directive' | 'frontmatter';
}

interface RangeDisable {
	ruleId: string | null;
	from: number;
	to: number;
}

export interface SuppressionIndex {
	/** Regras ignoradas na página inteira, via frontmatter. */
	frontmatterIgnored: Set<string>;
	/** `null` como ruleId significa "todas as regras". */
	nextLine: Map<number, Set<string | null>>;
	ranges: RangeDisable[];
}

const DIRECTIVE_RE = /<!--\s*lint-(disable-next-line|disable|enable)([^>]*?)-->/g;

function parseRuleIds(rest: string): Array<string | null> {
	const ids = rest
		.split(/[\s,]+/)
		.map((token) => token.trim())
		.filter(Boolean);
	// Sem ids explícitos, a diretiva vale para todas as regras.
	return ids.length > 0 ? ids : [null];
}

export function buildSuppressionIndex(raw: string, frontmatter: Record<string, unknown>): SuppressionIndex {
	const index: SuppressionIndex = {
		frontmatterIgnored: new Set(),
		nextLine: new Map(),
		ranges: [],
	};

	const lint = frontmatter.lint;
	if (lint && typeof lint === 'object' && !Array.isArray(lint)) {
		const ignore = (lint as Record<string, unknown>).ignore;
		if (Array.isArray(ignore)) {
			for (const entry of ignore) {
				if (typeof entry === 'string') index.frontmatterIgnored.add(entry);
			}
		}
	}

	const lines = raw.split(/\r?\n/);
	/** Aberturas pendentes por regra (`null` = todas). */
	const open = new Map<string | null, number>();

	lines.forEach((text, position) => {
		const lineNumber = position + 1;
		DIRECTIVE_RE.lastIndex = 0;
		let match: RegExpExecArray | null;

		while ((match = DIRECTIVE_RE.exec(text)) !== null) {
			const kind = match[1];
			const ids = parseRuleIds(match[2] ?? '');

			if (kind === 'disable-next-line') {
				const target = lineNumber + 1;
				const set = index.nextLine.get(target) ?? new Set<string | null>();
				for (const id of ids) set.add(id);
				index.nextLine.set(target, set);
				continue;
			}

			if (kind === 'disable') {
				for (const id of ids) if (!open.has(id)) open.set(id, lineNumber);
				continue;
			}

			// enable
			for (const id of ids) {
				const from = open.get(id);
				if (from !== undefined) {
					index.ranges.push({ ruleId: id, from, to: lineNumber });
					open.delete(id);
				}
			}
		}
	});

	// Bloco aberto e nunca fechado vale até o fim do arquivo — é o
	// comportamento que o autor espera ao esquecer o `lint-enable`.
	for (const [ruleId, from] of open) {
		index.ranges.push({ ruleId, from, to: lines.length + 1 });
	}

	return index;
}

export function isSuppressed(
	index: SuppressionIndex,
	ruleId: string,
	line: number
): SuppressionRecord | null {
	if (index.frontmatterIgnored.has(ruleId)) {
		return { ruleId, line: null, reason: 'frontmatter' };
	}

	const forLine = index.nextLine.get(line);
	if (forLine && (forLine.has(ruleId) || forLine.has(null))) {
		return { ruleId, line, reason: 'directive' };
	}

	for (const range of index.ranges) {
		if (range.ruleId !== null && range.ruleId !== ruleId) continue;
		if (line >= range.from && line <= range.to) {
			return { ruleId, line, reason: 'directive' };
		}
	}

	return null;
}

/** Profile escolhido pela página (§40). */
export function profileFromFrontmatter(frontmatter: Record<string, unknown>): string | null {
	const lint = frontmatter.lint;
	if (!lint || typeof lint !== 'object' || Array.isArray(lint)) return null;
	const profile = (lint as Record<string, unknown>).profile;
	return typeof profile === 'string' && profile.trim() !== '' ? profile.trim() : null;
}
