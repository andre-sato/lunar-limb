/**
 * Classificação, checklist e score (§5, §9, §10, §11, §12).
 *
 * Aqui mora o julgamento do motor: dado o que mudou e quem depende do que mudou,
 * o que é urgente, o que é revisão e o que é ruído. Tudo puro — o mesmo par de
 * entradas sempre produz o mesmo relatório, e é isso que permite testar as regras
 * de classificação sem repositório, sem Git e sem API.
 */

import type { ApiChange } from './api-diff';
import { dependentsOf, glossaryId, nodeById, pageId, snippetId } from './graph';
import {
	countBySeverity,
	highestSeverity,
	SEVERITY_ORDER,
	type Change,
	type ChecklistItem,
	type ImpactGraph,
	type ImpactItem,
	type ImpactNode,
	type ImpactReport,
	type ImpactScore,
	type ImpactSeverity,
	type ReviewScope,
} from './types';

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

export interface AnalyzeInput {
	graph: ImpactGraph;
	changes: readonly Change[];
	/** Mudanças de API já apuradas pelo `api-diff`. */
	apiChanges?: readonly ApiChange[];
	/** Termos do glossário cujo texto canônico, alias ou definição mudou. */
	glossaryChanges?: ReadonlyArray<{ id: string; term: string; renamed: boolean; removed: boolean }>;
	/** Versões que a mudança atinge, quando o registro de versões mudou. */
	versionChanges?: ReadonlyArray<{ version: string; lifecycle: string }>;
}

// ---------------------------------------------------------------------------
// Severidade (§5)
// ---------------------------------------------------------------------------

/**
 * A severidade de quem **depende** de algo que mudou.
 *
 * Duas coisas a compõem: a gravidade na origem e a distância. Um consumidor
 * direto de um endpoint removido tem documentação provavelmente falsa — crítico.
 * O mesmo endpoint, três saltos de inclusão adiante, provavelmente só menciona o
 * assunto de passagem. Diminuir com a distância é o que evita o relatório onde
 * tudo é vermelho e ninguém olha.
 */
export function severityForDependent(origin: ImpactSeverity, distance: number): ImpactSeverity {
	const levels: ImpactSeverity[] = ['critical', 'high', 'medium', 'low'];
	const index = Math.min(levels.length - 1, SEVERITY_ORDER[origin] + Math.max(0, distance - 1));
	return levels[index];
}

function unknownNode(id: string): ImpactNode {
	const [type, ...rest] = id.split(':');
	return { id, type: (type as ImpactNode['type']) ?? 'page', path: rest.join(':') };
}

function addItems(
	items: ImpactItem[],
	graph: ImpactGraph,
	targetId: string,
	origin: string,
	originSeverity: ImpactSeverity,
	reason: (node: ImpactNode, distance: number) => string,
	editedPaths: ReadonlySet<string>
): void {
	for (const dependent of dependentsOf(graph, targetId)) {
		const node = nodeById(graph, dependent.id) ?? unknownNode(dependent.id);
		// Só página é destino de revisão humana: um bloco reutilizável no meio do
		// caminho é rota, não item de checklist. Ele aparece no `via`.
		if (node.type !== 'page') continue;

		const distance = dependent.via.length - 1;
		items.push({
			node,
			severity: severityForDependent(originSeverity, distance),
			reason: reason(node, distance),
			origin,
			via: dependent.via,
			// Página já editada aparece no diff; o valor do relatório está em
			// apontar o que mudou **sem** aparecer nele.
			hidden: !editedPaths.has(node.path),
		});
	}
}

/** Um item por página, mantendo a severidade mais alta e o caminho mais curto. */
function dedupe(items: readonly ImpactItem[]): ImpactItem[] {
	const best = new Map<string, ImpactItem>();

	for (const item of items) {
		const current = best.get(item.node.id);
		if (!current) {
			best.set(item.node.id, item);
			continue;
		}

		const moreSevere = SEVERITY_ORDER[item.severity] < SEVERITY_ORDER[current.severity];
		const sameButShorter = item.severity === current.severity && item.via.length < current.via.length;
		if (moreSevere || sameButShorter) best.set(item.node.id, item);
	}

	return [...best.values()].sort(
		(a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.node.path.localeCompare(b.node.path)
	);
}

// ---------------------------------------------------------------------------
// Análise
// ---------------------------------------------------------------------------

export function analyzeImpact(input: AnalyzeInput): ImpactReport {
	const { graph, changes } = input;
	const raw: ImpactItem[] = [];
	const editedPaths = new Set(changes.map((change) => change.path));

	// --- Bloco reutilizável alterado (§7) ---------------------------------
	for (const change of changes) {
		if (change.kind !== 'snippet') continue;

		const id = change.path.replace(/^src\/content\/snippets\//, '').replace(/\.mdx?$/, '');
		// Bloco removido invalida quem o inclui: a página deixa de renderizar o
		// trecho. Editado, muda o texto publicado sem passar por revisão.
		const severity: ImpactSeverity = change.status === 'removed' ? 'critical' : 'high';

		addItems(
			raw,
			graph,
			snippetId(id),
			change.path,
			severity,
			(_, distance) =>
				change.status === 'removed'
					? `inclui o bloco \`${id}\`, que foi removido.`
					: distance === 1
						? `inclui o bloco \`${id}\`, que foi alterado.`
						: `inclui, por ${distance} níveis, o bloco \`${id}\`, que foi alterado.`,
			editedPaths
		);
	}

	// --- Página alterada: quem a inclui (§7) ------------------------------
	for (const change of changes) {
		if (change.kind !== 'page') continue;

		const relative = change.path.replace(/^src\/content\/docs\//, '');
		addItems(
			raw,
			graph,
			pageId(relative),
			change.path,
			change.status === 'removed' ? 'critical' : 'medium',
			() =>
				change.status === 'removed'
					? `inclui \`${relative}\`, que foi removida.`
					: `inclui \`${relative}\`, que foi alterada.`,
			editedPaths
		);
	}

	// --- API (§6) ---------------------------------------------------------
	const apiChanges = input.apiChanges ?? [];
	for (const change of apiChanges) {
		if (!/^[A-Z]+ \//.test(change.subject)) continue;

		const severity: ImpactSeverity =
			change.type === 'operation-removed' ? 'critical' : change.breaking ? 'high' : 'medium';

		addItems(
			raw,
			graph,
			`api:${change.subject}`,
			change.subject,
			severity,
			() => `documenta \`${change.subject}\`: ${change.message}`,
			editedPaths
		);
	}

	// --- Glossário (§8) ---------------------------------------------------
	const glossaryChanges = input.glossaryChanges ?? [];
	for (const term of glossaryChanges) {
		addItems(
			raw,
			graph,
			glossaryId(term.id),
			`src/content/glossary/${term.id}.md`,
			// Termo removido deixa o destaque e o tooltip sem destino; renomeado
			// deixa a página escrevendo a grafia antiga. Mudar só a definição é
			// menos grave: o texto da página continua correto.
			term.removed ? 'high' : term.renamed ? 'medium' : 'low',
			() =>
				term.removed
					? `menciona \`${term.term}\`, termo removido do glossário.`
					: term.renamed
						? `menciona \`${term.term}\`, cuja grafia canônica mudou.`
						: `menciona \`${term.term}\`, cuja definição mudou.`,
			editedPaths
		);
	}

	const items = dedupe(raw);

	const api = {
		breaking: apiChanges.filter((change) => change.breaking).map((change) => `${change.subject}: ${change.message}`),
		compatible: apiChanges.filter((change) => !change.breaking).map((change) => `${change.subject}: ${change.message}`),
	};

	const score = scoreImpact({ changes, items, apiChanges, glossaryChanges, versionChanges: input.versionChanges });

	return {
		changes: [...changes],
		items,
		checklist: buildChecklist({ changes, items, apiChanges, glossaryChanges }),
		score,
		scope: scopeFor(score.value, items.length),
		api,
		glossaryTerms: glossaryChanges.map((term) => term.term),
		counts: countBySeverity(items),
		highest: highestSeverity(items),
		generatedAt: Date.now(),
	};
}

// ---------------------------------------------------------------------------
// Score (§12)
// ---------------------------------------------------------------------------

/**
 * Um número de 0 a 100 dizendo quanta atenção a mudança pede.
 *
 * Cada fator vem acompanhado dos pontos que somou e do motivo. Um score sem
 * decomposição não se audita, e um número que ninguém consegue conferir é
 * exatamente o tipo de métrica que a equipe passa a ignorar depois da terceira
 * vez que ele discorda da intuição.
 */
export function scoreImpact(input: {
	changes: readonly Change[];
	items: readonly ImpactItem[];
	apiChanges?: readonly ApiChange[];
	glossaryChanges?: ReadonlyArray<{ id: string }>;
	versionChanges?: ReadonlyArray<{ version: string; lifecycle: string }>;
}): ImpactScore {
	const factors: ImpactScore['factors'] = [];
	const counts = countBySeverity(input.items);

	// Sem consequência apurada, o score é zero — inclusive o fator de tamanho.
	// Um PR que mexe só em `astro.config.mjs` pontuando por "tamanho da mudança"
	// diria que há algo a revisar na documentação quando não há, e é assim que um
	// indicador deixa de ser lido.
	const hasConsequence =
		input.items.length > 0 || (input.apiChanges ?? []).length > 0 || (input.glossaryChanges ?? []).length > 0;
	if (!hasConsequence) return { value: 0, factors: [] };

	const push = (name: string, points: number, detail: string) => {
		if (points > 0) factors.push({ name, points, detail });
	};

	// Criticidade domina: é a diferença entre "revise" e "a página está errada".
	push('Itens críticos', Math.min(40, counts.critical * 20), `${counts.critical} item(ns) crítico(s)`);
	push('Itens de alto impacto', Math.min(20, counts.high * 5), `${counts.high} item(ns) de impacto alto`);
	push('Itens médios', Math.min(10, counts.medium * 2), `${counts.medium} item(ns) de impacto médio`);

	const breaking = (input.apiChanges ?? []).filter((change) => change.breaking).length;
	push('Quebra de contrato de API', Math.min(25, breaking * 12), `${breaking} mudança(s) incompatível(is)`);

	const consumers = input.items.length;
	push('Consumidores atingidos', Math.min(15, Math.round(consumers * 1.5)), `${consumers} página(s) afetada(s)`);

	const indirect = input.items.filter((item) => item.via.length > 2).length;
	push('Dependências indiretas', Math.min(10, indirect * 3), `${indirect} por dependência indireta`);

	const terms = (input.glossaryChanges ?? []).length;
	push('Terminologia', Math.min(8, terms * 4), `${terms} termo(s) de glossário`);

	const versions = (input.versionChanges ?? []).length;
	push('Versões atingidas', Math.min(8, versions * 4), `${versions} versão(ões)`);

	const files = input.changes.length;
	push('Tamanho da mudança', Math.min(8, Math.round(files / 2)), `${files} arquivo(s) alterado(s)`);

	const total = factors.reduce((sum, factor) => sum + factor.points, 0);
	return { value: Math.min(100, total), factors };
}

export function scopeFor(score: number, itemCount: number): ReviewScope {
	if (score >= 60 || itemCount >= 15) return 'large';
	if (score >= 30 || itemCount >= 6) return 'medium';
	if (score > 0 || itemCount > 0) return 'small';
	return 'trivial';
}

// ---------------------------------------------------------------------------
// Checklist (§11)
// ---------------------------------------------------------------------------

/**
 * Checklist de revisão.
 *
 * Só entra o que dá para conferir: uma página, uma operação, um termo. "Revisar a
 * documentação" não é item de checklist — é o nome do trabalho, e um item que não
 * se consegue marcar como feito treina a equipe a marcar tudo sem ler.
 */
export function buildChecklist(input: {
	changes: readonly Change[];
	items: readonly ImpactItem[];
	apiChanges?: readonly ApiChange[];
	glossaryChanges?: ReadonlyArray<{ id: string; term: string }>;
}): ChecklistItem[] {
	const checklist: ChecklistItem[] = [];

	// Do mais grave para o menos: a ordem do checklist é a ordem da revisão.
	for (const item of input.items) {
		if (item.severity === 'low') continue;
		checklist.push({
			label: `Revisar \`${item.node.path}\` — ${item.reason}`,
			severity: item.severity,
			target: item.node.path,
		});
	}

	const breaking = (input.apiChanges ?? []).filter((change) => change.breaking);
	if (breaking.length > 0) {
		checklist.push({
			label: `Conferir ${breaking.length} mudança(s) incompatível(is) de API contra a referência publicada`,
			severity: 'critical',
		});
		checklist.push({
			label: 'Rodar os testes de documentação no perfil `standard` (exemplos contra o schema)',
			severity: 'high',
		});
	}

	for (const term of input.glossaryChanges ?? []) {
		checklist.push({
			label: `Conferir o termo \`${term.term}\` no glossário e as ocorrências nas páginas`,
			severity: 'medium',
			target: `src/content/glossary/${term.id}.md`,
		});
	}

	if (input.changes.some((change) => change.kind === 'version')) {
		checklist.push({ label: 'Conferir o registro de versões e os avisos de ciclo de vida', severity: 'medium', target: 'versions.yml' });
	}

	return checklist;
}
