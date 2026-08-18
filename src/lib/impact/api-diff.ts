/**
 * Diff de especificação de API (§6).
 *
 * A pergunta que este arquivo responde não é "o que mudou no arquivo" — o `git
 * diff` já faz isso, e faz melhor. É outra:
 *
 *     "esta mudança quebra quem já consome a API?"
 *
 * Renomear um parâmetro é uma linha no diff e uma quebra total para o cliente.
 * Reordenar as chaves do YAML são vinte linhas no diff e mudança nenhuma. Por
 * isso a comparação acontece sobre o **modelo** já interpretado, não sobre o
 * texto: é a única forma de a resposta ter a ver com comportamento.
 *
 * Função pura, sem disco e sem rede — o `engine.ts` traz os dois lados.
 */

import type { ApiModel, ApiOperation, ApiParameter } from '../api-explorer/model';

export type ApiChangeType =
	| 'operation-removed'
	| 'operation-added'
	| 'operation-deprecated'
	| 'parameter-removed'
	| 'parameter-added'
	| 'parameter-renamed'
	| 'parameter-required'
	| 'parameter-optional'
	| 'parameter-type'
	| 'request-body-required'
	| 'request-body-removed'
	| 'response-removed'
	| 'response-added'
	| 'security-changed'
	| 'server-changed'
	| 'version-changed'
	| 'description-changed';

export interface ApiChange {
	type: ApiChangeType;
	/** `GET /users/{id}`, ou o nome do que mudou quando não é operação. */
	subject: string;
	/** Descrição em uma frase, em português, pronta para o relatório. */
	message: string;
	/**
	 * `true` quando um cliente que funcionava para de funcionar.
	 *
	 * É o campo que decide a cor no relatório, então ele é conservador de um jeito
	 * específico: na dúvida entre quebrar e não quebrar, marca como quebra. Um
	 * alarme falso custa uma revisão; um silêncio custa a confiança na página.
	 */
	breaking: boolean;
	/** Identificador da operação, quando aplicável, para navegar até a origem. */
	operationId?: string;
}

function operationKey(operation: ApiOperation): string {
	return `${operation.method.toUpperCase()} ${operation.path}`;
}

function byKey(model: ApiModel): Map<string, ApiOperation> {
	return new Map(model.operations.map((operation) => [operationKey(operation), operation]));
}

function parametersByName(operation: ApiOperation): Map<string, ApiParameter> {
	return new Map(operation.parameters.map((parameter) => [`${parameter.location}:${parameter.name}`, parameter]));
}

/**
 * Detecta renome de parâmetro.
 *
 * O documento não diz "renomeei": diz que um parâmetro saiu e outro entrou. O que
 * distingue renome de "removeu um e adicionou outro" é o resto ser igual — mesmo
 * lugar, mesmo tipo, mesma obrigatoriedade. Quando bate, o relatório pode dizer
 * `id → userId`, que é o que a pessoa precisa ler; quando não bate, ficam as duas
 * mudanças separadas, sem inventar uma relação que talvez não exista.
 */
function matchRenames(
	removed: ApiParameter[],
	added: ApiParameter[]
): Array<{ from: ApiParameter; to: ApiParameter }> {
	const pairs: Array<{ from: ApiParameter; to: ApiParameter }> = [];
	const availableAdded = [...added];

	for (const from of [...removed]) {
		const index = availableAdded.findIndex(
			(candidate) =>
				candidate.location === from.location && candidate.type === from.type && candidate.required === from.required
		);
		if (index === -1) continue;

		const [to] = availableAdded.splice(index, 1);
		pairs.push({ from, to });
		removed.splice(removed.indexOf(from), 1);
		added.splice(added.indexOf(to), 1);
	}

	return pairs;
}

function diffOperation(before: ApiOperation, after: ApiOperation): ApiChange[] {
	const changes: ApiChange[] = [];
	const subject = operationKey(after);
	const operationId = after.id;

	if (after.deprecated && !before.deprecated) {
		changes.push({
			type: 'operation-deprecated',
			subject,
			operationId,
			// Depreciar não quebra ninguém hoje; anuncia que vai quebrar. A
			// documentação precisa dizer isso, e é revisão, não emergência.
			breaking: false,
			message: `\`${subject}\` foi marcada como obsoleta.`,
		});
	}

	const beforeParameters = parametersByName(before);
	const afterParameters = parametersByName(after);

	const removed = [...beforeParameters].filter(([key]) => !afterParameters.has(key)).map(([, value]) => value);
	const added = [...afterParameters].filter(([key]) => !beforeParameters.has(key)).map(([, value]) => value);

	for (const { from, to } of matchRenames(removed, added)) {
		changes.push({
			type: 'parameter-renamed',
			subject,
			operationId,
			breaking: true,
			message: `parâmetro \`${from.name}\` passou a chamar-se \`${to.name}\` (${to.location}).`,
		});
	}

	for (const parameter of removed) {
		changes.push({
			type: 'parameter-removed',
			subject,
			operationId,
			// Parâmetro opcional removido ainda quebra quem o enviava, e APIs
			// costumam rejeitar campo desconhecido. Fica como quebra.
			breaking: true,
			message: `parâmetro \`${parameter.name}\` (${parameter.location}) foi removido.`,
		});
	}

	for (const parameter of added) {
		changes.push({
			type: parameter.required ? 'parameter-required' : 'parameter-added',
			subject,
			operationId,
			// Obrigatório novo quebra: quem chamava sem ele passa a receber erro.
			breaking: parameter.required,
			message: parameter.required
				? `novo parâmetro obrigatório \`${parameter.name}\` (${parameter.location}).`
				: `novo parâmetro opcional \`${parameter.name}\` (${parameter.location}).`,
		});
	}

	for (const [key, afterParameter] of afterParameters) {
		const beforeParameter = beforeParameters.get(key);
		if (!beforeParameter) continue;

		if (beforeParameter.type !== afterParameter.type) {
			changes.push({
				type: 'parameter-type',
				subject,
				operationId,
				breaking: true,
				message: `parâmetro \`${afterParameter.name}\` mudou de \`${beforeParameter.type}\` para \`${afterParameter.type}\`.`,
			});
		}

		if (!beforeParameter.required && afterParameter.required) {
			changes.push({
				type: 'parameter-required',
				subject,
				operationId,
				breaking: true,
				message: `parâmetro \`${afterParameter.name}\` passou a ser obrigatório.`,
			});
		}

		if (beforeParameter.required && !afterParameter.required) {
			changes.push({
				type: 'parameter-optional',
				subject,
				operationId,
				breaking: false,
				message: `parâmetro \`${afterParameter.name}\` deixou de ser obrigatório.`,
			});
		}
	}

	if (before.requestBody && !after.requestBody) {
		changes.push({
			type: 'request-body-removed',
			subject,
			operationId,
			breaking: true,
			message: 'o corpo da requisição deixou de existir.',
		});
	}

	if (before.requestBody && after.requestBody && !before.requestBody.required && after.requestBody.required) {
		changes.push({
			type: 'request-body-required',
			subject,
			operationId,
			breaking: true,
			message: 'o corpo da requisição passou a ser obrigatório.',
		});
	}

	const beforeStatuses = new Set(before.responses.map((response) => response.status));
	const afterStatuses = new Set(after.responses.map((response) => response.status));

	for (const status of beforeStatuses) {
		if (afterStatuses.has(status)) continue;
		changes.push({
			type: 'response-removed',
			subject,
			operationId,
			// Resposta documentada que desaparece invalida o exemplo publicado —
			// só isso já é motivo de revisão, mesmo sem quebrar a chamada.
			breaking: status.startsWith('2'),
			message: `a resposta \`${status}\` não é mais documentada.`,
		});
	}

	for (const status of afterStatuses) {
		if (beforeStatuses.has(status)) continue;
		changes.push({
			type: 'response-added',
			subject,
			operationId,
			breaking: false,
			message: `nova resposta documentada: \`${status}\`.`,
		});
	}

	const beforeSecurity = before.security.map((scheme) => scheme.id).sort().join(',');
	const afterSecurity = after.security.map((scheme) => scheme.id).sort().join(',');
	if (beforeSecurity !== afterSecurity) {
		changes.push({
			type: 'security-changed',
			subject,
			operationId,
			breaking: true,
			message: `a autenticação mudou (${beforeSecurity || 'nenhuma'} → ${afterSecurity || 'nenhuma'}).`,
		});
	}

	if ((before.summary ?? '') !== (after.summary ?? '') || (before.description ?? '') !== (after.description ?? '')) {
		changes.push({
			type: 'description-changed',
			subject,
			operationId,
			breaking: false,
			message: 'a descrição da operação mudou.',
		});
	}

	return changes;
}

/** Compara duas versões da mesma especificação. */
export function diffApiModels(before: ApiModel, after: ApiModel): ApiChange[] {
	const changes: ApiChange[] = [];

	const beforeOperations = byKey(before);
	const afterOperations = byKey(after);

	for (const [key, operation] of beforeOperations) {
		if (afterOperations.has(key)) continue;
		changes.push({
			type: 'operation-removed',
			subject: key,
			operationId: operation.id,
			breaking: true,
			message: `\`${key}\` não existe mais na especificação.`,
		});
	}

	for (const [key, operation] of afterOperations) {
		if (beforeOperations.has(key)) continue;
		changes.push({
			type: 'operation-added',
			subject: key,
			operationId: operation.id,
			breaking: false,
			message: `\`${key}\` é nova.`,
		});
	}

	for (const [key, afterOperation] of afterOperations) {
		const beforeOperation = beforeOperations.get(key);
		if (beforeOperation) changes.push(...diffOperation(beforeOperation, afterOperation));
	}

	const beforeServers = before.servers.join(',');
	const afterServers = after.servers.join(',');
	if (beforeServers !== afterServers) {
		changes.push({
			type: 'server-changed',
			subject: 'servers',
			breaking: true,
			message: `a URL base mudou (${beforeServers || '—'} → ${afterServers || '—'}).`,
		});
	}

	if (before.version !== after.version) {
		changes.push({
			type: 'version-changed',
			subject: 'info.version',
			breaking: false,
			message: `a versão da especificação foi de \`${before.version}\` para \`${after.version}\`.`,
		});
	}

	return changes;
}

/** As operações tocadas por um conjunto de mudanças, sem repetição. */
export function touchedOperations(changes: readonly ApiChange[]): string[] {
	const subjects = new Set<string>();
	for (const change of changes) {
		if (/^[A-Z]+ \//.test(change.subject)) subjects.add(change.subject);
	}
	return [...subjects].sort();
}
