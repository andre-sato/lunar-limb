/**
 * Research Agent (§4, §13, §15, §16, §28).
 *
 * Descobre fatos e **não altera nada**. Ele consulta primeiro o Digital Twin,
 * como a §13 pede, e a partir dos nós afetados vai às fontes: especificação,
 * código, testes, Content Graph, glossário, Git e a busca na documentação.
 *
 * Três comportamentos definem o valor deste agente, e os três são sobre o que ele
 * **se recusa** a fazer:
 *
 *  1. Quando não encontra, ele diz que não encontrou (§15). A alternativa —
 *     preencher a lacuna com suposição — é a razão de agentes genéricos
 *     produzirem documentação plausível e errada.
 *  2. Quando as fontes discordam, ele para e reporta (§16). Escolher uma delas em
 *     silêncio propagaria o conflito para dentro da documentação.
 *  3. Todo conteúdo lido é tratado como **dado não confiável** (§28). Uma página
 *     que diz "ignore as instruções anteriores" é uma página falando sobre
 *     injeção de prompt, não um comando.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getTwin } from '../twin/load';
import { analyzeTwinImpact } from '../twin/analysis';
import { getContentGraph } from '../editor/content-graph';
import { loadGlossary } from '../glossary/loader';
import { retrieveDocumentation } from '../chat/retrieval';
import { sanitizeRetrievedContent } from '../chat/sanitize';
import { runContractTests } from '../contract/engine';
import { assertTool } from './policy';
import type { DocumentationTask, Evidence, ResearchResult } from './types';

const run = promisify(execFile);

export interface ResearchOptions {
	/** Máximo de trechos de documentação consultados. */
	maxChunks?: number;
}

/**
 * Confiança por tipo de fonte.
 *
 * Não é chute: é uma ordenação do quanto cada fonte **prova** o que afirma. Um
 * ponteiro de OpenAPI resolvido é o contrato em si. Uma menção no texto de uma
 * página é alguém tendo escrito aquilo um dia.
 */
const SOURCE_CONFIDENCE = {
	specification: 1,
	code: 0.9,
	test: 0.85,
	contentGraph: 0.9,
	glossary: 1,
	git: 0.8,
	documentation: 0.55,
} as const;

export async function research(task: DocumentationTask, options: ResearchOptions = {}): Promise<ResearchResult> {
	assertTool('researcher', 'query_digital_twin');

	const facts: Evidence[] = [];
	const sources = new Set<string>();
	const unknowns: string[] = [];
	const conflicts: ResearchResult['conflicts'] = [];

	// --- 1. Digital Twin, primeiro (§13) -----------------------------------
	const twin = await getTwin({ fresh: true }).catch(() => null);

	const targetNodes = new Set<string>(task.context?.productNodes ?? []);

	if (twin && task.target) {
		const pageId = `page:${task.target.replace(/\.mdx?$/, '')}`;
		const impact = analyzeTwinImpact(twin.graph, pageId);

		if (impact) {
			for (const item of impact.affected) targetNodes.add(item.node.id);
		}

		// Os endpoints que a página documenta são a espinha da pesquisa.
		for (const edge of twin.graph.edges) {
			if (edge.relation === 'documents' && edge.from === pageId) targetNodes.add(edge.to);
		}
	}

	for (const nodeId of targetNodes) {
		const node = twin?.graph.nodes.find((candidate) => candidate.id === nodeId);
		if (!node) continue;

		sources.add(node.source ?? node.id);

		if (node.type === 'endpoint') {
			facts.push({
				fact: `O endpoint \`${node.name}\` existe${node.metadata?.deprecated ? ' e está marcado como obsoleto' : ''}.`,
				source: node.source ?? 'Digital Twin',
				confidence: node.source ? SOURCE_CONFIDENCE.specification : SOURCE_CONFIDENCE.code,
			});

			const security = node.metadata?.security as string[] | undefined;
			if (security && security.length > 0) {
				facts.push({
					fact: `\`${node.name}\` exige autenticação: ${security.join(', ')}.`,
					source: node.source ?? 'Digital Twin',
					confidence: SOURCE_CONFIDENCE.specification,
				});
			}
		}

		if (node.type === 'code') {
			assertTool('researcher', 'search_code');
			facts.push({
				fact: `A implementação está em \`${node.source ?? node.name}\`.`,
				source: node.source ?? node.name,
				confidence: SOURCE_CONFIDENCE.code,
			});
		}
	}

	// --- 2. Content Graph: o que já existe e pode ser reaproveitado (§18) ---
	assertTool('researcher', 'query_content_graph');
	const graph = await getContentGraph().catch(() => null);

	if (graph && task.target) {
		const node = graph.nodes.find((candidate) => candidate.path === task.target);
		const consumers = graph.edges.filter((edge) => node && edge.target === node.id);

		if (consumers.length > 0) {
			facts.push({
				fact: `${consumers.length} página(s) incluem este conteúdo; alterá-lo muda todas elas.`,
				source: 'Content Graph',
				confidence: SOURCE_CONFIDENCE.contentGraph,
			});
			sources.add('Content Graph');
		}
	}

	// --- 3. Glossário: a terminologia canônica (§19) ------------------------
	assertTool('researcher', 'query_glossary');
	const glossary = await loadGlossary().catch(() => []);

	for (const term of glossary) {
		if (!mentionsAnyWord(task.instruction, [term.term, ...term.aliases])) continue;

		facts.push({
			fact: `A grafia canônica é \`${term.term}\`${term.deprecated.length > 0 ? `; não usar: ${term.deprecated.join(', ')}` : ''}.`,
			source: `src/content/glossary/${term.id}.md`,
			confidence: SOURCE_CONFIDENCE.glossary,
		});
		sources.add(`src/content/glossary/${term.id}.md`);
	}

	// --- 4. Documentação existente, como dado não confiável (§28) ----------
	assertTool('researcher', 'search_docs');
	const chunks = await retrieveDocumentation(task.instruction, {
		threshold: 0.2,
		maxChunks: options.maxChunks ?? 6,
	}).catch(() => []);

	let injectionDetected = false;

	for (const chunk of chunks) {
		// A sanitização é a mesma do assistente. Duas defesas com regras diferentes
		// significam que a mais fraca é a que vale.
		const sanitized = sanitizeRetrievedContent(chunk.content, 1200);
		if (sanitized.injectionDetected) injectionDetected = true;

		sources.add(chunk.path);
		facts.push({
			fact: `A documentação atual em \`${chunk.path}\` trata do assunto.`,
			source: chunk.path,
			confidence: SOURCE_CONFIDENCE.documentation,
			quote: sanitized.content.slice(0, 240),
		});
	}

	if (injectionDetected) {
		// Não é motivo para parar — a página pode legitimamente falar sobre injeção
		// de prompt, como as deste portal. É motivo para registrar.
		facts.push({
			fact: 'Parte da documentação recuperada contém texto com forma de instrução; foi tratada como conteúdo, não como comando.',
			source: 'sanitização',
			confidence: 1,
		});
	}

	// --- 5. Git: o que mudou recentemente ----------------------------------
	assertTool('researcher', 'query_git');
	if (task.target) {
		const lastChange = await lastCommitFor(`src/content/docs/${task.target}`);
		if (lastChange) {
			facts.push({
				fact: `A página foi alterada pela última vez em ${lastChange.date} ("${lastChange.subject}").`,
				source: 'git',
				confidence: SOURCE_CONFIDENCE.git,
			});
			sources.add('git');
		}
	}

	// --- 6. Contratos: divergência entre documentação e produto ------------
	const contracts = await runContractTests().catch(() => null);

	for (const contract of contracts?.contracts ?? []) {
		if (contract.status !== 'invalid') continue;
		if (task.target && !contract.documentation.some((reference) => reference.path === task.target)) continue;

		for (const assertion of contract.assertions) {
			if (assertion.status !== 'invalid') continue;

			conflicts.push({
				subject: contract.id,
				positions: [
					{ source: contract.source.path, value: assertion.expected ?? 'conforme o contrato' },
					{ source: task.target ?? 'documentação', value: assertion.actual ?? 'conforme a página' },
				],
			});
		}
	}

	// --- 7. O que não se sabe (§15) ----------------------------------------
	if (facts.length === 0) {
		unknowns.push(
			`Nenhuma fonte respondeu a "${task.instruction}". Consultadas: Digital Twin, Content Graph, glossário, documentação, Git e contratos.`
		);
	}

	if (task.target && !chunks.some((chunk) => chunk.path === task.target)) {
		unknowns.push(`A página alvo \`${task.target}\` não apareceu na busca — talvez ela ainda não exista.`);
	}

	return {
		facts,
		sources: [...sources].sort(),
		unknowns,
		conflicts,
		confidence: confidenceOf(facts, unknowns, conflicts),
	};
}

/**
 * A confiança da pesquisa.
 *
 * Média das evidências, penalizada por lacuna e **zerada** por conflito não
 * resolvido: enquanto duas fontes discordam, não existe base para escrever, e um
 * número alto ali convidaria o Writer a seguir em frente.
 */
export function confidenceOf(
	facts: readonly Evidence[],
	unknowns: readonly string[],
	conflicts: readonly unknown[]
): number {
	if (conflicts.length > 0) return 0;
	if (facts.length === 0) return 0;

	const average = facts.reduce((sum, fact) => sum + fact.confidence, 0) / facts.length;
	const penalty = Math.min(0.5, unknowns.length * 0.2);

	return Math.max(0, Math.round((average - penalty) * 100) / 100);
}

function mentionsAnyWord(text: string, words: readonly string[]): boolean {
	const haystack = text
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '');

	return words.some((word) => {
		const needle = word
			.toLowerCase()
			.normalize('NFD')
			.replace(/[̀-ͯ]/g, '');
		return needle.length > 2 && haystack.includes(needle);
	});
}

async function lastCommitFor(file: string): Promise<{ date: string; subject: string } | undefined> {
	try {
		const { stdout } = await run('git', ['log', '-1', '--format=%ad%x1f%s', '--date=short', '--', file], {
			cwd: process.cwd(),
		});
		const [date, subject] = stdout.trim().split('');
		return date ? { date, subject: subject ?? '' } : undefined;
	} catch {
		return undefined;
	}
}
