/**
 * Conformidade OKF v0.2 (issue #16).
 *
 * A spec é deliberadamente permissiva, e o validador respeita isso: um bundle é
 * conformante quando todo `.md` não reservado tem frontmatter YAML legível com
 * `type` não vazio, e os arquivos reservados têm a forma descrita. Só isso.
 *
 * Por que a permissividade importa aqui: a spec manda o consumidor **não**
 * recusar um conceito por tipo desconhecido, chave desconhecida, link quebrado
 * ou `index.md` ausente. Um validador que reprovasse por isso produziria um
 * bundle que só o nosso portal aceita — o oposto do ponto de um formato aberto.
 * Essas coisas viram **aviso**, e aviso não derruba o build.
 */

import yaml from 'js-yaml';
import { OKF_VERSION, RESERVED_FILENAMES } from './types';

export type Severity = 'error' | 'warning';

export interface OkfFinding {
	severity: Severity;
	/** Caminho do arquivo dentro do bundle. */
	path: string;
	/** Regra violada, para agrupar e silenciar por nome. */
	rule: string;
	message: string;
}

export interface OkfValidation {
	conformant: boolean;
	files: number;
	concepts: number;
	findings: OkfFinding[];
}

/** Um arquivo do bundle, já lido. */
export interface OkfFile {
	/** Relativo à raiz do bundle, POSIX. */
	path: string;
	contents: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

function basename(filePath: string): string {
	const parts = filePath.split('/');
	return parts[parts.length - 1] ?? filePath;
}

function isReserved(filePath: string): boolean {
	return (RESERVED_FILENAMES as readonly string[]).includes(basename(filePath));
}

/**
 * Os links internos que o corpo cita, na forma que a spec reconhece.
 *
 * Só interessam os que apontam para dentro do bundle: um link para
 * `https://...` é responsabilidade de quem publicou aquele endereço, não do
 * bundle.
 */
function internalLinks(body: string): string[] {
	const found: string[] = [];
	const pattern = /\[[^\]]*\]\(([^)\s]+)\)/g;
	let match: RegExpExecArray | null;

	while ((match = pattern.exec(body)) !== null) {
		const href = match[1] ?? '';
		if (href === '' || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#')) continue;
		found.push(href.split('#')[0] ?? href);
	}

	return found;
}

/** Resolve um link relativo ao arquivo que o contém, para conferir se existe. */
function resolveLink(fromPath: string, href: string): string {
	if (href.startsWith('/')) return href.slice(1);

	const segments = fromPath.split('/').slice(0, -1);
	for (const part of href.split('/')) {
		if (part === '' || part === '.') continue;
		if (part === '..') segments.pop();
		else segments.push(part);
	}
	return segments.join('/');
}

/**
 * Avalia um bundle já lido em memória.
 *
 * Recebe os arquivos em vez de um caminho para que o mesmo código sirva ao CLI
 * (que lê do disco), ao teste (que monta bundles na mão) e a uma futura rota
 * que valide o bundle publicado sem gravar nada.
 */
export function validateBundle(files: readonly OkfFile[]): OkfValidation {
	const findings: OkfFinding[] = [];
	const present = new Set(files.map((file) => file.path));
	let concepts = 0;

	for (const file of files) {
		if (!file.path.endsWith('.md')) continue;

		const reserved = isReserved(file.path);
		const match = file.contents.match(FRONTMATTER);

		if (reserved) {
			validateReserved(file, findings);
		} else {
			concepts++;

			// Regra 1 da spec: frontmatter presente e legível.
			if (!match) {
				findings.push({
					severity: 'error',
					path: file.path,
					rule: 'frontmatter-required',
					message: 'Conceito sem bloco de frontmatter YAML delimitado por `---`.',
				});
				continue;
			}

			let parsed: unknown;
			try {
				parsed = yaml.load(match[1] ?? '');
			} catch (error) {
				findings.push({
					severity: 'error',
					path: file.path,
					rule: 'frontmatter-parseable',
					message: `Frontmatter ilegível: ${error instanceof Error ? error.message : String(error)}`,
				});
				continue;
			}

			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
				findings.push({
					severity: 'error',
					path: file.path,
					rule: 'frontmatter-parseable',
					message: 'Frontmatter precisa ser um mapa YAML.',
				});
				continue;
			}

			const frontmatter = parsed as Record<string, unknown>;

			// Regra 2 da spec: `type` presente e não vazio. É a única exigência de
			// campo do formato inteiro.
			const type = frontmatter.type;
			if (typeof type !== 'string' || type.trim() === '') {
				findings.push({
					severity: 'error',
					path: file.path,
					rule: 'type-required',
					message: 'Falta `type` não vazio — o único campo obrigatório do OKF.',
				});
			}

			validateOptionalFamilies(file.path, frontmatter, findings);
		}

		// Link quebrado é aviso, nunca erro: a spec manda o consumidor tolerar.
		const body = match ? file.contents.slice(match[0].length) : file.contents;
		for (const href of internalLinks(body)) {
			const target = resolveLink(file.path, href);
			if (!present.has(target)) {
				findings.push({
					severity: 'warning',
					path: file.path,
					rule: 'link-resolves',
					message: `Link para \`${href}\` não corresponde a nenhum arquivo do bundle.`,
				});
			}
		}
	}

	return {
		conformant: findings.every((finding) => finding.severity !== 'error'),
		files: files.length,
		concepts,
		findings,
	};
}

/**
 * As famílias opcionais, quando presentes, precisam ter a forma da spec.
 *
 * Ausência nunca é problema; forma errada é. Um `verified` com data inválida é
 * pior que um `verified` ausente, porque o consumidor deriva nível de confiança
 * dele e uma data ilegível vira uma confiança silenciosamente errada.
 */
function validateOptionalFamilies(
	filePath: string,
	frontmatter: Record<string, unknown>,
	findings: OkfFinding[]
): void {
	const isoDate = (value: unknown): boolean =>
		typeof value === 'string' && !Number.isNaN(Date.parse(value));

	const generated = frontmatter.generated;
	if (generated !== undefined) {
		const record = generated as Record<string, unknown>;
		if (!record || typeof record !== 'object' || typeof record.by !== 'string' || !isoDate(record.at)) {
			findings.push({
				severity: 'warning',
				path: filePath,
				rule: 'generated-shape',
				message: '`generated` precisa ser `{ by: <ator>, at: <ISO 8601> }`.',
			});
		}
	}

	const verified = frontmatter.verified;
	if (verified !== undefined) {
		// A spec aceita mapa solto como lista de um: normalizar aqui evita que o
		// aviso dispare por uma forma que é legítima.
		const list = Array.isArray(verified) ? verified : [verified];
		for (const entry of list) {
			const record = entry as Record<string, unknown>;
			if (!record || typeof record !== 'object' || typeof record.by !== 'string' || !isoDate(record.at)) {
				findings.push({
					severity: 'warning',
					path: filePath,
					rule: 'verified-shape',
					message: 'Cada `verified` precisa ser `{ by: <ator>, at: <ISO 8601> }`.',
				});
				break;
			}
		}
	}

	const status = frontmatter.status;
	if (status !== undefined && !['draft', 'stable', 'deprecated'].includes(status as string)) {
		findings.push({
			severity: 'warning',
			path: filePath,
			rule: 'status-vocabulary',
			message: `\`status\` desconhecido: "${String(status)}". Use draft, stable ou deprecated.`,
		});
	}

	if (frontmatter.stale_after !== undefined && !isoDate(frontmatter.stale_after)) {
		findings.push({
			severity: 'warning',
			path: filePath,
			rule: 'stale-after-shape',
			message: '`stale_after` precisa ser uma data ISO 8601.',
		});
	}

	const sources = frontmatter.sources;
	if (sources !== undefined) {
		if (!Array.isArray(sources)) {
			findings.push({
				severity: 'warning',
				path: filePath,
				rule: 'sources-shape',
				message: '`sources` precisa ser uma lista.',
			});
		} else {
			for (const source of sources) {
				const record = source as Record<string, unknown>;
				if (!record || typeof record !== 'object' || typeof record.resource !== 'string') {
					findings.push({
						severity: 'warning',
						path: filePath,
						rule: 'sources-shape',
						message: 'Cada fonte precisa de `resource`.',
					});
					break;
				}
			}
		}
	}

	// `timestamp` era o campo da v0.1 e foi substituído por `generated`. Quem
	// migra um bundle antigo esquece justamente este.
	if (frontmatter.timestamp !== undefined && frontmatter.generated === undefined) {
		findings.push({
			severity: 'warning',
			path: filePath,
			rule: 'v01-timestamp',
			message: '`timestamp` é da v0.1. Na v0.2 use `generated: { by, at }`.',
		});
	}
}

/**
 * Regra 3 da spec: os arquivos reservados têm forma descrita.
 *
 * Fraca de propósito. A spec descreve `index.md` como seções com listas de
 * links e `log.md` como datas ISO em ordem decrescente, mas não impõe nada
 * além disso, e um validador mais rígido que a spec inventaria conformidade.
 */
function validateReserved(file: OkfFile, findings: OkfFinding[]): void {
	const name = basename(file.path);
	const depth = file.path.split('/').length - 1;

	if (name === 'index.md') {
		const match = file.contents.match(FRONTMATTER);
		if (match) {
			let parsed: unknown;
			try {
				parsed = yaml.load(match[1] ?? '');
			} catch {
				findings.push({
					severity: 'error',
					path: file.path,
					rule: 'index-frontmatter-parseable',
					message: 'Frontmatter do índice ilegível.',
				});
				return;
			}

			const keys = Object.keys((parsed ?? {}) as object);
			// Só a raiz declara a versão. Um `okf_version` num subdiretório
			// permitiria duas versões no mesmo bundle, e nenhum consumidor teria
			// como escolher entre elas.
			if (keys.includes('okf_version') && depth > 0) {
				findings.push({
					severity: 'error',
					path: file.path,
					rule: 'okf-version-root-only',
					message: '`okf_version` só pode aparecer no `index.md` da raiz do bundle.',
				});
			}

			const declared = (parsed as Record<string, unknown> | null)?.okf_version;
			if (depth === 0 && declared !== undefined && String(declared) !== OKF_VERSION) {
				findings.push({
					severity: 'warning',
					path: file.path,
					rule: 'okf-version-supported',
					message: `Bundle declara OKF ${String(declared)}; este gerador escreve ${OKF_VERSION}.`,
				});
			}
		}
	}

	if (name === 'log.md') {
		const headings = [...file.contents.matchAll(/^#\s+(.+)$/gm)].map((match) => (match[1] ?? '').trim());
		const bad = headings.filter((heading) => !/^\d{4}-\d{2}-\d{2}$/.test(heading));
		if (bad.length > 0) {
			findings.push({
				severity: 'warning',
				path: file.path,
				rule: 'log-date-headings',
				message: `Cabeçalhos do log devem ser datas ISO \`YYYY-MM-DD\`. Fora do padrão: ${bad.slice(0, 3).join(', ')}.`,
			});
		}

		const dates = headings.filter((heading) => /^\d{4}-\d{2}-\d{2}$/.test(heading));
		const sorted = [...dates].sort().reverse();
		if (dates.join('|') !== sorted.join('|')) {
			findings.push({
				severity: 'warning',
				path: file.path,
				rule: 'log-newest-first',
				message: 'O log deve listar as datas da mais recente para a mais antiga.',
			});
		}
	}
}
