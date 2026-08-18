/**
 * Classificação, score e recomendação (§5, §9, §10, §14, §15, §18, §25, §26).
 *
 * Puro: recebe os sinais já reunidos e devolve os gaps. É onde mora o julgamento
 * da camada — que tipo de lacuna é, quanto ela vale, e o que fazer a respeito.
 */

import {
	ACTION_LABEL,
	EMPTY_EVIDENCE,
	priorityFor,
	type DocumentationGap,
	type GapCategory,
	type GapEvidence,
	type GapRecommendation,
	type GapScore,
	type PriorityThresholds,
	type RecommendedAction,
} from './types';
import type { QueryCluster } from './cluster';

export interface RetrievedPage {
	path: string;
	title?: string;
	/** Relevância da página para o agrupamento, 0–1. */
	relevance: number;
	/**
	 * Quantos dos termos distintivos da pergunta aparecem nesta página, 0–1.
	 *
	 * É o que mede cobertura de verdade. A relevância da busca **não serve**: o
	 * BM25 normaliza pelo melhor resultado, então o primeiro colocado marca perto
	 * de 1 mesmo quando o portal não tem nada sobre o assunto — e a primeira
	 * execução real desta camada classificou "como rotacionar a chave de API",
	 * que não existe em lugar nenhum, como "difícil de achar" com 100% de
	 * cobertura.
	 */
	termCoverage?: number;
	/** Estado de verificação, da camada de confiança. */
	trust?: 'verified' | 'stale' | 'unverified' | 'invalid';
	/** Votos negativos recentes. */
	negativeVotes?: number;
	/** Contratos quebrados apontando para esta página. */
	brokenContracts?: number;
}

export interface ClusterAnalysis {
	cluster: QueryCluster;
	/** Páginas que a busca encontra para esta pergunta. */
	pages: RetrievedPage[];
	/** Sinais do assistente e do MCP para este agrupamento. */
	aiQuestions?: number;
	aiFailures?: number;
	mcpQueries?: number;
	/** Nós do produto ligados ao assunto (§24). */
	productNodes?: string[];
	/** `true` quando duas páginas relevantes se contradizem (§5.6). */
	contradiction?: { pages: string[]; detail: string };
	/** Termos do glossário com grafias concorrentes nas perguntas (§26). */
	terminology?: { term: string; variants: string[] };
}

// ---------------------------------------------------------------------------
// Cobertura do assunto (§14)
// ---------------------------------------------------------------------------

/**
 * Quanto o conteúdo existente cobre o assunto.
 *
 * A medida principal é a **presença dos termos** da pergunta nas páginas
 * encontradas, não a relevância devolvida pela busca. A relevância é normalizada
 * pelo melhor resultado, então o primeiro colocado marca perto de 1 mesmo quando
 * não há nada sobre o assunto: a busca sempre devolve *algo*.
 *
 * A relevância entra como um tempero pequeno, e o número de páginas como outro —
 * uma página que fala do tema cobre mais que três que o tangenciam.
 */
export function estimateCoverage(pages: readonly RetrievedPage[]): number {
	if (pages.length === 0) return 0;

	const best = Math.max(...pages.map((page) => page.termCoverage ?? 0));
	if (best === 0) {
		// Nenhum termo da pergunta aparece nas páginas: a busca devolveu resultado
		// porque sempre devolve, e não porque o assunto está documentado.
		return 0;
	}

	const relevance = Math.max(...pages.map((page) => page.relevance));
	const support = Math.min(1, pages.length / 3);

	return Math.round(100 * (best * 0.7 + relevance * 0.15 + support * 0.15));
}

// ---------------------------------------------------------------------------
// Categoria (§5)
// ---------------------------------------------------------------------------

/**
 * Que tipo de lacuna é.
 *
 * A ordem das perguntas é a ordem da gravidade, e cada ramo corresponde a uma
 * ação diferente — que é a razão de a spec pedir seis tipos em vez de um contador
 * de "faltando".
 */
export function classifyGap(analysis: ClusterAnalysis): GapCategory {
	if (analysis.contradiction) return 'contradictory';

	const coverage = estimateCoverage(analysis.pages);

	// Nada relevante: não há o que consertar, há o que escrever.
	if (analysis.pages.length === 0 || coverage < 25) return 'missing';

	// O conteúdo diverge do produto — quem disse isso foi o Twin ou o Contract.
	if (analysis.pages.some((page) => page.trust === 'invalid' || (page.brokenContracts ?? 0) > 0)) return 'outdated';
	if (analysis.pages.some((page) => page.trust === 'stale') && coverage < 70) return 'outdated';

	if (analysis.terminology) return 'unclear';

	// A informação existe e as pessoas continuam perguntando. Duas causas
	// diferentes, e a distinção decide a ação: se a página é muito relevante, ela
	// está lá e ninguém acha (navegação); se é meio relevante, ela não responde
	// por inteiro (conteúdo).
	if (coverage >= 80) return 'hard-to-find';

	return 'incomplete';
}

// ---------------------------------------------------------------------------
// Score (§10, §25)
// ---------------------------------------------------------------------------

export function scoreGap(evidence: GapEvidence, coverage: number, category: GapCategory): GapScore {
	const factors: GapScore['factors'] = [];

	const push = (name: string, points: number, detail: string) => {
		if (points > 0) factors.push({ name, points, detail: detail });
	};

	// Demanda: o sinal mais direto de que falta documentação é gente procurando.
	const demand = evidence.searches + evidence.aiQuestions + evidence.mcpQueries;
	push('Demanda', Math.min(35, Math.round(demand * 1.2)), `${demand} consulta(s)`);

	// Falha do assistente pesa mais que a consulta em si: alguém procurou **e**
	// não recebeu resposta com fundamento.
	push('Falha do assistente', Math.min(25, evidence.aiFailures * 3), `${evidence.aiFailures} resposta(s) sem lastro`);

	// Cobertura entra invertida: quanto menos existe, maior o gap.
	push('Cobertura baixa', Math.round((100 - coverage) * 0.2), `cobertura estimada de ${coverage}%`);

	push('Insatisfação', Math.min(10, evidence.negativeFeedback * 2), `${evidence.negativeFeedback} voto(s) negativo(s)`);

	// Contrato quebrado (§25): documentação que diverge do produto é pior que
	// documentação ausente — ela leva a pessoa a fazer a coisa errada com
	// confiança.
	push('Contrato quebrado', Math.min(20, evidence.brokenContracts * 20), `${evidence.brokenContracts} contrato(s)`);

	if (category === 'contradictory') push('Contradição', 15, 'duas fontes discordam');
	if (category === 'outdated') push('Divergência com o produto', 10, 'conteúdo desatualizado');

	const total = factors.reduce((sum, factor) => sum + factor.points, 0);
	return { value: Math.min(100, total), factors };
}

// ---------------------------------------------------------------------------
// Recomendação (§18)
// ---------------------------------------------------------------------------

function slugify(text: string): string {
	return text
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 60);
}

export function recommendFor(analysis: ClusterAnalysis, category: GapCategory): GapRecommendation {
	const best = [...analysis.pages].sort((a, b) => b.relevance - a.relevance)[0];

	if (category === 'missing') {
		const action: RecommendedAction = (analysis.productNodes ?? []).some((node) => node.startsWith('endpoint:'))
			? 'add-api-reference'
			: 'create-page';

		return {
			action,
			target: `src/content/docs/guides/${slugify(analysis.cluster.representative)}.md`,
			// Um roteiro genérico é melhor que nenhum e pior que um específico. Este
			// sai da própria pergunta, e serve de ponto de partida para quem escreve.
			outline: ['Quando isto é necessário', 'Passo a passo', 'Exemplo', 'Como verificar', 'Erros comuns'],
			reason:
				action === 'add-api-reference'
					? 'A pergunta é sobre um endpoint que já existe no produto e não tem página.'
					: 'Nenhuma página existente responde ao assunto.',
		};
	}

	if (category === 'contradictory') {
		return {
			action: 'update-page',
			target: analysis.contradiction?.pages[0],
			outline: ['Confirmar o valor correto no produto', 'Corrigir a página divergente', 'Anotar a proveniência'],
			reason: analysis.contradiction?.detail ?? 'Duas páginas afirmam coisas diferentes.',
		};
	}

	if (category === 'outdated') {
		return {
			action: 'update-outdated',
			target: best?.path,
			outline: ['Conferir o contrato atual', 'Atualizar exemplos', 'Reverificar a proveniência'],
			reason: 'O conteúdo diverge do produto segundo o Digital Twin ou os testes de contrato.',
		};
	}

	if (category === 'unclear') {
		return {
			action: 'fix-terminology',
			target: best?.path,
			outline: [
				`Padronizar o termo \`${analysis.terminology?.term ?? ''}\` conforme o glossário`,
				'Acrescentar os sinônimos como aliases',
				'Revisar as ocorrências nas páginas',
			],
			reason: `As perguntas usam ${analysis.terminology?.variants.length ?? 0} grafias para o mesmo conceito.`,
		};
	}

	if (category === 'hard-to-find') {
		return {
			action: 'fix-navigation',
			target: best?.path,
			outline: ['Rever o título e a descrição', 'Acrescentar links das páginas de entrada', 'Rever as tags'],
			reason: 'A página responde à pergunta e as pessoas continuam procurando.',
		};
	}

	return {
		action: 'add-example',
		target: best?.path,
		outline: ['Acrescentar a seção que falta', 'Incluir exemplo completo', 'Ligar às páginas relacionadas'],
		reason: 'A página existente cobre o assunto em parte.',
	};
}

// ---------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------

export interface AnalyzeGapsInput {
	analyses: readonly ClusterAnalysis[];
	thresholds?: PriorityThresholds;
	now?: () => string;
}

export function analyzeGaps(input: AnalyzeGapsInput): DocumentationGap[] {
	const now = input.now ?? (() => new Date().toISOString());

	return input.analyses
		.map((analysis) => {
			const coverage = estimateCoverage(analysis.pages);
			const category = classifyGap(analysis);

			const evidence: GapEvidence = {
				...EMPTY_EVIDENCE,
				searches: analysis.cluster.count,
				aiQuestions: analysis.aiQuestions ?? 0,
				aiFailures: analysis.aiFailures ?? 0,
				mcpQueries: analysis.mcpQueries ?? 0,
				negativeFeedback: analysis.pages.reduce((sum, page) => sum + (page.negativeVotes ?? 0), 0),
				brokenContracts: analysis.pages.reduce((sum, page) => sum + (page.brokenContracts ?? 0), 0),
			};

			const score = scoreGap(evidence, coverage, category);
			const timestamp = now();

			return {
				id: slugify(analysis.cluster.representative) || 'gap',
				query: analysis.cluster.representative,
				variants: analysis.cluster.variants,
				category,
				frequency: analysis.cluster.count,
				evidence,
				score,
				priority: priorityFor(score.value, input.thresholds),
				status: 'new' as const,
				relatedContent: analysis.pages.map((page) => page.path),
				relatedProductNodes: analysis.productNodes ?? [],
				coverage,
				recommendation: recommendFor(analysis, category),
				createdAt: timestamp,
				updatedAt: timestamp,
			};
		})
		.sort((a, b) => b.score.value - a.score.value || a.query.localeCompare(b.query));
}

// ---------------------------------------------------------------------------
// Resolução (§21)
// ---------------------------------------------------------------------------

export interface ResolutionCheck {
	resolved: boolean;
	reason: string;
	before: { searches: number; aiFailures: number };
	after: { searches: number; aiFailures: number };
}

/**
 * O gap sumiu de verdade?
 *
 * Esta função existe por causa da frase mais importante da spec: **o sistema não
 * deve considerar um gap resolvido simplesmente porque alguém criou uma página**.
 * Publicar não é resolver. O que resolve é o sinal cair — menos gente procurando,
 * menos resposta sem lastro.
 *
 * A queda exigida é de dois terços, e não de 100%: uma pergunta continua sendo
 * feita mesmo quando a resposta existe, e esperar zero manteria todo gap aberto
 * para sempre.
 */
export function checkResolution(
	baseline: { searches: number; aiFailures: number },
	current: { searches: number; aiFailures: number }
): ResolutionCheck {
	const drop = (before: number, after: number) => (before === 0 ? 1 : 1 - after / before);

	const searchDrop = drop(baseline.searches, current.searches);
	const failureDrop = drop(baseline.aiFailures, current.aiFailures);

	const resolved = searchDrop >= 0.66 && failureDrop >= 0.66;

	return {
		resolved,
		reason: resolved
			? `As consultas caíram ${Math.round(searchDrop * 100)}% e as respostas sem lastro, ${Math.round(failureDrop * 100)}%.`
			: `As consultas caíram ${Math.round(searchDrop * 100)}% e as respostas sem lastro, ${Math.round(failureDrop * 100)}% — ainda não é queda suficiente para considerar resolvido.`,
		before: baseline,
		after: current,
	};
}

export { ACTION_LABEL };
