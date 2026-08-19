/**
 * Semantic diff (P2.1).
 *
 * O diff textual responde "que linhas mudaram". Este responde outra coisa:
 *
 *     "o que passou a ser verdade que antes não era?"
 *
 * O exemplo da spec é exato — `30 days → 90 days` é uma linha no diff e uma
 * mudança de comportamento para quem integra. Um humano lendo o diff vê as duas
 * coisas; uma lista de commits, não.
 *
 * **O limite, dito de frente.** Isto é comparação estruturada de texto, não
 * análise semântica de verdade. Ele acha o que tem forma reconhecível: números
 * com unidade, campos obrigatórios, endpoints, autenticação, códigos de status.
 * Uma reescrita que inverte o sentido de uma frase em prosa passa despercebida —
 * e é por isso que cada achado carrega uma confiança, e por que o diff textual
 * continua ao lado em vez de ser substituído.
 *
 * Função pura: recebe os dois textos e devolve as diferenças.
 */

import type { SemanticChange } from './types';

// ---------------------------------------------------------------------------
// Extração
// ---------------------------------------------------------------------------

/** `90 dias`, `30 days`, `5 tentativas` — número com unidade tem significado. */
const VALUE = /\b(\d{1,6})\s*(dias?|days?|horas?|hours?|minutos?|minutes?|segundos?|seconds?|tentativas?|retries|vezes|times|MB|KB|GB)\b/gi;

const ENDPOINT = /\b(GET|POST|PUT|PATCH|DELETE)\s+(\/[A-Za-z0-9/_{}.:-]+)/g;

const STATUS = /\b([1-5]\d{2})\b/g;

const AUTH_HEADER = /^\s*(Authorization|Cookie|X-[A-Za-z-]*Key|X-[A-Za-z-]*Token)\s*:\s*(.+)$/gim;

/** Campos marcados como obrigatórios em YAML/JSON de exemplo. */
const REQUIRED_BLOCK = /required:\s*\n((?:\s*-\s*\w+\s*\n?)+)|required:\s*\[([^\]]*)\]/gi;

function normalizeUnit(unit: string): string {
	const lower = unit.toLowerCase();
	if (lower.startsWith('day') || lower.startsWith('dia')) return 'dias';
	if (lower.startsWith('hour') || lower.startsWith('hora')) return 'horas';
	if (lower.startsWith('minute') || lower.startsWith('minuto')) return 'minutos';
	if (lower.startsWith('second') || lower.startsWith('segundo')) return 'segundos';
	if (lower.startsWith('retr') || lower.startsWith('tentativ')) return 'tentativas';
	if (lower.startsWith('time') || lower.startsWith('vez')) return 'vezes';
	return lower;
}

/**
 * O assunto de um valor: as palavras que vêm antes dele.
 *
 * Sem isso, `90 dias` numa página com três prazos diferentes viraria uma mudança
 * sem dono — e o relatório diria "algo mudou de 30 para 90", que é pior que não
 * dizer nada.
 */
function subjectBefore(text: string, index: number): string {
	const prefix = text.slice(Math.max(0, index - 80), index);
	const words = prefix
		.replace(/[\n\r]+/g, ' ')
		.replace(/[^\p{L}\p{N}\s_-]/gu, ' ')
		.split(/\s+/)
		.filter((word) => word.length > 2);

	return words.slice(-4).join(' ').toLowerCase() || 'valor';
}

export interface ValueMention {
	subject: string;
	value: string;
	unit: string;
}

export function extractValues(text: string): ValueMention[] {
	const found: ValueMention[] = [];

	for (const match of text.matchAll(VALUE)) {
		found.push({
			subject: subjectBefore(text, match.index ?? 0),
			value: match[1],
			unit: normalizeUnit(match[2]),
		});
	}

	return found;
}

export function extractRequiredFields(text: string): string[] {
	const fields = new Set<string>();

	for (const match of text.matchAll(REQUIRED_BLOCK)) {
		const list = match[1] ?? match[2] ?? '';
		for (const item of list.split(/[\n,]/)) {
			const name = item.replace(/[-\s'"]/g, '').trim();
			if (name !== '') fields.add(name);
		}
	}

	return [...fields].sort();
}

export function extractEndpoints(text: string): string[] {
	return [...new Set([...text.matchAll(ENDPOINT)].map((match) => `${match[1]} ${match[2]}`))].sort();
}

export function extractStatusCodes(text: string): string[] {
	return [...new Set([...text.matchAll(STATUS)].map((match) => match[1]))].sort();
}

export function extractAuthMechanisms(text: string): string[] {
	return [
		...new Set(
			[...text.matchAll(AUTH_HEADER)].map((match) => {
				const header = match[1];
				const value = match[2].trim();
				if (/^bearer/i.test(value)) return 'Bearer';
				if (/^basic/i.test(value)) return 'Basic';
				if (header.toLowerCase() === 'cookie') return `Cookie: ${value.split('=')[0]}`;
				return header;
			})
		),
	].sort();
}

// ---------------------------------------------------------------------------
// Comparação
// ---------------------------------------------------------------------------

/**
 * As mudanças de comportamento entre duas versões de uma página.
 *
 * A confiança de cada achado reflete o quanto a leitura é segura. Um campo
 * obrigatório que sai de uma lista `required:` é estrutura declarada — alta. Um
 * número com unidade cujo assunto foi inferido das palavras vizinhas é uma
 * heurística boa, e nada mais que isso.
 */
export function semanticDiff(before: string, after: string): SemanticChange[] {
	const changes: SemanticChange[] = [];

	// --- valores ------------------------------------------------------------
	const beforeValues = new Map<string, ValueMention>();
	for (const mention of extractValues(before)) beforeValues.set(`${mention.subject}|${mention.unit}`, mention);

	for (const mention of extractValues(after)) {
		const key = `${mention.subject}|${mention.unit}`;
		const previous = beforeValues.get(key);

		if (previous && previous.value !== mention.value) {
			changes.push({
				kind: 'value',
				subject: `${mention.subject} (${mention.unit})`,
				before: `${previous.value} ${previous.unit}`,
				after: `${mention.value} ${mention.unit}`,
				// O assunto veio das palavras vizinhas, não de estrutura declarada.
				confidence: 0.7,
			});
		}
	}

	// --- campos obrigatórios -------------------------------------------------
	const beforeRequired = extractRequiredFields(before);
	const afterRequired = extractRequiredFields(after);

	const added = afterRequired.filter((field) => !beforeRequired.includes(field));
	const removed = beforeRequired.filter((field) => !afterRequired.includes(field));

	if (added.length > 0 || removed.length > 0) {
		changes.push({
			kind: 'required-field',
			subject: 'campos obrigatórios',
			before: beforeRequired.join(' + ') || '—',
			after: afterRequired.join(' + ') || '—',
			// Lista `required:` é declaração explícita: o que se lê é o que está lá.
			confidence: 0.95,
		});
	}

	// --- endpoints -----------------------------------------------------------
	const beforeEndpoints = extractEndpoints(before);
	const afterEndpoints = extractEndpoints(after);

	for (const endpoint of afterEndpoints.filter((item) => !beforeEndpoints.includes(item))) {
		changes.push({ kind: 'endpoint', subject: endpoint, after: 'passou a ser documentado', confidence: 0.9 });
	}

	for (const endpoint of beforeEndpoints.filter((item) => !afterEndpoints.includes(item))) {
		changes.push({ kind: 'endpoint', subject: endpoint, before: 'era documentado', confidence: 0.9 });
	}

	// --- autenticação --------------------------------------------------------
	const beforeAuth = extractAuthMechanisms(before);
	const afterAuth = extractAuthMechanisms(after);

	if (beforeAuth.join(',') !== afterAuth.join(',') && (beforeAuth.length > 0 || afterAuth.length > 0)) {
		changes.push({
			kind: 'authentication',
			subject: 'mecanismo de autenticação',
			before: beforeAuth.join(', ') || '—',
			after: afterAuth.join(', ') || '—',
			confidence: 0.85,
		});
	}

	// --- códigos de status ---------------------------------------------------
	const beforeStatus = extractStatusCodes(before);
	const afterStatus = extractStatusCodes(after);

	const newStatus = afterStatus.filter((code) => !beforeStatus.includes(code));
	const goneStatus = beforeStatus.filter((code) => !afterStatus.includes(code));

	if (newStatus.length > 0 || goneStatus.length > 0) {
		changes.push({
			kind: 'status-code',
			subject: 'códigos de status documentados',
			before: beforeStatus.join(', ') || '—',
			after: afterStatus.join(', ') || '—',
			// Número de três dígitos também aparece em outros contextos; daí o peso
			// menor que o dos campos obrigatórios.
			confidence: 0.6,
		});
	}

	return changes.sort((a, b) => b.confidence - a.confidence);
}
