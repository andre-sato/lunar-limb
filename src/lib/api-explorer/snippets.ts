/**
 * Geração de exemplos de código (§8).
 *
 * O que sai daqui é o mesmo pedido que o botão "Enviar" faz — não uma
 * aproximação escrita à parte. Se os dois divergirem, o exemplo vira uma
 * armadilha: funciona na tela e falha no terminal de quem copiou.
 *
 * As credenciais **não** entram no código gerado. No lugar delas vai um
 * marcador: um exemplo é feito para ser colado num chat, num ticket ou numa
 * página, e nenhum desses lugares deveria receber o token de ninguém (§5).
 */

export interface RequestSpec {
	method: string;
	url: string;
	headers: Record<string, string>;
	body?: string;
	contentType?: string;
}

export type SnippetLanguage = 'curl' | 'javascript' | 'python' | 'go';

export const SNIPPET_LABELS: Record<SnippetLanguage, string> = {
	curl: 'cURL',
	javascript: 'JavaScript',
	python: 'Python',
	go: 'Go',
};

/** Marcador que substitui a credencial no exemplo. */
export const SECRET_PLACEHOLDER = '$SUA_CREDENCIAL';

const SECRET_HEADERS = [/^authorization$/i, /^proxy-authorization$/i, /api[-_]?key/i, /token/i, /^cookie$/i];

function maskValue(name: string, value: string): string {
	if (!SECRET_HEADERS.some((pattern) => pattern.test(name))) return value;

	// Preserva o prefixo do esquema (`Bearer`, `Basic`) porque ele faz parte do
	// formato, não do segredo: sem ele o exemplo copiado não funcionaria.
	const scheme = value.match(/^(Bearer|Basic|Token)\s+/i);
	return scheme ? `${scheme[1]} ${SECRET_PLACEHOLDER}` : SECRET_PLACEHOLDER;
}

function maskedHeaders(headers: Record<string, string>): Array<[string, string]> {
	return Object.entries(headers)
		.filter(([, value]) => value !== '')
		.map(([name, value]) => [name, maskValue(name, value)] as [string, string]);
}

function shellQuote(value: string): string {
	// Aspas simples com escape do próprio apóstrofo: a forma que não interpreta
	// nada dentro, que é o que um valor de exemplo precisa.
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function curl(spec: RequestSpec): string {
	const lines = [`curl -X ${spec.method.toUpperCase()} ${shellQuote(spec.url)}`];

	for (const [name, value] of maskedHeaders(spec.headers)) {
		lines.push(`  -H ${shellQuote(`${name}: ${value}`)}`);
	}

	if (spec.body) lines.push(`  -d ${shellQuote(spec.body)}`);

	return lines.join(' \\\n');
}

function javascript(spec: RequestSpec): string {
	const headers = maskedHeaders(spec.headers);
	const parts = [`const response = await fetch(${JSON.stringify(spec.url)}, {`, `  method: ${JSON.stringify(spec.method.toUpperCase())},`];

	if (headers.length > 0) {
		parts.push('  headers: {');
		for (const [name, value] of headers) parts.push(`    ${JSON.stringify(name)}: ${JSON.stringify(value)},`);
		parts.push('  },');
	}

	if (spec.body) parts.push(`  body: ${JSON.stringify(spec.body)},`);

	parts.push('});', '', 'const data = await response.json();', 'console.log(response.status, data);');
	return parts.join('\n');
}

function python(spec: RequestSpec): string {
	const headers = maskedHeaders(spec.headers);
	const parts = ['import requests', ''];

	if (headers.length > 0) {
		parts.push('headers = {');
		for (const [name, value] of headers) parts.push(`    ${JSON.stringify(name)}: ${JSON.stringify(value)},`);
		parts.push('}', '');
	}

	const args = [JSON.stringify(spec.url)];
	if (headers.length > 0) args.push('headers=headers');
	if (spec.body) {
		parts.push(`data = ${JSON.stringify(spec.body)}`, '');
		args.push('data=data');
	}

	parts.push(`response = requests.${spec.method.toLowerCase()}(${args.join(', ')})`);
	parts.push('print(response.status_code, response.text)');
	return parts.join('\n');
}

function go(spec: RequestSpec): string {
	const headers = maskedHeaders(spec.headers);
	const body = spec.body ? `strings.NewReader(${JSON.stringify(spec.body)})` : 'nil';

	const imports = ['"fmt"', '"io"', '"net/http"'];
	if (spec.body) imports.push('"strings"');

	const parts = [
		'package main',
		'',
		'import (',
		...imports.map((entry) => `\t${entry}`),
		')',
		'',
		'func main() {',
		`\treq, err := http.NewRequest(${JSON.stringify(spec.method.toUpperCase())}, ${JSON.stringify(spec.url)}, ${body})`,
		'\tif err != nil {',
		'\t\tpanic(err)',
		'\t}',
	];

	for (const [name, value] of headers) {
		parts.push(`\treq.Header.Set(${JSON.stringify(name)}, ${JSON.stringify(value)})`);
	}

	parts.push(
		'',
		'\tres, err := http.DefaultClient.Do(req)',
		'\tif err != nil {',
		'\t\tpanic(err)',
		'\t}',
		'\tdefer res.Body.Close()',
		'',
		'\tout, _ := io.ReadAll(res.Body)',
		'\tfmt.Println(res.Status, string(out))',
		'}'
	);

	return parts.join('\n');
}

const GENERATORS: Record<SnippetLanguage, (spec: RequestSpec) => string> = {
	curl,
	javascript,
	python,
	go,
};

export function generateSnippet(language: SnippetLanguage, spec: RequestSpec): string {
	return GENERATORS[language](spec);
}
