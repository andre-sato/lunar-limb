/**
 * Redação de credenciais nos trechos exibidos.
 *
 * Documentação vive em repositório, e repositório às vezes recebe uma chave por
 * descuido. Quando isso acontece, a busca não deve ser o mecanismo que espalha
 * o vazamento — nem para a tela, nem para o histórico da conversa.
 *
 * O cuidado oposto é igualmente importante: `<SUA_CHAVE>` e `YOUR_API_KEY` são
 * o conteúdo útil de uma página de autenticação. Redigi-los transformaria a
 * documentação em ruído, então o reconhecimento de placeholder vem antes da
 * redação.
 *
 * Este arquivo já foi maior: enquanto havia um modelo de linguagem, ele também
 * neutralizava texto com forma de instrução vindo das páginas. Sem modelo, não
 * há prompt para atacar, e essa camada saiu em vez de ficar como peso morto.
 */

import type { SafetyCategory } from './types';

// ---------------------------------------------------------------------------
// Segredos (§30)
// ---------------------------------------------------------------------------

interface SecretPattern {
	name: string;
	pattern: RegExp;
}

/**
 * Formatos de credencial. A lista cobre os provedores que apareceriam neste
 * projeto e os formatos genéricos; não pretende ser exaustiva, e por isso
 * existe também o padrão de atribuição genérica no fim.
 */
const SECRET_PATTERNS: SecretPattern[] = [
	{ name: 'openai', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
	{ name: 'anthropic', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
	{ name: 'aws-access-key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
	{ name: 'github', pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
	{ name: 'slack', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
	{ name: 'google', pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/g },
	{ name: 'stripe', pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b/g },
	{ name: 'supabase', pattern: /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{15,}\b/g },
	{ name: 'private-key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g },
	{ name: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
	// Bearer com material longo o bastante para ser real, não placeholder.
	{ name: 'bearer', pattern: /\bBearer\s+[A-Za-z0-9_\-.]{24,}\b/g },
	// Atribuição genérica: `api_key = "..."`, `password: '...'`.
	{
		name: 'assignment',
		pattern:
			/\b(?:api[_-]?key|secret|token|password|passwd|senha|client[_-]?secret|access[_-]?key)\b\s*[:=]\s*["']?[A-Za-z0-9_\-./+]{16,}["']?/gi,
	},
];

/**
 * Placeholders legítimos (§31): a documentação **precisa** mostrar onde a chave
 * entra. `<SUA_CHAVE>` e `YOUR_API_KEY` são exemplos, não vazamentos.
 */
const PLACEHOLDER = /^(?:<[^>]*>|\{\{?[^}]*\}?\}|\$\{?[A-Z_]+\}?|(?:YOUR|SUA|MY|MINHA|EXAMPLE|EXEMPLO|TEST|TESTE|DUMMY|FAKE|XXX+|\.{3})[A-Z_0-9]*|[Xx]{6,}|(?:sua|your)[-_].*)$/i;

function looksLikePlaceholder(value: string): boolean {
	const trimmed = value.trim().replace(/^["']|["']$/g, '');
	if (PLACEHOLDER.test(trimmed)) return true;
	// Sequência sem entropia real: só repetição ou só um caractere.
	if (/^(.)\1+$/.test(trimmed)) return true;
	// `x{4,}` sem borda de palavra à direita: a documentação escreve
	// `token: xxxxxxxxxxxx`, e exigir a borda o trataria como segredo real.
	return /\b(?:your|sua|seu|example|exemplo|placeholder|redacted)\b|x{4,}/i.test(trimmed);
}

export interface SecretFinding {
	name: string;
	/** Trecho já mascarado — o valor original nunca é propagado. */
	masked: string;
}

export function detectSecrets(text: string): SecretFinding[] {
	const found: SecretFinding[] = [];

	for (const { name, pattern } of SECRET_PATTERNS) {
		const regex = new RegExp(pattern.source, pattern.flags);
		let match: RegExpExecArray | null;
		while ((match = regex.exec(text)) !== null) {
			if (looksLikePlaceholder(match[0])) continue;
			found.push({ name, masked: maskValue(match[0]) });
		}
	}

	return found;
}

function maskValue(value: string): string {
	if (value.length <= 8) return '••••';
	return `${value.slice(0, 4)}••••${value.slice(-2)}`;
}

/** Substitui credenciais por marcador. Usado na saída do modelo. */
export function redactSecrets(text: string): { text: string; redacted: number } {
	let output = text;
	let redacted = 0;

	for (const { pattern } of SECRET_PATTERNS) {
		const regex = new RegExp(pattern.source, pattern.flags);
		output = output.replace(regex, (match) => {
			if (looksLikePlaceholder(match)) return match;
			redacted++;
			return '[credencial removida]';
		});
	}

	return { text: output, redacted };
}

// ---------------------------------------------------------------------------
// PII e higienização do contexto
//
// Voltaram do histórico junto com a camada de LLM: um trecho que vai para o
// modelo precisa de tratamento que um trecho mostrado ao leitor não precisa. A
// diferença é que o modelo pode ser instruído pelo que lê; o leitor, não.
// ---------------------------------------------------------------------------

const PII_PATTERNS: SecretPattern[] = [
	// E-mail que não seja de domínio de exemplo.
	{ name: 'email', pattern: /\b[A-Za-z0-9._%+-]+@(?!example\.|exemplo\.|test\.|localhost)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
	{ name: 'cpf', pattern: /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g },
	{ name: 'cnpj', pattern: /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g },
	{ name: 'phone-br', pattern: /\(\d{2}\)\s?9?\d{4}-\d{4}\b/g },
	{ name: 'credit-card', pattern: /\b(?:\d{4}[\s-]?){3}\d{4}\b/g },
	{ name: 'ssn', pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
];

export function detectPii(text: string): SecretFinding[] {
	const found: SecretFinding[] = [];

	for (const { name, pattern } of PII_PATTERNS) {
		const regex = new RegExp(pattern.source, pattern.flags);
		let match: RegExpExecArray | null;
		while ((match = regex.exec(text)) !== null) {
			found.push({ name, masked: maskValue(match[0]) });
		}
	}

	return found;
}

// ---------------------------------------------------------------------------
// Conteúdo recuperado (§16, §37, §39)
// ---------------------------------------------------------------------------

/**
 * Padrões de instrução dentro de documento. Um texto de documentação descreve;
 * ele não manda o assistente fazer coisas.
 */
const INDIRECT_INJECTION_PATTERNS: RegExp[] = [
	/\b(?:ignore|disregard|forget|override)\b[^.!?\n]{0,40}\b(?:previous|prior|above|all|system)\b[^.!?\n]{0,20}\b(?:instruction|prompt|rule)/i,
	/\b(?:ignore|desconsidere|esque[çc]a)\b[^.!?\n]{0,40}\b(?:instru|regra|prompt|anterior)/i,
	/\b(?:reveal|show|print|output|repeat)\b[^.!?\n]{0,30}\b(?:system|internal|hidden)\b[^.!?\n]{0,15}\bprompt/i,
	/\b(?:revele|mostre|imprima)\b[^.!?\n]{0,30}\b(?:system prompt|prompt do sistema|instru[çc][õo]es internas)/i,
	/\byou (?:are|must|should) (?:now )?(?:act|behave|respond|answer)\b[^.!?\n]{0,30}\b(?:as|like)\b/i,
	/\b(?:assistant|ai|model|chatbot)\b[^.!?\n]{0,20}\b(?:must|should|shall|deve)\b[^.!?\n]{0,30}\b(?:ignore|reveal|disregard|revelar|ignorar)/i,
	/\bnew instructions?\b\s*:/i,
	/\bnovas instru[çc][õo]es\b\s*:/i,
	// Injeção de papel via marcação de conversa.
	/^\s*(?:system|assistant|user)\s*:\s*/im,
	/<\|(?:im_start|im_end|system|endoftext)\|>/i,
];

export interface SanitizedContent {
	content: string;
	/** `true` quando algo com forma de instrução foi encontrado e neutralizado. */
	injectionDetected: boolean;
	categories: SafetyCategory[];
	removed: string[];
}

/**
 * Prepara um trecho recuperado para entrar no prompt.
 *
 * Não basta detectar e barrar: a página pode ser legítima e conter a frase por
 * coincidência (a própria documentação deste chatbot descreve ataques de
 * injeção). Então o tratamento é **neutralizar e sinalizar**, não descartar —
 * descartar deixaria o assistente sem a informação e sem explicação.
 */
export function sanitizeRetrievedContent(raw: string, maxLength = 4000): SanitizedContent {
	const removed: string[] = [];
	const categories: SafetyCategory[] = [];
	let content = raw;

	// Elementos executáveis ou capazes de esconder texto do revisor humano.
	content = content
		.replace(/<script\b[\s\S]*?<\/script>/gi, () => {
			removed.push('script');
			return '';
		})
		.replace(/<style\b[\s\S]*?<\/style>/gi, '')
		.replace(/<iframe\b[\s\S]*?(?:<\/iframe>|>)/gi, () => {
			removed.push('iframe');
			return '';
		})
		// Comentário HTML é o esconderijo clássico: invisível na página
		// renderizada, mas presente no Markdown que o RAG lê.
		.replace(/<!--[\s\S]*?-->/g, () => {
			removed.push('comentário');
			return '';
		})
		.replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
		.replace(/javascript:/gi, '');

	// Sequências de controle que poderiam fingir uma virada de turno.
	content = content.replace(/<\|[^|>]*\|>/g, '');

	let injectionDetected = false;
	for (const pattern of INDIRECT_INJECTION_PATTERNS) {
		if (!pattern.test(content)) continue;
		injectionDetected = true;
		// Neutraliza marcando o trecho como citação inerte, preservando a
		// leitura para o caso de ser conteúdo legítimo.
		content = content.replace(new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`), (match) => {
			removed.push(match.slice(0, 80));
			return `[trecho com forma de instrução, tratado como texto: ${match.slice(0, 60).replace(/[\r\n]+/g, ' ')}]`;
		});
	}

	if (injectionDetected) categories.push('prompt-injection');

	// Credenciais reais na documentação não devem ir para o modelo nem para a
	// resposta, mesmo que estejam no repositório por engano.
	const secrets = detectSecrets(content);
	if (secrets.length > 0) {
		content = redactSecrets(content).text;
		categories.push('secret-exposure');
		removed.push(`${secrets.length} credencial(is)`);
	}

	// Fechar delimitadores impede que o trecho termine o próprio bloco de
	// contexto e "escape" para a área de instruções.
	content = content.replace(/<\/?documentation_context>/gi, '').replace(/<\/?document>/gi, '');

	if (content.length > maxLength) {
		content = `${content.slice(0, maxLength)}\n[trecho truncado]`;
	}

	return { content: content.trim(), injectionDetected, categories, removed };
}
