/**
 * SDK Engineering — modelo intermediário (§22, §31).
 *
 * O princípio da spec, e a razão de este arquivo existir:
 *
 *     OpenAPI → ApiModel → SDK
 *
 * Nenhuma definição de endpoint, parâmetro, schema, autenticação ou resposta é
 * redigida de novo para o SDK. O `ApiModel` do API Explorer é a leitura única do
 * OpenAPI — a spec proíbe um segundo parser, e a proibição é levada a sério:
 * este módulo **não abre YAML**.
 *
 * O que existe aqui é a camada entre o `ApiModel` e a linguagem gerada. Ela
 * carrega o que toda linguagem precisa — recursos, operações, tipos, erros — sem
 * nada de TypeScript. É o que permite acrescentar um renderer de Python sem
 * mexer no que já funciona, e o que impede o gerador de TypeScript de virar a
 * definição do modelo.
 */

import type { HttpMethod, SecurityScheme } from '../api-explorer/model';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type SdkTypeKind = 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'enum' | 'ref' | 'unknown';

/**
 * Um tipo, independente de linguagem.
 *
 * `unknown` é deliberado e aparece no código gerado como tal: quando a
 * especificação não diz qual é o tipo, o SDK que finge saber é pior que o SDK
 * que admite não saber — o primeiro faz o compilador aprovar uma chamada errada.
 */
export interface SdkType {
	kind: SdkTypeKind;
	/** Para `ref`: o nome do modelo. */
	ref?: string;
	/** Para `array`: o tipo dos itens. */
	items?: SdkType;
	/** Para `object`: as propriedades. */
	properties?: SdkProperty[];
	/** Para `enum`: os valores aceitos. */
	values?: string[];
	nullable?: boolean;
	/** `true` quando o objeto aceita chaves além das declaradas. */
	additional?: boolean;
	format?: string;
}

export interface SdkProperty {
	name: string;
	type: SdkType;
	required: boolean;
	description?: string;
	deprecated?: boolean;
}

export interface SdkModel {
	/** Nome do modelo no SDK, já em PascalCase. */
	name: string;
	/** Nome original em `components/schemas`, para rastrear até a especificação. */
	schemaName: string;
	type: SdkType;
	description?: string;
	deprecated: boolean;
}

// ---------------------------------------------------------------------------
// Operações e recursos
// ---------------------------------------------------------------------------

export interface SdkParameter {
	/** Nome no SDK, em camelCase. */
	name: string;
	/** Nome no protocolo — pode diferir: `user_id` vira `userId`. */
	wireName: string;
	location: 'path' | 'query' | 'header' | 'cookie';
	type: SdkType;
	required: boolean;
	description?: string;
}

export interface SdkOperation {
	/** Nome do método no recurso: `list`, `get`, `create`. */
	name: string;
	/** `operationId` da especificação, quando existe. */
	operationId: string;
	method: HttpMethod;
	path: string;
	summary?: string;
	description?: string;
	parameters: SdkParameter[];
	requestBody?: { type: SdkType; contentType: string; required: boolean };
	/** Tipo da resposta de sucesso, quando a especificação a descreve. */
	responseType?: SdkType;
	/** Códigos de erro que a especificação declara, para os erros tipados. */
	errorStatuses: string[];
	security: SecurityScheme[];
	deprecated: boolean;
	/** Exemplo idiomático de chamada, gerado pelo renderer. */
	example?: string;
}

export interface SdkResource {
	/** Nome da propriedade no cliente: `users`. */
	name: string;
	/** Tag ou segmento de caminho que originou o agrupamento. */
	origin: string;
	operations: SdkOperation[];
}

// ---------------------------------------------------------------------------
// O SDK inteiro
// ---------------------------------------------------------------------------

export interface SdkSpecification {
	/** Nome do pacote, do `sdk.yml`. */
	packageName: string;
	/** Versão do SDK. */
	version: string;
	/** Versão da API, da especificação. */
	apiVersion: string;
	title: string;
	description?: string;
	baseUrl: string;
	models: SdkModel[];
	resources: SdkResource[];
	securitySchemes: SecurityScheme[];
	/**
	 * O que a especificação não permitiu representar.
	 *
	 * Ele aparece no README gerado e no `sdk check`. Um gerador que engole o que
	 * não entendeu produz um SDK que parece completo e falha em produção.
	 */
	limitations: string[];
}

/** Um arquivo gerado. O renderer devolve isto; quem escreve em disco é a CLI. */
export interface GeneratedFile {
	/** Caminho relativo à raiz do SDK. */
	path: string;
	contents: string;
}

/**
 * Um renderer de linguagem.
 *
 * A interface é o contrato de extensão da §22: acrescentar Python significa
 * implementar isto, e não tocar em `build.ts`.
 */
export interface SdkRenderer {
	language: string;
	render(specification: SdkSpecification): GeneratedFile[];
}

// ---------------------------------------------------------------------------
// Configuração (§25)
// ---------------------------------------------------------------------------

export interface GeneratorConfig {
	enabled: boolean;
	output: string;
	packageName: string;
	/** Versão do SDK. `api` acompanha a versão da especificação. */
	version: string | 'api';
}

export interface SdkConfig {
	/** Caminho da especificação, relativo à raiz do projeto. */
	spec: string;
	generators: Record<string, GeneratorConfig>;
	/** `true` faz a CI falhar quando o SDK estiver desatualizado. */
	failOnStale: boolean;
}

export const DEFAULT_SDK_CONFIG: SdkConfig = {
	spec: 'src/schemas/portal-api.yaml',
	generators: {
		typescript: {
			enabled: true,
			output: 'generated/typescript',
			packageName: '@lunar-limb/api-client',
			version: 'api',
		},
	},
	// Ligado: um SDK desatualizado é uma promessa quebrada para quem o instala, e
	// diferente de documentação envelhecida ele quebra o build de outra pessoa.
	failOnStale: true,
};

// ---------------------------------------------------------------------------
// Diff (§20)
// ---------------------------------------------------------------------------

export type SdkChangeKind = 'breaking' | 'additive' | 'internal';

export interface SdkChange {
	kind: SdkChangeKind;
	/** `User.email`, `client.users.get`. */
	subject: string;
	detail: string;
	/** Arquivos gerados que precisam ser regenerados por causa disto. */
	files: string[];
}

export interface SdkDiff {
	changes: SdkChange[];
	breaking: number;
	additive: number;
	/** Arquivos a regenerar, deduplicados. */
	regenerate: string[];
}
