/**
 * Construção do Knowledge Graph (P3.4).
 *
 * Ele parte do Digital Twin e costura por cima as entidades que o Twin não
 * conhece porque elas não vêm do conteúdo nem do código:
 *
 * - **time**, da governança;
 * - **release**, das tags do Git;
 * - **lacuna**, do Gap Mining;
 * - **contrato**, do Contract Testing.
 *
 * Cada camada é opcional. Quando uma falha, o grafo é montado sem ela e o
 * estado registra a degradação — porque um grafo montado sem a governança
 * responde "ninguém é dono disto" com a mesma confiança de um grafo completo, e
 * essa é a resposta errada mais fácil de acreditar.
 */

import { getTwin } from '../twin/load';
import { collectGovernance } from '../governance/service';
import { releases } from '../history/git';
import { analyzeDocumentationGaps } from '../gaps/service';
import { runContractTests } from '../contract/engine';
import { twinId } from '../twin/types';
import type { GraphStatus, KnowledgeEdge, KnowledgeGraph, KnowledgeNode } from './types';

export const knowledgeId = {
	team: (id: string) => `team:${id}`,
	release: (tag: string) => `release:${tag}`,
	gap: (id: string) => `gap:${id}`,
	contract: (id: string) => `contract:${id}`,
};

export interface BuildResult {
	graph: KnowledgeGraph;
	status: GraphStatus;
}

function counts(graph: KnowledgeGraph): GraphStatus['counts'] {
	const nodes: Record<string, number> = {};
	const edges: Record<string, number> = {};

	for (const node of graph.nodes) nodes[node.type] = (nodes[node.type] ?? 0) + 1;
	for (const edge of graph.edges) edges[edge.relation] = (edges[edge.relation] ?? 0) + 1;

	return { nodes, edges, total: { nodes: graph.nodes.length, edges: graph.edges.length } };
}

export async function buildKnowledgeGraph(options: { fresh?: boolean } = {}): Promise<BuildResult> {
	const degraded: string[] = [];

	const twin = await getTwin({ fresh: options.fresh }).catch(() => null);

	if (!twin) {
		return {
			graph: { nodes: [], edges: [] },
			status: {
				freshness: 'failed',
				builtAt: null,
				ageSeconds: null,
				counts: { nodes: {}, edges: {}, total: { nodes: 0, edges: 0 } },
				degraded: ['Digital Twin'],
				reason: 'O Digital Twin não pôde ser construído; sem ele não há grafo.',
			},
		};
	}

	const nodes: KnowledgeNode[] = twin.graph.nodes.map((node) => ({ ...node }));
	const edges: KnowledgeEdge[] = twin.graph.edges.map((edge) => ({ ...edge }));

	const known = new Set(nodes.map((node) => node.id));
	const addNode = (node: KnowledgeNode) => {
		if (known.has(node.id)) return;
		known.add(node.id);
		nodes.push(node);
	};

	// --- times (Page OWNED_BY Team) ----------------------------------------
	const governance = await collectGovernance().catch(() => null);

	if (governance) {
		for (const page of governance.pages) {
			if (!page.owner) continue;

			const teamNodeId = knowledgeId.team(page.owner.id);
			addNode({ id: teamNodeId, type: 'team', name: page.owner.label ?? page.owner.id });

			const pageNodeId = twinId.page(page.path.replace(/\.mdx?$/, ''));
			// Só liga se a página existe no Twin. Criar o nó aqui inventaria uma
			// página que o Twin não conhece, e o grafo passaria a discordar do
			// repositório — que é exatamente o que ele não pode fazer.
			if (!known.has(pageNodeId)) continue;

			edges.push({
				from: pageNodeId,
				to: teamNodeId,
				relation: 'owned-by',
				origin: page.inherited.owner ? 'derived' : 'declared',
			});
		}
	} else {
		degraded.push('Governança');
	}

	// --- releases (API CHANGED_IN Release) ---------------------------------
	const tags = await releases().catch(() => []);

	for (const release of tags.slice(0, 50)) {
		addNode({
			id: knowledgeId.release(release.tag),
			type: 'release',
			name: release.tag,
			metadata: { date: release.date },
		});
	}

	if (tags.length === 0) degraded.push('Releases (nenhuma tag no repositório)');

	// --- lacunas (Page AFFECTED_BY Gap) ------------------------------------
	const gapReport = await analyzeDocumentationGaps({ limit: 30 }).catch(() => null);

	if (gapReport) {
		for (const gap of gapReport.gaps) {
			const gapNodeId = knowledgeId.gap(gap.id);
			addNode({
				id: gapNodeId,
				type: 'gap',
				name: gap.query,
				metadata: { priority: gap.priority, status: gap.status, coverage: gap.coverage },
			});

			for (const path of gap.relatedContent) {
				const pageNodeId = twinId.page(path.replace(/\.mdx?$/, ''));
				if (!known.has(pageNodeId)) continue;
				edges.push({ from: pageNodeId, to: gapNodeId, relation: 'affected-by', origin: 'derived' });
			}

			// A lacuna também aponta para o que do produto ela toca — é o que
			// permite perguntar "que endpoints têm lacuna aberta?".
			for (const nodeId of gap.relatedProductNodes) {
				if (!known.has(nodeId)) continue;
				edges.push({ from: nodeId, to: gapNodeId, relation: 'affected-by', origin: 'derived' });
			}
		}
	} else {
		degraded.push('Gap Mining');
	}

	// --- contratos (API VALIDATED_BY Contract) -----------------------------
	const contracts = await runContractTests().catch(() => null);

	if (contracts) {
		for (const contract of contracts.contracts) {
			const contractNodeId = knowledgeId.contract(contract.id);
			addNode({
				id: contractNodeId,
				type: 'contract',
				name: contract.id,
				metadata: { status: contract.status },
			});

			const endpointNodeId = twinId.endpoint(contract.id);
			if (known.has(endpointNodeId)) {
				edges.push({ from: endpointNodeId, to: contractNodeId, relation: 'validated-by', origin: 'declared' });
			}

			for (const reference of contract.documentation) {
				const pageNodeId = twinId.page(reference.path.replace(/\.mdx?$/, ''));
				if (!known.has(pageNodeId)) continue;
				edges.push({ from: pageNodeId, to: contractNodeId, relation: 'validated-by', origin: 'declared' });
			}
		}
	} else {
		degraded.push('Contract Testing');
	}

	const graph: KnowledgeGraph = { nodes, edges };
	const builtAt = Date.now();

	return {
		graph,
		status: {
			// Recém construído é `fresh` por definição. `stale` aparece quando o
			// grafo em cache envelhece — ver `service.ts`, que é quem guarda o cache
			// e sabe a idade dele.
			freshness: degraded.length > 0 ? 'stale' : 'fresh',
			builtAt,
			ageSeconds: 0,
			counts: counts(graph),
			degraded,
			reason:
				degraded.length > 0
					? `Montado sem: ${degraded.join(', ')}. As perguntas que dependem dessas camadas não têm resposta confiável nesta construção.`
					: undefined,
		},
	};
}
