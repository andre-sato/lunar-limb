import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
	AsyncApiError,
	describeType,
	generateReferencePage,
	parseAsyncApi,
	resolveRef,
	type AsyncApiDocument,
} from '../src/lib/asyncapi/generate';

const SPEC = path.resolve(process.cwd(), 'src/schemas/streetlights-kafka.asyncapi.yaml');

function loadSpec(): AsyncApiDocument {
	return parseAsyncApi(readFileSync(SPEC, 'utf-8'));
}

const MINIMAL = `asyncapi: '2.6.0'
info:
  title: Teste
  version: '1.0.0'
channels:
  canal.teste:
    subscribe:
      operationId: consumir
      message:
        $ref: '#/components/messages/msg'
components:
  messages:
    msg:
      title: Mensagem
      payload:
        $ref: '#/components/schemas/corpo'
  schemas:
    corpo:
      type: object
      required: [id]
      properties:
        id:
          type: string
          description: Identificador.
`;

describe('parsing', () => {
	it('aceita um documento AsyncAPI válido', () => {
		const document = parseAsyncApi(MINIMAL);
		expect(document.asyncapi).toBe('2.6.0');
		expect(document.info.title).toBe('Teste');
	});

	it('recusa um documento OpenAPI com mensagem que aponta o caminho certo', () => {
		// Foi exatamente o que aconteceu no teste prático: o starlight-openapi
		// aceitou um AsyncAPI e gerou uma página vazia. O inverso não deve
		// falhar em silêncio.
		const openapi = 'openapi: 3.1.0\ninfo:\n  title: X\n  version: "1"\npaths: {}\n';
		expect(() => parseAsyncApi(openapi)).toThrow(AsyncApiError);
		expect(() => parseAsyncApi(openapi)).toThrow(/starlight-openapi/);
	});

	it('recusa documento sem o campo asyncapi', () => {
		expect(() => parseAsyncApi('info:\n  title: X\n')).toThrow(/asyncapi/);
	});

	it('recusa documento sem título', () => {
		expect(() => parseAsyncApi("asyncapi: '2.6.0'\ninfo:\n  version: '1'\n")).toThrow(/info.title/);
	});

	it('recusa YAML malformado', () => {
		expect(() => parseAsyncApi('asyncapi: [não fechado\n')).toThrow(AsyncApiError);
	});

	it('recusa documento vazio', () => {
		expect(() => parseAsyncApi('')).toThrow(/vazio/);
	});

	it('`on` e `off` continuam strings', () => {
		// Em YAML 1.1 seriam booleanos; o js-yaml 4 usa o schema core do 1.2.
		// Se isso mudasse, a documentação passaria a dizer `true`/`false`.
		const document = loadSpec();
		const command = document.components?.schemas?.turnOnOffPayload;
		const values = (command as { properties: { command: { enum: unknown[] } } }).properties.command.enum;
		expect(values).toEqual(['on', 'off']);
	});
});

describe('resolução de referências', () => {
	const document = parseAsyncApi(MINIMAL);

	it('resolve referência interna', () => {
		const resolved = resolveRef(document, { $ref: '#/components/schemas/corpo' });
		expect(resolved).toMatchObject({ type: 'object' });
	});

	it('resolve cadeia de referências', () => {
		const message = resolveRef(document, { $ref: '#/components/messages/msg' }) as unknown as {
			payload: unknown;
		};
		const payload = resolveRef(document, message.payload as { $ref: string });
		expect(payload).toMatchObject({ type: 'object' });
	});

	it('devolve a referência intacta quando o alvo não existe', () => {
		const ref = { $ref: '#/components/schemas/inexistente' };
		expect(resolveRef(document, ref)).toEqual(ref);
	});

	it('não tenta resolver referência externa', () => {
		// Resolver exigiria ler disco ou rede; o gerador é uma transformação
		// pura de um documento.
		const ref = { $ref: 'outro-arquivo.yaml#/components/schemas/x' };
		expect(resolveRef(document, ref)).toEqual(ref);
	});

	it('para em referência circular em vez de estourar a pilha', () => {
		const circular = {
			asyncapi: '2.6.0',
			info: { title: 'T', version: '1' },
			components: { schemas: { a: { $ref: '#/components/schemas/a' } } },
		} as unknown as AsyncApiDocument;
		expect(() => resolveRef(circular, { $ref: '#/components/schemas/a' })).not.toThrow();
	});
});

describe('descrição de tipos', () => {
	const document = loadSpec();

	it('inclui tipo, formato e limites', () => {
		expect(describeType(document, { type: 'integer', minimum: 0, maximum: 100 })).toBe(
			'integer (mín. 0, máx. 100)'
		);
		expect(describeType(document, { type: 'string', format: 'date-time' })).toBe('string (date-time)');
	});

	it('lista os valores de um enum', () => {
		expect(describeType(document, { type: 'string', enum: ['on', 'off'] })).toContain('`on` ou `off`');
	});

	it('schema ausente vira travessão', () => {
		expect(describeType(document, undefined)).toBe('—');
	});
});

describe('página gerada', () => {
	const page = generateReferencePage(loadSpec(), {
		sourcePath: 'src/schemas/streetlights-kafka.asyncapi.yaml',
		sidebarOrder: 10,
		tags: ['api', 'eventos'],
	});

	it('tem frontmatter válido com título e descrição', () => {
		expect(page.startsWith('---\n')).toBe(true);
		expect(page).toContain('title: "Streetlights Kafka API"');
		expect(page).toMatch(/description: ".+"/);
		expect(page.split('\n').filter((line) => line === '---')).toHaveLength(2);
	});

	it('avisa que é gerada e diz como regerar', () => {
		expect(page).toContain('Página gerada');
		expect(page).toContain('npm run docs:asyncapi');
	});

	it('documenta os dois servidores com protocolo e segurança', () => {
		expect(page).toContain('test.mykafkacluster.org:18092');
		expect(page).toContain('test.mykafkacluster.org:28092');
		expect(page).toContain('`kafka-secure`');
		expect(page).toContain('`saslScram`');
		expect(page).toContain('`certs`');
	});

	it('documenta os quatro canais', () => {
		for (const channel of [
			'lighting.measured',
			'turn.on',
			'turn.off',
			'{streetlightId}.dim',
		]) {
			expect(page).toContain(channel);
		}
	});

	it('nomeia as operações pelo operationId', () => {
		for (const operation of ['receiveLightMeasurement', 'turnOn', 'turnOff', 'dimLight']) {
			expect(page).toContain(operation);
		}
	});

	it('explica o sentido de publish e subscribe', () => {
		// É o ponto que mais confunde em AsyncAPI 2.x: a perspectiva do
		// documento é a da aplicação, não a de quem integra.
		expect(page).toMatch(/`publish`.*você \*\*publica\*\*/);
		expect(page).toMatch(/`subscribe`.*você \*\*consome\*\*/);
	});

	it('resolve os payloads em tabelas de campos', () => {
		expect(page).toContain('| `lumens` | integer (mín. 0) |');
		expect(page).toContain('| `percentage` | integer (mín. 0, máx. 100) |');
		expect(page).toContain('`on` ou `off`');
	});

	it('traz o parâmetro do endereço do canal', () => {
		expect(page).toContain('| `{streetlightId}` | string | The ID of the streetlight. |');
	});

	it('traz os cabeçalhos herdados dos traits da mensagem', () => {
		expect(page).toContain('`my-app-header`');
	});

	it('traz os bindings do protocolo sem duplicar o enum', () => {
		expect(page).toContain('`kafka` · `clientId`');
		expect(page).not.toMatch(/`my-app-id`.*valores: `my-app-id`/);
	});

	it('documenta os esquemas de autenticação', () => {
		expect(page).toContain('## Autenticação');
		expect(page).toContain('scramSha256');
		expect(page).toContain('X509');
	});

	it('põe a descrição do documento sob um heading próprio', () => {
		// Os headings da descrição precisam de um pai, senão o sumário mistura
		// a estrutura do autor com as seções geradas.
		const overview = page.indexOf('## Visão geral');
		const authorHeading = page.indexOf('### Check out its awesome features');
		expect(overview).toBeGreaterThan(-1);
		expect(authorHeading).toBeGreaterThan(overview);
	});

	it('não inventa conteúdo: só o que está na especificação', () => {
		// A especificação não descreve rotas HTTP nem códigos de status.
		expect(page).not.toMatch(/\bGET\b|\bPOST\b|\b404\b|\bendpoint REST\b/);
	});

	it('escapa barra vertical para não quebrar as tabelas', () => {
		const withPipe = {
			asyncapi: '2.6.0',
			info: { title: 'T', version: '1' },
			components: {
				schemas: {
					x: { type: 'object', properties: { campo: { type: 'string', description: 'a | b' } } },
				},
			},
		} as unknown as AsyncApiDocument;

		const generated = generateReferencePage(withPipe, { sourcePath: 'x.yaml' });
		expect(generated).toContain('a \\| b');
	});

	it('é estável: gerar duas vezes dá o mesmo resultado', () => {
		// O `--check` do script depende disso para funcionar em CI.
		const again = generateReferencePage(loadSpec(), {
			sourcePath: 'src/schemas/streetlights-kafka.asyncapi.yaml',
			sidebarOrder: 10,
			tags: ['api', 'eventos'],
		});
		expect(again).toBe(page);
	});

	it('corresponde ao arquivo comitado', () => {
		// Se alguém editar a página gerada à mão, isto falha — e é o mesmo que
		// `npm run docs:asyncapi -- --check` faz na CI.
		const committed = readFileSync(
			path.resolve(process.cwd(), 'src/content/docs/api-reference/streetlights-kafka.md'),
			'utf-8'
		);
		expect(committed).toBe(page);
	});
});
