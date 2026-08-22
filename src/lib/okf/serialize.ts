/**
 * Bytes do bundle: conceito, índice e log viram texto aqui (issue #16).
 *
 * A saída precisa ser **determinística**. O bundle é comitado, e um teste
 * compara o que o gerador produz com o que está no disco — se a ordem das
 * chaves do YAML variasse entre execuções, esse teste falharia sozinho e
 * ensinaria a equipe a ignorá-lo.
 *
 * Fim de linha é sempre `\n`: o `.gitattributes` normaliza o repositório em LF,
 * e emitir CRLF no Windows produziria um diff inteiro a cada build feito de lá.
 */

import yaml from 'js-yaml';
import type {
	OkfConcept,
	OkfFrontmatter,
	OkfIndex,
	OkfLog,
} from './types';

/**
 * Ordem em que as chaves saem no frontmatter.
 *
 * Fixa e não alfabética: `type` primeiro porque é o único campo obrigatório e
 * quem abre o arquivo procura por ele; a família de confiança junta no fim
 * porque `generated`/`verified`/`status`/`stale_after` só fazem sentido lidos
 * em conjunto.
 */
const KEY_ORDER = [
	'type',
	'title',
	'description',
	'resource',
	'tags',
	'status',
	'generated',
	'verified',
	'stale_after',
	'sources',
] as const;

const YAML_OPTIONS = {
	lineWidth: -1,
	noRefs: true,
	// A spec pede YAML; `flowLevel` solto produziria `{a: 1}` em lugares onde a
	// forma em bloco é mais legível para quem revisa o diff.
	flowLevel: -1,
} as const;

function isEmpty(value: unknown): boolean {
	if (value === undefined || value === null) return true;
	if (typeof value === 'string') return value.trim() === '';
	if (Array.isArray(value)) return value.length === 0;
	if (typeof value === 'object') return Object.keys(value as object).length === 0;
	return false;
}

/**
 * Monta o objeto que vai para o YAML, na ordem declarada.
 *
 * Campos vazios são omitidos em vez de sair como `null`: a spec manda o
 * consumidor não recusar um conceito por família ausente, e `description: null`
 * é pior que ausente — obriga cada consumidor a tratar dois jeitos de não ter
 * descrição.
 */
export function frontmatterObject(frontmatter: OkfFrontmatter): Record<string, unknown> {
	const out: Record<string, unknown> = {};

	for (const key of KEY_ORDER) {
		const value = (frontmatter as unknown as Record<string, unknown>)[key];
		if (!isEmpty(value)) out[key] = value;
	}

	// As extensões vão por último e em ordem alfabética: são campos que a spec
	// não nomeia, então nenhuma ordem entre eles é mais "certa" que outra, e
	// alfabética é a única estável sem alguém manter uma lista.
	const extensions = frontmatter.extensions ?? {};
	for (const key of Object.keys(extensions).sort()) {
		if (!isEmpty(extensions[key])) out[key] = extensions[key];
	}

	return out;
}

/** Um conceito como o arquivo `.md` que ele é. */
export function serializeConcept(concept: OkfConcept): string {
	const front = yaml.dump(frontmatterObject(concept.frontmatter), YAML_OPTIONS).trimEnd();
	// CR+LF, CR solto e CR+CR+LF: trocar só o par deixa este último virar um
	// CRLF novo em folha, e foi assim que um sobreviveu até o bundle.
	const body = concept.body.replace(/\r\n?/g, '\n').trim();
	return `---\n${front}\n---\n\n${body}\n`;
}

/**
 * Um `index.md`.
 *
 * Só a raiz do bundle carrega frontmatter, e só com `okf_version` — a spec
 * restringe isso explicitamente, e declarar a versão em cada subdiretório
 * criaria a possibilidade de duas versões no mesmo bundle.
 */
export function serializeIndex(index: OkfIndex): string {
	const lines: string[] = [];

	if (index.okfVersion) {
		lines.push('---', `okf_version: "${index.okfVersion}"`, '---', '');
	}

	if (index.title) {
		lines.push(`# ${index.title}`, '');
	}
	if (index.description) {
		lines.push(index.description, '');
	}

	for (const section of index.sections) {
		if (section.entries.length === 0) continue;
		lines.push(`# ${section.heading}`, '');
		for (const entry of section.entries) {
			const suffix = entry.description ? ` - ${entry.description}` : '';
			lines.push(`* [${entry.title}](${entry.href})${suffix}`);
		}
		lines.push('');
	}

	return `${lines.join('\n').trimEnd()}\n`;
}

/** Um `log.md`: dias em ordem decrescente, entradas em prosa. */
export function serializeLog(log: OkfLog): string {
	const byDate = new Map<string, typeof log.entries>();
	for (const entry of log.entries) {
		const bucket = byDate.get(entry.date) ?? [];
		bucket.push(entry);
		byDate.set(entry.date, bucket);
	}

	const lines: string[] = [];
	for (const date of [...byDate.keys()].sort().reverse()) {
		lines.push(`# ${date}`, '');
		for (const entry of byDate.get(date) ?? []) {
			lines.push(`**${entry.kind}** ${entry.text}`, '');
		}
	}

	return `${lines.join('\n').trimEnd()}\n`;
}
