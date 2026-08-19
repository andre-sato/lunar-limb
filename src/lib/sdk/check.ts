/**
 * Consistência SDK ↔ OpenAPI e diff de contrato (§14, §20).
 *
 * Puro. Duas regras da spec organizam o arquivo:
 *
 * - **A verificação usa o mesmo `ApiModel`**, não um segundo parser. O que está
 *   em disco é confrontado com o que o modelo diz, e não com outra leitura do
 *   YAML.
 * - **O diff deriva do contrato**, não de comparação textual cega dos arquivos
 *   gerados. Trocar a indentação do gerador mudaria todos os arquivos e não
 *   mudaria nada do contrato — um diff textual chamaria isso de mudança.
 */

import type { SdkChange, SdkChangeKind, SdkDiff, SdkOperation, SdkSpecification, SdkType } from './types';

// ---------------------------------------------------------------------------
// Consistência
// ---------------------------------------------------------------------------

export interface ConsistencyProblem {
	severity: 'error' | 'warning';
	subject: string;
	message: string;
}

/**
 * O SDK gerado corresponde ao que a especificação declara?
 *
 * A comparação é entre o `SdkSpecification` e os arquivos que o renderer
 * produziu — é o que pega um renderer que esqueceu um parâmetro de caminho, o
 * caso que a spec dá como exemplo.
 */
export function checkConsistency(specification: SdkSpecification, files: ReadonlyArray<{ path: string; contents: string }>): ConsistencyProblem[] {
	const problems: ConsistencyProblem[] = [];
	const byPath = new Map(files.map((file) => [file.path, file.contents]));

	for (const resource of specification.resources) {
		const contents = byPath.get(`src/resources/${resource.name}.ts`);

		if (contents === undefined) {
			problems.push({
				severity: 'error',
				subject: resource.name,
				message: `O recurso \`${resource.name}\` está na especificação e não tem arquivo gerado.`,
			});
			continue;
		}

		for (const operation of resource.operations) {
			if (!contents.includes(`${operation.name}(`)) {
				problems.push({
					severity: 'error',
					subject: `${resource.name}.${operation.name}`,
					message: `\`${operation.method.toUpperCase()} ${operation.path}\` não gerou método.`,
				});
				continue;
			}

			// Caminho e método precisam aparecer literais no código gerado: é a
			// verificação que pega um renderer que montou a URL errada.
			if (!contents.includes(JSON.stringify(operation.path))) {
				problems.push({
					severity: 'error',
					subject: `${resource.name}.${operation.name}`,
					message: `O caminho \`${operation.path}\` não aparece no método gerado.`,
				});
			}

			if (!contents.includes(JSON.stringify(operation.method.toUpperCase()))) {
				problems.push({
					severity: 'error',
					subject: `${resource.name}.${operation.name}`,
					message: `O método \`${operation.method.toUpperCase()}\` não aparece no código gerado.`,
				});
			}

			for (const parameter of operation.parameters.filter((entry) => entry.location === 'path')) {
				if (!contents.includes(`input.${parameter.name}`)) {
					problems.push({
						severity: 'error',
						subject: `${resource.name}.${operation.name}`,
						message: `Parâmetro de caminho ausente: \`${parameter.wireName}\`.`,
					});
				}
			}
		}
	}

	const models = byPath.get('src/models/index.ts') ?? '';

	for (const model of specification.models) {
		if (!new RegExp(`\\b(interface|type)\\s+${model.name}\\b`).test(models)) {
			problems.push({
				severity: 'error',
				subject: model.name,
				message: `O schema \`${model.schemaName}\` está na especificação e não gerou tipo.`,
			});
		}
	}

	// Referência a um modelo que não existe compila como erro em TypeScript, mas o
	// aviso aqui aponta a causa: um `$ref` para fora de `components/schemas`.
	const declared = new Set(specification.models.map((model) => model.name));

	for (const resource of specification.resources) {
		for (const operation of resource.operations) {
			for (const reference of referencedModels(operation)) {
				if (!declared.has(reference)) {
					problems.push({
						severity: 'warning',
						subject: `${resource.name}.${operation.name}`,
						message: `Referencia o modelo \`${reference}\`, que não está em \`components/schemas\`.`,
					});
				}
			}
		}
	}

	return problems;
}

function referencedModels(operation: SdkOperation): string[] {
	const found = new Set<string>();

	const walk = (type: SdkType | undefined) => {
		if (!type) return;
		if (type.kind === 'ref' && type.ref) found.add(type.ref);
		walk(type.items);
		for (const property of type.properties ?? []) walk(property.type);
	};

	walk(operation.responseType);
	walk(operation.requestBody?.type);
	for (const parameter of operation.parameters) walk(parameter.type);

	return [...found];
}

// ---------------------------------------------------------------------------
// Diff (§20)
// ---------------------------------------------------------------------------

/**
 * Assinatura estável de um tipo, para comparar duas versões do contrato.
 *
 * Referências são **resolvidas** contra os modelos, e não impressas como
 * `ref:User`. Sem isto, extrair um schema inline para `components/schemas` e
 * apontar um `$ref` para ele — um refatorador puro, que não muda forma nenhuma —
 * aparecia como ruptura em toda operação afetada, e o portão de CI bloquearia
 * um contrato que não mudou. A comparação é sobre a **forma**, não sobre como o
 * documento a escreve.
 */
export function signatureOf(type: SdkType | undefined, models?: ReadonlyMap<string, SdkType>, seen: ReadonlySet<string> = new Set()): string {
	if (!type) return 'nenhum';

	const nested = (child: SdkType | undefined, visiting = seen) => signatureOf(child, models, visiting);

	switch (type.kind) {
		case 'ref': {
			const target = type.ref ? models?.get(type.ref) : undefined;
			// Sem o modelo em mãos, ou num ciclo, o nome é o melhor que dá para dizer.
			// Um modelo recursivo comparado por expansão não terminaria.
			if (!target || !type.ref || seen.has(type.ref)) return `ref:${type.ref}`;
			return nested(target, new Set([...seen, type.ref]));
		}
		case 'array':
			return `array<${nested(type.items)}>`;
		case 'enum':
			return `enum(${[...(type.values ?? [])].sort().join('|')})`;
		case 'object':
			return `object{${(type.properties ?? [])
				.map((property) => `${property.name}:${nested(property.type)}`)
				.sort()
				.join(',')}}`;
		default:
			return type.kind + (type.nullable ? '?' : '');
	}
}

/** Os modelos de uma especificação, indexados por nome, para resolver `$ref`. */
function modelIndex(specification: SdkSpecification): Map<string, SdkType> {
	return new Map(specification.models.map((model) => [model.name, model.type]));
}

/**
 * Em que direção um modelo trafega.
 *
 * Requisição e resposta têm variâncias **opostas**, e tratá-las igual foi o
 * defeito que a primeira execução real revelou: declarar `required` num corpo de
 * resposta apareceu como ruptura em quatro operações, quando na verdade é uma
 * garantia a mais para quem consome.
 *
 * - **Requisição**: opcional → obrigatório quebra (quem chama precisa mandar
 *   algo novo). Campo removido não quebra o código, mas quebra o tipo.
 * - **Resposta**: obrigatório → opcional quebra (quem lê não pode mais confiar).
 *   Opcional → obrigatório é ganho.
 *
 * Um modelo usado nas duas direções é tratado como requisição: é o lado
 * conservador, e errar para o lado de avisar demais é preferível a liberar uma
 * quebra silenciosa.
 */
export type Direction = 'request' | 'response' | 'both' | 'unused';

export function directionsOf(specification: SdkSpecification): Map<string, Direction> {
	const directions = new Map<string, Direction>();

	const mark = (type: SdkType | undefined, direction: 'request' | 'response', seen: Set<string> = new Set()) => {
		if (!type) return;

		if (type.kind === 'ref' && type.ref) {
			if (seen.has(type.ref)) return;
			seen.add(type.ref);

			const current = directions.get(type.ref);
			directions.set(type.ref, current === undefined || current === direction ? direction : 'both');

			const target = specification.models.find((model) => model.name === type.ref);
			mark(target?.type, direction, seen);
			return;
		}

		mark(type.items, direction, seen);
		for (const property of type.properties ?? []) mark(property.type, direction, seen);
	};

	for (const resource of specification.resources) {
		for (const operation of resource.operations) {
			mark(operation.requestBody?.type, 'request');
			for (const parameter of operation.parameters) mark(parameter.type, 'request');
			mark(operation.responseType, 'response');
		}
	}

	for (const model of specification.models) if (!directions.has(model.name)) directions.set(model.name, 'unused');

	return directions;
}

/** A obrigatoriedade mudou: isso quebra quem consome? */
export function requiredChangeKind(before: boolean, after: boolean, direction: Direction): SdkChangeKind | null {
	if (before === after) return null;

	// Resposta: ganhar garantia é aditivo; perdê-la quebra.
	if (direction === 'response') return after ? 'additive' : 'breaking';

	// Requisição, ou uso nos dois sentidos: exigir algo novo quebra; relaxar não.
	return after ? 'breaking' : 'additive';
}

function operationKey(resource: string, operation: SdkOperation): string {
	return `${resource}.${operation.name}`;
}

/**
 * O que mudou entre dois contratos, do ponto de vista de quem usa o SDK.
 *
 * A classificação é sobre **o código de quem consome**: remover um campo quebra
 * quem o lê; acrescentar um campo obrigatório num corpo de requisição quebra
 * quem não o envia; acrescentar um campo opcional não quebra ninguém.
 */
export function diffSpecifications(before: SdkSpecification, after: SdkSpecification): SdkDiff {
	const changes: SdkChange[] = [];
	const beforeIndex = modelIndex(before);
	const afterIndex = modelIndex(after);
	const directions = directionsOf(after);

	// --- modelos ------------------------------------------------------------
	const beforeModels = new Map(before.models.map((model) => [model.name, model]));
	const afterModels = new Map(after.models.map((model) => [model.name, model]));

	for (const [name, model] of beforeModels) {
		const current = afterModels.get(name);

		if (!current) {
			changes.push({
				kind: 'breaking',
				subject: name,
				detail: 'Modelo removido da especificação.',
				files: ['src/models/index.ts'],
			});
			continue;
		}

		const previousProperties = new Map((model.type.properties ?? []).map((property) => [property.name, property]));
		const currentProperties = new Map((current.type.properties ?? []).map((property) => [property.name, property]));

		for (const [property, definition] of previousProperties) {
			const now = currentProperties.get(property);

			if (!now) {
				changes.push({
					kind: 'breaking',
					subject: `${name}.${property}`,
					detail: 'Campo removido.',
					files: ['src/models/index.ts'],
				});
				continue;
			}

			if (signatureOf(definition.type, beforeIndex) !== signatureOf(now.type, afterIndex)) {
				changes.push({
					kind: 'breaking',
					subject: `${name}.${property}`,
					detail: `Tipo mudou de \`${signatureOf(definition.type, beforeIndex)}\` para \`${signatureOf(now.type, afterIndex)}\`.`,
					files: ['src/models/index.ts'],
				});
			}

			const requiredChange = requiredChangeKind(definition.required, now.required, directions.get(name) ?? 'both');

			if (requiredChange) {
				changes.push({
					kind: requiredChange,
					subject: `${name}.${property}`,
					detail: now.required
						? 'Campo passou de opcional a obrigatório.'
						: 'Campo passou de obrigatório a opcional.',
					files: ['src/models/index.ts'],
				});
			}
		}

		for (const [property, definition] of currentProperties) {
			if (previousProperties.has(property)) continue;

			// Campo novo obrigatório quebra quem **constrói** o objeto; num corpo de
			// resposta, quem só o lê ganha uma garantia.
			const direction = directions.get(name) ?? 'both';

			changes.push({
				kind: definition.required && direction !== 'response' ? 'breaking' : 'additive',
				subject: `${name}.${property}`,
				detail: definition.required ? 'Campo obrigatório acrescentado.' : 'Campo opcional acrescentado.',
				files: ['src/models/index.ts'],
			});
		}
	}

	for (const [name] of afterModels) {
		if (beforeModels.has(name)) continue;
		changes.push({ kind: 'additive', subject: name, detail: 'Modelo novo.', files: ['src/models/index.ts'] });
	}

	// --- operações ----------------------------------------------------------
	const beforeOperations = new Map<string, { resource: string; operation: SdkOperation }>();
	const afterOperations = new Map<string, { resource: string; operation: SdkOperation }>();

	for (const resource of before.resources) {
		for (const operation of resource.operations) beforeOperations.set(operationKey(resource.name, operation), { resource: resource.name, operation });
	}
	for (const resource of after.resources) {
		for (const operation of resource.operations) afterOperations.set(operationKey(resource.name, operation), { resource: resource.name, operation });
	}

	for (const [key, entry] of beforeOperations) {
		const current = afterOperations.get(key);
		const file = `src/resources/${entry.resource}.ts`;

		if (!current) {
			changes.push({ kind: 'breaking', subject: `client.${key}`, detail: 'Operação removida.', files: [file] });
			continue;
		}

		if (entry.operation.path !== current.operation.path || entry.operation.method !== current.operation.method) {
			changes.push({
				kind: 'breaking',
				subject: `client.${key}`,
				detail: `\`${entry.operation.method.toUpperCase()} ${entry.operation.path}\` virou \`${current.operation.method.toUpperCase()} ${current.operation.path}\`.`,
				files: [file],
			});
		}

		const previousParameters = new Map(entry.operation.parameters.map((parameter) => [parameter.wireName, parameter]));
		const currentParameters = new Map(current.operation.parameters.map((parameter) => [parameter.wireName, parameter]));

		for (const [name, parameter] of currentParameters) {
			const was = previousParameters.get(name);
			if (!was && parameter.required) {
				changes.push({
					kind: 'breaking',
					subject: `client.${key}(${parameter.name})`,
					detail: 'Parâmetro obrigatório acrescentado.',
					files: [file],
				});
			} else if (!was) {
				changes.push({
					kind: 'additive',
					subject: `client.${key}(${parameter.name})`,
					detail: 'Parâmetro opcional acrescentado.',
					files: [file],
				});
			} else if (!was.required && parameter.required) {
				changes.push({
					kind: 'breaking',
					subject: `client.${key}(${parameter.name})`,
					detail: 'Parâmetro passou de opcional a obrigatório.',
					files: [file],
				});
			}
		}

		for (const [name, parameter] of previousParameters) {
			if (currentParameters.has(name)) continue;
			changes.push({
				// Remover um parâmetro não quebra quem chama — o argumento a mais é
				// ignorado —, mas quebra o tipo em TypeScript, que é onde o SDK vive.
				kind: 'breaking',
				subject: `client.${key}(${parameter.name})`,
				detail: 'Parâmetro removido.',
				files: [file],
			});
		}

		if (signatureOf(entry.operation.responseType, beforeIndex) !== signatureOf(current.operation.responseType, afterIndex)) {
			changes.push({
				kind: 'breaking',
				subject: `client.${key}`,
				detail: `A resposta mudou de \`${signatureOf(entry.operation.responseType, beforeIndex)}\` para \`${signatureOf(current.operation.responseType, afterIndex)}\`.`,
				files: [file],
			});
		}
	}

	for (const [key, entry] of afterOperations) {
		if (beforeOperations.has(key)) continue;
		changes.push({
			kind: 'additive',
			subject: `client.${key}`,
			detail: `Operação nova: \`${entry.operation.method.toUpperCase()} ${entry.operation.path}\`.`,
			files: [`src/resources/${entry.resource}.ts`],
		});
	}

	return {
		changes: changes.sort((a, b) => rank(a.kind) - rank(b.kind) || a.subject.localeCompare(b.subject)),
		breaking: changes.filter((change) => change.kind === 'breaking').length,
		additive: changes.filter((change) => change.kind === 'additive').length,
		regenerate: [...new Set(changes.flatMap((change) => change.files))].sort(),
	};
}

function rank(kind: SdkChange['kind']): number {
	return { breaking: 0, additive: 1, internal: 2 }[kind];
}
