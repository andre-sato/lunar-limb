import { describe, it, expect } from 'vitest';
import {
	OpenApiError,
	buildPath,
	exampleFromSchema,
	fallbackOperationId,
	parseOpenApi,
} from '../src/lib/api-explorer/model';
import {
	allowedOrigins,
	checkTarget,
	isSecretHeader,
	redactHeaders,
	sanitizeHeaders,
} from '../src/lib/api-explorer/proxy-policy';
import { SECRET_PLACEHOLDER, generateSnippet } from '../src/lib/api-explorer/snippets';
import { buildRequest, missingRequired } from '../src/lib/api-explorer/request';

const SPEC = `openapi: 3.1.0
info:
  title: API de exemplo
  version: '1.0.0'
servers:
  - url: https://api.exemplo.com/v1
security:
  - apiKey: []
paths:
  /users/{id}:
    parameters:
      - name: id
        in: path
        required: true
        description: Identificador do usuário.
        schema:
          type: string
          example: usr_123
    get:
      operationId: getUser
      summary: Busca um usuário
      tags: [users]
      parameters:
        - name: include
          in: query
          schema:
            type: string
            enum: [profile, orders]
      responses:
        '200':
          description: Usuário encontrado
          content:
            application/json:
              schema:
                type: object
                properties:
                  id: { type: string }
        '404':
          description: Não encontrado
  /users:
    post:
      operationId: createUser
      summary: Cria um usuário
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [name, email]
              properties:
                name: { type: string }
                email: { type: string, format: email }
                idade: { type: integer }
      responses:
        '201':
          description: Criado
  /health:
    get:
      summary: Estado do serviço
      security: []
      responses:
        '200':
          description: OK
components:
  securitySchemes:
    apiKey:
      type: apiKey
      in: header
      name: X-API-Key
    bearer:
      type: http
      scheme: bearer
`;

const model = parseOpenApi(SPEC);

// ---------------------------------------------------------------------------
// §2 — a especificação é a fonte
// ---------------------------------------------------------------------------

describe('leitura da especificação', () => {
	it('lê título, versão e servidores', () => {
		expect(model.title).toBe('API de exemplo');
		expect(model.version).toBe('1.0.0');
		expect(model.servers).toEqual(['https://api.exemplo.com/v1']);
	});

	it('encontra as operações', () => {
		expect(model.operations.map((operation) => operation.id).sort()).toEqual([
			'createUser',
			'get-health',
			'getUser',
		]);
	});

	it('gera id estável para operação sem operationId', () => {
		expect(fallbackOperationId('get', '/users/{id}/orders')).toBe('get-users-id-orders');
	});

	it('recusa documento que não é OpenAPI', () => {
		expect(() => parseOpenApi("asyncapi: '2.6.0'\ninfo:\n  title: X\n")).toThrow(OpenApiError);
		expect(() => parseOpenApi('')).toThrow(/vazio/);
	});
});

describe('parâmetros', () => {
	const getUser = model.operations.find((operation) => operation.id === 'getUser')!;

	it('junta os do caminho com os da operação', () => {
		expect(getUser.parameters.map((parameter) => parameter.name)).toEqual(['id', 'include']);
	});

	it('parâmetro de caminho é sempre obrigatório', () => {
		expect(getUser.parameters[0]).toMatchObject({ location: 'path', required: true, example: 'usr_123' });
	});

	it('traz os valores aceitos quando o schema os restringe', () => {
		expect(getUser.parameters[1].enum).toEqual(['profile', 'orders']);
	});

	it('substitui os marcadores do caminho', () => {
		expect(buildPath('/users/{id}/orders/{orderId}', { id: 'usr_1', orderId: 'o_2' })).toBe(
			'/users/usr_1/orders/o_2'
		);
	});

	it('escapa o valor no caminho', () => {
		expect(buildPath('/users/{id}', { id: 'a/b?c' })).toBe('/users/a%2Fb%3Fc');
	});

	it('sem valor, o marcador fica — a URL não sai errada em silêncio', () => {
		expect(buildPath('/users/{id}', {})).toBe('/users/{id}');
	});
});

describe('corpo da requisição', () => {
	const createUser = model.operations.find((operation) => operation.id === 'createUser')!;

	it('monta um exemplo a partir do schema', () => {
		expect(createUser.requestBody?.contentType).toBe('application/json');
		const example = JSON.parse(createUser.requestBody!.example);
		// Só os obrigatórios: o menor corpo que a API aceita.
		expect(Object.keys(example).sort()).toEqual(['email', 'name']);
	});

	it('respeita exemplo declarado no schema', () => {
		expect(exampleFromSchema({}, { type: 'string', example: 'oi' })).toBe('oi');
		expect(exampleFromSchema({}, { type: 'string', enum: ['a', 'b'] })).toBe('a');
	});

	it('operação sem corpo não inventa um', () => {
		expect(model.operations.find((operation) => operation.id === 'getUser')!.requestBody).toBeUndefined();
	});
});

describe('autenticação', () => {
	it('a operação herda a segurança do documento', () => {
		const getUser = model.operations.find((operation) => operation.id === 'getUser')!;
		expect(getUser.security.map((scheme) => scheme.id)).toEqual(['apiKey']);
		expect(getUser.security[0]).toMatchObject({ kind: 'apiKey', in: 'header', name: 'X-API-Key' });
	});

	it('`security: []` na operação declara que ela é pública', () => {
		// Diferente de não declarar nada, que herda do documento.
		const health = model.operations.find((operation) => operation.id === 'get-health')!;
		expect(health.security).toEqual([]);
	});

	it('reconhece os tipos de esquema', () => {
		const kinds = Object.fromEntries(model.securitySchemes.map((scheme) => [scheme.id, scheme.kind]));
		expect(kinds).toEqual({ apiKey: 'apiKey', bearer: 'http-bearer' });
	});
});

// ---------------------------------------------------------------------------
// §11 — SSRF
// ---------------------------------------------------------------------------

describe('política do proxy', () => {
	const allowed = allowedOrigins(['https://api.exemplo.com/v1', 'https://staging.exemplo.com']);

	it('deriva as origens dos servidores declarados', () => {
		expect(allowed.sort()).toEqual(['https://api.exemplo.com', 'https://staging.exemplo.com']);
	});

	it('permite o destino declarado', () => {
		expect(checkTarget('https://api.exemplo.com/v1/users/1', { allowed }).allowed).toBe(true);
	});

	it('recusa destino fora da especificação', () => {
		const decision = checkTarget('https://evil.example/steal', { allowed });
		expect(decision.allowed).toBe(false);
		expect(decision.reason).toContain('fora da especificação');
	});

	it('recusa a rede interna e os metadados de nuvem', () => {
		// Mesmo que alguém declare esses servidores, o proxy não vira ponte.
		const internal = allowedOrigins([
			'http://localhost:8080',
			'http://169.254.169.254',
			'http://10.0.0.5',
			'http://192.168.1.1',
			'http://[::1]:9000',
		]);

		for (const target of [
			'http://localhost:8080/x',
			'http://169.254.169.254/latest/meta-data/',
			'http://10.0.0.5/x',
			'http://192.168.1.1/x',
			'http://[::1]:9000/x',
		]) {
			const decision = checkTarget(target, { allowed: internal });
			expect(decision.allowed, target).toBe(false);
			expect(decision.reason, target).toMatch(/rede interna/);
		}
	});

	it('recusa esquema que não é HTTP', () => {
		for (const target of ['file:///etc/passwd', 'gopher://x/1', 'data:text/plain,oi']) {
			expect(checkTarget(target, { allowed }).allowed, target).toBe(false);
		}
	});

	it('recusa URL com credencial embutida', () => {
		const decision = checkTarget('https://user:senha@api.exemplo.com/v1', { allowed });
		expect(decision.allowed).toBe(false);
		expect(decision.reason).toMatch(/credenciais/);
	});

	it('recusa URL malformada', () => {
		expect(checkTarget('não é url', { allowed }).allowed).toBe(false);
	});

	it('servidor relativo libera só o próprio portal e só o caminho declarado', () => {
		const options = { allowed: [], selfOrigin: 'https://portal.exemplo.com', relativeServers: ['/api'] };

		expect(checkTarget('https://portal.exemplo.com/api/chat/message', options).allowed).toBe(true);
		// Fora do prefixo declarado, não passa.
		expect(checkTarget('https://portal.exemplo.com/settings', options).allowed).toBe(false);
		// Outro host, mesmo caminho, também não.
		expect(checkTarget('https://outro.exemplo.com/api/x', options).allowed).toBe(false);
	});
});

describe('cabeçalhos', () => {
	it('remove os que descrevem o proxy, não o pedido', () => {
		const clean = sanitizeHeaders({
			Authorization: 'Bearer x',
			Host: 'evil.example',
			'X-Forwarded-For': '1.2.3.4',
			'Content-Length': '99',
		});
		expect(Object.keys(clean)).toEqual(['authorization']);
	});

	it('recusa valor com quebra de linha', () => {
		// Permitiria injetar um segundo cabeçalho.
		expect(sanitizeHeaders({ 'X-Teste': 'a\r\nX-Injetado: b' })).toEqual({});
	});

	it('reconhece cabeçalho de credencial pelo nome', () => {
		for (const name of ['Authorization', 'X-API-Key', 'x-auth-token', 'Cookie']) {
			expect(isSecretHeader(name), name).toBe(true);
		}
		expect(isSecretHeader('Accept')).toBe(false);
	});

	it('redige credencial para log e histórico', () => {
		const redacted = redactHeaders({ Authorization: 'Bearer segredo-real', Accept: 'application/json' });
		expect(redacted.Authorization).toBe('••••••');
		expect(redacted.Accept).toBe('application/json');
		expect(JSON.stringify(redacted)).not.toContain('segredo-real');
	});
});

// ---------------------------------------------------------------------------
// §8 — exemplos de código
// ---------------------------------------------------------------------------

describe('exemplos de código', () => {
	const spec = {
		method: 'POST',
		url: 'https://api.exemplo.com/v1/users',
		headers: {
			'Content-Type': 'application/json',
			Authorization: 'Bearer token-secreto-de-verdade',
			'X-API-Key': 'chave-secreta',
		},
		body: '{"name":"Ana"}',
	};

	it('gera as quatro linguagens', () => {
		for (const language of ['curl', 'javascript', 'python', 'go'] as const) {
			expect(generateSnippet(language, spec), language).toContain('api.exemplo.com');
		}
	});

	it('nenhuma linguagem imprime a credencial', () => {
		for (const language of ['curl', 'javascript', 'python', 'go'] as const) {
			const snippet = generateSnippet(language, spec);
			expect(snippet, language).not.toContain('token-secreto-de-verdade');
			expect(snippet, language).not.toContain('chave-secreta');
			expect(snippet, language).toContain(SECRET_PLACEHOLDER);
		}
	});

	it('preserva o esquema da credencial, que faz parte do formato', () => {
		// Sem o `Bearer`, o exemplo copiado não funcionaria nem com a chave certa.
		expect(generateSnippet('curl', spec)).toContain(`Bearer ${SECRET_PLACEHOLDER}`);
	});

	it('cURL escapa o apóstrofo com o idioma do shell', () => {
		// `'\''` fecha a aspa, escapa um apóstrofo literal e reabre. É o único
		// jeito de pôr apóstrofo dentro de aspas simples, e sem ele o valor
		// escaparia da citação — que é como um valor vira comando.
		const snippet = generateSnippet('curl', {
			method: 'GET',
			url: "https://api.exemplo.com/v1/x?q=';whoami;'",
			headers: {},
		});

		expect(snippet).toContain(`'\\''`);

		// Sem os escapes, sobram apenas a aspa de abertura e a de fechamento:
		// nenhum apóstrofo solto para terminar a citação antes da hora.
		const quoted = snippet.slice(snippet.indexOf("'"));
		const loose = quoted.split(`'\\''`).join('').match(/'/g) ?? [];
		expect(loose).toHaveLength(2);
	});

	it('GET não recebe corpo nos exemplos', () => {
		const snippet = generateSnippet('javascript', { method: 'GET', url: 'https://api.exemplo.com/v1/x', headers: {} });
		expect(snippet).not.toContain('body:');
	});

	it('o exemplo em Go importa strings só quando há corpo', () => {
		expect(generateSnippet('go', spec)).toContain('"strings"');
		expect(generateSnippet('go', { method: 'GET', url: 'https://x.exemplo.com/y', headers: {} })).not.toContain('"strings"');
	});
});

// ---------------------------------------------------------------------------
// §3, §6 — montagem do pedido
// ---------------------------------------------------------------------------

describe('montagem do pedido', () => {
	const getUser = model.operations.find((operation) => operation.id === 'getUser')!;
	const createUser = model.operations.find((operation) => operation.id === 'createUser')!;
	const origin = 'https://portal.exemplo.com';

	it('põe cada parâmetro no lugar declarado', () => {
		const request = buildRequest({
			operation: getUser,
			server: 'https://api.exemplo.com/v1',
			origin,
			values: { id: 'usr_9', include: 'profile' },
		});

		expect(request.url).toBe('https://api.exemplo.com/v1/users/usr_9?include=profile');
	});

	it('resolve servidor relativo contra a origem do portal', () => {
		// Sem isto o proxy recebia `/api/...` e recusava como URL inválida — foi
		// exatamente o que aconteceu ao abrir a página pela primeira vez.
		const request = buildRequest({
			operation: getUser,
			server: '/api',
			origin,
			values: { id: 'usr_9' },
		});

		expect(request.url).toBe('https://portal.exemplo.com/api/users/usr_9');
	});

	it('não deixa parâmetro vazio virar query', () => {
		const request = buildRequest({
			operation: getUser,
			server: 'https://api.exemplo.com/v1',
			origin,
			values: { id: 'usr_9', include: '' },
		});
		expect(request.url).not.toContain('include');
	});

	it('a credencial vai onde o esquema declara', () => {
		const apiKey = model.securitySchemes.find((scheme) => scheme.id === 'apiKey')!;
		const header = buildRequest({
			operation: getUser,
			server: 'https://api.exemplo.com/v1',
			origin,
			values: { id: 'x' },
			credential: 'segredo',
			scheme: apiKey,
		});
		expect(header.headers['X-API-Key']).toBe('segredo');

		const bearer = buildRequest({
			operation: getUser,
			server: 'https://api.exemplo.com/v1',
			origin,
			values: { id: 'x' },
			credential: 'segredo',
			scheme: { id: 'b', kind: 'http-bearer' },
		});
		expect(bearer.headers.Authorization).toBe('Bearer segredo');

		const query = buildRequest({
			operation: getUser,
			server: 'https://api.exemplo.com/v1',
			origin,
			values: { id: 'x' },
			credential: 'segredo',
			scheme: { id: 'q', kind: 'apiKey', in: 'query', name: 'access_token' },
		});
		expect(query.url).toContain('access_token=segredo');
	});

	it('não monta cabeçalho de cookie a partir do formulário', () => {
		// O navegador é dono do `Cookie`; aceitá-lo do cliente faria o proxy
		// enviar cookie de outra pessoa.
		const request = buildRequest({
			operation: getUser,
			server: 'https://api.exemplo.com/v1',
			origin,
			values: { id: 'x' },
			credential: 'segredo',
			scheme: { id: 'c', kind: 'apiKey', in: 'cookie', name: 'sessao' },
		});
		expect(request.headers.Cookie).toBeUndefined();
		expect(JSON.stringify(request)).not.toContain('segredo');
	});

	it('corpo e content-type só quando o método os aceita', () => {
		const post = buildRequest({
			operation: createUser,
			server: 'https://api.exemplo.com/v1',
			origin,
			values: {},
			body: '{"name":"Ana"}',
		});
		expect(post.body).toBe('{"name":"Ana"}');
		expect(post.headers['Content-Type']).toBe('application/json');

		const get = buildRequest({
			operation: getUser,
			server: 'https://api.exemplo.com/v1',
			origin,
			values: { id: 'x' },
			body: '{"ignorado":true}',
		});
		expect(get.body).toBeUndefined();
	});

	it('aponta os obrigatórios em branco', () => {
		expect(missingRequired(getUser, {})).toEqual(['id']);
		expect(missingRequired(getUser, { id: 'usr_1' })).toEqual([]);
	});
});
