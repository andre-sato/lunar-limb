/**
 * Detecção de conteúdo obsoleto (§6.4, §7).
 *
 * A regra que a spec deixa explícita, e que a maioria das ferramentas ignora:
 *
 *     A idade sozinha **não** determina que uma página está obsoleta.
 *     Uma página estável pode permanecer válida por anos.
 *
 * Isso não é detalhe. Um portal que marca como obsoleto tudo que passou de 180
 * dias enche a tela de vermelho em conteúdo conceitual perfeitamente correto, e a
 * equipe aprende a ignorar o indicador na primeira semana.
 *
 * O que decide aqui é o **cruzamento**: a idade é apenas um dos sinais, e sozinha
 * nunca leva além de "possivelmente obsoleta". O que empurra para obsoleta de
 * verdade é evidência de divergência — contrato quebrado, proveniência inválida,
 * a API que a página documenta tendo mudado depois da última edição.
 *
 * Função pura: recebe os sinais reunidos e devolve o veredito com o porquê.
 */

export type StalenessStatus = 'fresh' | 'potentially-stale' | 'stale' | 'unknown';

export const STALENESS_LABEL: Record<StalenessStatus, string> = {
	fresh: 'Atual',
	'potentially-stale': 'Possivelmente obsoleta',
	stale: 'Obsoleta',
	unknown: 'Sem informação',
};

export const STALENESS_MARK: Record<StalenessStatus, string> = {
	fresh: '🟢',
	'potentially-stale': '🟡',
	stale: '🔴',
	unknown: '⚪',
};

export interface StalenessInput {
	path: string;
	/** Dias desde a última alteração no Git. `undefined` quando não se sabe. */
	ageDays?: number;
	/** Quantas vezes a API que esta página documenta mudou desde a última edição. */
	productChangesSinceEdit?: number;
	/** Contratos quebrados apontando para esta página. */
	brokenContracts?: number;
	/** Estado da proveniência declarada. */
	trust?: 'verified' | 'stale' | 'unverified' | 'invalid';
	/** Consultas que trouxeram esta página no período — sinal de uso. */
	usage?: number;
	/** Votos negativos recentes. */
	negativeVotes?: number;
}

export interface StalenessVerdict {
	path: string;
	status: StalenessStatus;
	/** Cada sinal que pesou, em uma frase. Sem isso o veredito não se discute. */
	reasons: string[];
	ageDays?: number;
}

/** Faixas de idade usadas no histograma da §6.4. */
export const AGE_BUCKETS = ['<30d', '30-90d', '90-180d', '>180d'] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];

export function bucketFor(ageDays: number | undefined): AgeBucket | 'unknown' {
	if (ageDays === undefined) return 'unknown';
	if (ageDays < 30) return '<30d';
	if (ageDays < 90) return '30-90d';
	if (ageDays < 180) return '90-180d';
	return '>180d';
}

/**
 * O veredito de uma página.
 *
 * Ordem de leitura: primeiro a evidência de divergência, depois a idade. É essa
 * ordem que garante que uma página velha e correta continue verde, e que uma
 * página editada ontem com contrato quebrado apareça vermelha.
 */
export function assessStaleness(input: StalenessInput): StalenessVerdict {
	const reasons: string[] = [];
	let score = 0;

	// --- evidência de divergência (o que realmente indica obsolescência) ---
	if ((input.brokenContracts ?? 0) > 0) {
		score += 3;
		reasons.push(`${input.brokenContracts} contrato(s) de documentação quebrado(s)`);
	}

	if (input.trust === 'invalid') {
		score += 3;
		reasons.push('a evidência declarada não confere mais com a fonte');
	}

	if ((input.productChangesSinceEdit ?? 0) > 0) {
		score += 2;
		reasons.push(`a API que a página documenta mudou ${input.productChangesSinceEdit} vez(es) desde a última edição`);
	}

	if (input.trust === 'stale') {
		score += 1;
		reasons.push('a verificação de proveniência venceu');
	}

	if ((input.negativeVotes ?? 0) >= 3) {
		score += 1;
		reasons.push(`${input.negativeVotes} leitor(es) marcaram a página como não útil`);
	}

	// --- idade, como sinal de apoio -----------------------------------------
	if (input.ageDays === undefined) {
		// Sem histórico de Git não há como falar de idade. Se nada mais pesou, o
		// veredito é "sem informação" — que é diferente de "está bem".
		if (score === 0) return { path: input.path, status: 'unknown', reasons: ['sem histórico de alteração conhecido'] };
	} else if (input.ageDays > 365) {
		score += 1;
		reasons.push(`sem alteração há ${input.ageDays} dias`);
	} else if (input.ageDays > 180) {
		// Idade pura contribui, mas com peso baixo de propósito: uma página
		// conceitual de dois anos pode estar impecável.
		score += 0.5;
		reasons.push(`sem alteração há ${input.ageDays} dias`);
	}

	// Uso alto sem nenhum sinal de divergência é evidência **a favor** da página:
	// muita gente leu e ninguém reclamou.
	if ((input.usage ?? 0) > 10 && score <= 1) {
		score -= 0.5;
		reasons.push('consultada com frequência e sem sinal de divergência');
	}

	const status: StalenessStatus = score >= 3 ? 'stale' : score >= 1 ? 'potentially-stale' : 'fresh';

	return {
		path: input.path,
		status,
		reasons: reasons.length > 0 ? reasons : ['nenhum sinal de divergência'],
		ageDays: input.ageDays,
	};
}

export interface FreshnessSummary {
	/** Distribuição por faixa de idade (§6.4). */
	buckets: Record<AgeBucket | 'unknown', number>;
	fresh: number;
	potentiallyStale: number;
	stale: number;
	unknown: number;
	/** 0–100: a dimensão de frescor do Health Score. */
	score: number;
	/** As piores, para o drill-down (§16). */
	worst: StalenessVerdict[];
}

/**
 * Consolida os vereditos numa dimensão.
 *
 * Página obsoleta não vale nada, possivelmente obsoleta vale metade, e sem
 * informação **fica fora da conta** — a mesma regra do resto do painel: ausência
 * de medida não é nota zero.
 */
export function summarizeFreshness(verdicts: readonly StalenessVerdict[]): FreshnessSummary {
	const buckets: Record<AgeBucket | 'unknown', number> = {
		'<30d': 0,
		'30-90d': 0,
		'90-180d': 0,
		'>180d': 0,
		unknown: 0,
	};

	let fresh = 0;
	let potentiallyStale = 0;
	let stale = 0;
	let unknown = 0;

	for (const verdict of verdicts) {
		buckets[bucketFor(verdict.ageDays)]++;

		if (verdict.status === 'fresh') fresh++;
		else if (verdict.status === 'potentially-stale') potentiallyStale++;
		else if (verdict.status === 'stale') stale++;
		else unknown++;
	}

	const measured = fresh + potentiallyStale + stale;

	return {
		buckets,
		fresh,
		potentiallyStale,
		stale,
		unknown,
		score: measured === 0 ? 0 : Math.round(((fresh + potentiallyStale * 0.5) / measured) * 100),
		worst: [...verdicts]
			.filter((verdict) => verdict.status === 'stale' || verdict.status === 'potentially-stale')
			.sort((a, b) => {
				if (a.status !== b.status) return a.status === 'stale' ? -1 : 1;
				return (b.ageDays ?? 0) - (a.ageDays ?? 0);
			})
			.slice(0, 20),
	};
}
