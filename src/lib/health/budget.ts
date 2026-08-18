/**
 * Error budget documental (§9) e saúde por página (§17).
 *
 * O error budget vem da prática de observabilidade de software, e a tradução para
 * documentação é direta: em vez de "quantos erros o sistema pode dar", é "quantos
 * defeitos a documentação pode ter antes de o compromisso estar quebrado".
 *
 * A diferença que importa em relação a um simples contador: o orçamento mostra
 * **quanto sobrou**, não quanto já se gastou. Uma equipe que vê "3 de 5" decide
 * diferente de uma que vê "40% do orçamento restante" — a segunda leitura torna
 * visível o quanto ainda dá para arriscar.
 */

export interface BudgetLimit {
	/** Nome do que se mede. */
	name: string;
	/** Quantos defeitos deste tipo são tolerados. */
	allowed: number;
	/** Quantos existem agora. */
	used: number;
}

export interface BudgetStatus extends BudgetLimit {
	/** Percentual do orçamento ainda disponível, 0–100. */
	remaining: number;
	exceeded: boolean;
}

/**
 * Orçamento zero é caso legítimo e comum — link quebrado, contrato quebrado.
 *
 * Com `allowed: 0`, qualquer ocorrência estoura, e sem ocorrência o orçamento
 * está inteiro. Tratar isso como divisão por zero e devolver `NaN` faria a barra
 * sumir justamente nos dois indicadores mais rígidos.
 */
export function evaluateBudget(limit: BudgetLimit): BudgetStatus {
	if (limit.allowed <= 0) {
		return {
			...limit,
			remaining: limit.used === 0 ? 100 : 0,
			exceeded: limit.used > 0,
		};
	}

	const remaining = Math.max(0, Math.round(((limit.allowed - limit.used) / limit.allowed) * 100));
	return { ...limit, remaining, exceeded: limit.used > limit.allowed };
}

export function evaluateBudgets(limits: readonly BudgetLimit[]): BudgetStatus[] {
	// Os estourados primeiro: a lista existe para dizer onde mexer.
	return limits
		.map(evaluateBudget)
		.sort((a, b) => Number(b.exceeded) - Number(a.exceeded) || a.remaining - b.remaining);
}

// ---------------------------------------------------------------------------
// Saúde por página (§17)
// ---------------------------------------------------------------------------

export interface PageHealthInput {
	path: string;
	title?: string;
	/** Nota do linter, 0–10. */
	quality?: number;
	/** Trust Score da página, 0–100. */
	trust?: number;
	/** Contratos apontando para a página. */
	contracts?: { valid: number; invalid: number };
	/** Veredito de frescor. */
	staleness?: 'fresh' | 'potentially-stale' | 'stale' | 'unknown';
	/** Defeitos de comportamento na página: link quebrado, teste reprovado. */
	failures?: number;
	/** A página documenta algum endpoint? */
	documentsEndpoints?: number;
}

export interface PageHealth {
	path: string;
	title?: string;
	/** 0–100, ou `null` quando não houve dimensão mensurável. */
	score: number | null;
	dimensions: Array<{ name: string; value: number; basis: string }>;
	/** Dimensões que não puderam ser medidas nesta página, com o motivo. */
	unmeasured: Array<{ name: string; reason: string }>;
}

/**
 * A saúde de uma página.
 *
 * Mesma regra do painel geral: dimensão sem dado fica **fora da média**, e
 * aparece na lista de não medidas com o motivo. Uma página sem proveniência
 * declarada não é uma página sem confiança — é uma página que ninguém anotou, e
 * puni-la faria a nota falar do esforço de anotação em vez da saúde do conteúdo.
 */
export function computePageHealth(input: PageHealthInput): PageHealth {
	const dimensions: PageHealth['dimensions'] = [];
	const unmeasured: PageHealth['unmeasured'] = [];

	if (typeof input.quality === 'number') {
		dimensions.push({
			name: 'Qualidade',
			value: Math.round(input.quality * 10),
			basis: `nota do linter ${input.quality.toFixed(1)}/10`,
		});
	} else {
		unmeasured.push({ name: 'Qualidade', reason: 'o linter não analisou esta página' });
	}

	const contracts = input.contracts;
	if (contracts && contracts.valid + contracts.invalid > 0) {
		const total = contracts.valid + contracts.invalid;
		dimensions.push({
			name: 'Contratos',
			value: Math.round((contracts.valid / total) * 100),
			basis: `${contracts.valid} de ${total} contrato(s) válido(s)`,
		});
	} else {
		unmeasured.push({
			name: 'Contratos',
			reason: input.documentsEndpoints ? 'os endpoints documentados não têm contrato verificável' : 'a página não documenta endpoint',
		});
	}

	if (input.staleness && input.staleness !== 'unknown') {
		const value = input.staleness === 'fresh' ? 100 : input.staleness === 'potentially-stale' ? 60 : 20;
		dimensions.push({ name: 'Frescor', value, basis: `estado: ${input.staleness}` });
	} else {
		unmeasured.push({ name: 'Frescor', reason: 'sem histórico de alteração conhecido' });
	}

	if (typeof input.trust === 'number' && input.trust > 0) {
		dimensions.push({ name: 'Confiança', value: input.trust, basis: `Trust Score ${input.trust}/100` });
	} else {
		unmeasured.push({ name: 'Confiança', reason: 'a página não declara proveniência' });
	}

	if (typeof input.failures === 'number') {
		// Confiabilidade cai rápido: dois defeitos numa página só já a tornam pouco
		// confiável para quem a lê, mesmo que o texto esteja bom.
		dimensions.push({
			name: 'Confiabilidade',
			value: Math.max(0, 100 - input.failures * 34),
			basis: input.failures === 0 ? 'nenhum defeito de comportamento' : `${input.failures} defeito(s)`,
		});
	} else {
		unmeasured.push({ name: 'Confiabilidade', reason: 'os testes não rodaram sobre esta página' });
	}

	return {
		path: input.path,
		title: input.title,
		score:
			dimensions.length === 0
				? null
				: Math.round(dimensions.reduce((sum, dimension) => sum + dimension.value, 0) / dimensions.length),
		dimensions,
		unmeasured,
	};
}
