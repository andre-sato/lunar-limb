/**
 * Validação de um candidato (P3.6 — §10).
 *
 * A regra que organiza o arquivo: **validação que não roda vale `null`, e `null`
 * nunca conta como aprovação.** Mascarar falha de validação é o último item da
 * lista do que o self-healing não pode fazer, e o jeito mais fácil de mascarar é
 * tratar "não consegui verificar" como "está tudo bem".
 *
 * O que é validado aqui é o **diff**, não o repositório: a correção ainda vive
 * no workspace isolado, e rodar o linter contra a árvore de trabalho mediria o
 * conteúdo atual, não o proposto.
 */

import yaml from 'js-yaml';
import { runContractTests } from '../contract/engine';
import type { DocumentationChange, ValidationResult } from './types';

function result(name: ValidationResult['name'], passed: boolean | null, detail: string): ValidationResult {
	return { name, passed, detail };
}

/** As linhas acrescentadas por um diff, sem o `+` inicial. */
export function addedLines(diff: string): string[] {
	return diff
		.split(/\r?\n/)
		.filter((line) => line.startsWith('+') && !line.startsWith('+++'))
		.map((line) => line.slice(1));
}

export function removedLines(diff: string): string[] {
	return diff
		.split(/\r?\n/)
		.filter((line) => line.startsWith('-') && !line.startsWith('---'))
		.map((line) => line.slice(1));
}

/** Estrutura mínima do Markdown acrescentado: cerca fechada, link bem formado. */
export function checkMarkdown(changes: readonly DocumentationChange[]): ValidationResult {
	const problems: string[] = [];

	for (const change of changes) {
		const added = addedLines(change.diff);

		// Frontmatter precisa ser YAML válido.
		//
		// A primeira proposta real do ciclo passou nesta validação com um
		// frontmatter quebrado: a instrução de várias linhas vazou inteira para
		// `title:` e `description:`, e o bloco deixou de ser YAML. Verificar só a
		// estrutura do corpo deixava passar uma página que o build recusaria.
		const opens = added.findIndex((line) => line.trim() === '---');
		if (opens === 0) {
			const closes = added.findIndex((line, position) => position > 0 && line.trim() === '---');
			if (closes < 0) problems.push(`${change.path}: frontmatter aberto e não fechado.`);
			else {
				try {
					const parsed = yaml.load(added.slice(1, closes).join('\n'));
					if (parsed === null || typeof parsed !== 'object') {
						problems.push(`${change.path}: frontmatter não é um mapa YAML.`);
					}
				} catch (error) {
					const message = error instanceof Error ? error.message.split('\n')[0] : 'erro';
					problems.push(`${change.path}: frontmatter não é YAML válido — ${message}.`);
				}
			}
		}

		const fences = added.filter((line) => /^\s*```/.test(line)).length;
		if (fences % 2 !== 0) problems.push(`${change.path}: cerca de código sem fechamento nas linhas acrescentadas.`);

		for (const line of added) {
			// `[texto](` sem `)` na mesma linha. Link partido em duas linhas é raro e
			// legítimo em Markdown, então o teste é só de linha inteira.
			if (/\[[^\]]*\]\([^)]*$/.test(line)) problems.push(`${change.path}: link sem fechamento — \`${line.trim().slice(0, 60)}\``);
		}
	}

	return problems.length === 0
		? result('markdown', true, 'Estrutura do Markdown acrescentado está fechada.')
		: result('markdown', false, problems.join(' · '));
}

/**
 * Nenhum link novo aponta para lugar nenhum.
 *
 * Só links **relativos internos** são verificados aqui, e apenas quanto à forma:
 * conferir se o destino existe exigiria aplicar o diff, e a correção ainda não
 * foi aplicada. A validação diz o que verificou.
 */
export function checkLinks(changes: readonly DocumentationChange[]): ValidationResult {
	const suspicious: string[] = [];

	for (const change of changes) {
		for (const line of addedLines(change.diff)) {
			for (const match of line.matchAll(/\[[^\]]*\]\(([^)\s]*)\)/g)) {
				const target = match[1];
				if (target.trim() === '') suspicious.push(`${change.path}: link com destino vazio.`);
				// Um caminho absoluto de disco num link é sinal de conteúdo gerado sem
				// revisão, e não resolve para ninguém que abra a página.
				if (/^[a-zA-Z]:[\\/]/.test(target) || target.startsWith('file://')) {
					suspicious.push(`${change.path}: link para caminho local — \`${target}\``);
				}
			}
		}
	}

	return suspicious.length === 0
		? result('links', true, 'Nenhum link malformado nas linhas acrescentadas.')
		: result('links', false, suspicious.join(' · '));
}

/**
 * O texto acrescentado não contém marcadores de conteúdo inventado.
 *
 * "TODO", "lorem ipsum", "TBD", "example.com/preencher" são o rastro de um
 * rascunho que completou lacuna com placeholder em vez de parar e dizer que
 * faltava evidência.
 */
export function checkNoPlaceholders(changes: readonly DocumentationChange[]): ValidationResult {
	// `ESCREVER` é o marcador que o próprio Writer emite quando não teve evidência
	// suficiente para redigir um trecho. Ele passou despercebido na primeira
	// proposta real do ciclo: a validação aprovou um texto que dizia, nele mesmo,
	// que faltava evidência.
	const markers = /\b(TODO|TBD|FIXME|ESCREVER|lorem ipsum|preencher aqui|XXXX)\b/i;
	const found: string[] = [];

	for (const change of changes) {
		for (const line of addedLines(change.diff)) {
			if (markers.test(line)) found.push(`${change.path}: \`${line.trim().slice(0, 60)}\``);
		}
	}

	return found.length === 0
		? result('linter', true, 'Nenhum marcador de rascunho no texto acrescentado.')
		: result('linter', false, `Texto acrescentado contém marcador de rascunho: ${found.join(' · ')}`);
}

/**
 * Remoção precisa de justificativa proporcional.
 *
 * Apagar um parágrafo certo destrói informação que ninguém percebe que sumiu.
 * Foi assim que o Writer destruiu uma página inteira antes de existir a checagem
 * de remoção de conteúdo — esta validação é a segunda barreira, no candidato.
 */
export function checkRemoval(changes: readonly DocumentationChange[], threshold = 0.5): ValidationResult {
	for (const change of changes) {
		const removed = removedLines(change.diff).length;
		const added = addedLines(change.diff).length;

		if (removed > 10 && added < removed * threshold) {
			return result(
				'health',
				false,
				`${change.path} remove ${removed} linha(s) e acrescenta ${added}. Remoção desse tamanho precisa de revisão humana antes de virar proposta.`
			);
		}
	}

	return result('health', true, 'Nenhuma remoção desproporcional.');
}

export async function validateCandidate(changes: readonly DocumentationChange[]): Promise<ValidationResult[]> {
	const validations: ValidationResult[] = [
		checkMarkdown(changes),
		checkNoPlaceholders(changes),
		checkLinks(changes),
		checkRemoval(changes),
	];

	// Contratos rodam contra o repositório, não contra o diff. O resultado diz
	// isso: ele responde "os contratos estavam quebrados antes desta correção?",
	// que é uma informação útil e diferente de "a correção passou".
	const contracts = await runContractTests().catch(() => null);

	validations.push(
		contracts === null
			? result('contract', null, 'Contract Testing não pôde ser executado; nada foi verificado.')
			: result(
					'contract',
					contracts.counts.invalid === 0,
					contracts.counts.invalid === 0
						? 'Nenhum contrato quebrado no repositório.'
						: `${contracts.counts.invalid} contrato(s) quebrado(s) no repositório — verificado contra a árvore atual, não contra o diff.`
				)
	);

	// Exemplos e avaliação de IA exigiriam aplicar o diff e executar; aqui elas
	// aparecem como não verificadas, em vez de sumirem do relatório.
	validations.push(result('examples', null, 'Exigiria aplicar o diff para executar os exemplos.'));

	return validations;
}
