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
