/**
 * Lacunas e backlog (§6, §9).
 *
 * O painel de saúde só vale se a diferença entre onde está e onde deveria estar
 * virar fila de trabalho. Aqui os sinais que o portal já coleta — busca sem
 * resposta, voto negativo, endpoint não documentado, página reprovada, evidência
 * inválida, teste falhando — são cruzados e priorizados.
 *
 * A prioridade combina os quatro fatores da spec: frequência, impacto, confiança
 * e qualidade. E cada lacuna leva junto **por que** recebeu a prioridade que
 * recebeu: uma fila que a equipe não consegue conferir é uma fila que ela
 * reordena por conta própria, e aí o cálculo não serviu para nada.
 */

import type { Gap, GapPriority } from './types';

export interface GapInputs {
	/**
	 * Perguntas que a busca não conseguiu responder, já agregadas por texto
	 * normalizado. Vazio quando o registro de perguntas está desligado — que é o
	 * padrão do portal.
	 */
	unanswered?: ReadonlyArray<{ question: string; count: number }>;
	/** Endpoints declarados na especificação e não documentados. */
	undocumentedEndpoints?: readonly string[];
	/** Páginas com maioria de votos negativos, do widget de feedback. */
	negativePages?: ReadonlyArray<{ path: string; down: number; total: number }>;
	/** Páginas reprovadas pelo portão de qualidade. */
	failingPages?: ReadonlyArray<{ path: string; score: number }>;
	/** Páginas com proveniência inválida ou vencida. */
	untrustedPages?: ReadonlyArray<{ path: string; status: 'stale' | 'invalid' }>;
	/** Falhas da Documentation Test Suite. */
	failingTests?: ReadonlyArray<{ id: string; name: string; path?: string }>;
}

const PRIORITY_ORDER: Record<GapPriority, number> = { P0: 0, P1: 1, P2: 2 };

/**
 * Prioridade a partir de pontos.
 *
 * Os limites são propositalmente altos para P0: uma fila em que tudo é P0 é uma
 * fila sem prioridade. P0 exige um sinal forte — muita gente perguntando, ou
 * documentação que está simplesmente errada.
 */
function priorityFrom(points: number): GapPriority {
	if (points >= 8) return 'P0';
	if (points >= 4) return 'P1';
	return 'P2';
}

export function detectGaps(inputs: GapInputs): Gap[] {
	const gaps: Gap[] = [];

	// --- perguntas sem resposta (§6, §7) ---------------------------------
	for (const entry of inputs.unanswered ?? []) {
		// Frequência é o fator dominante aqui: quarenta pessoas perguntando a mesma
		// coisa é o sinal mais direto que existe de documentação faltando.
		const points = Math.min(10, entry.count);
		gaps.push({
			kind: 'unanswered',
			title: `Documentar: "${entry.question}"`,
			detail: `${entry.count} pergunta(s) sem resposta completa na documentação.`,
			priority: priorityFrom(points),
			frequency: entry.count,
			factors: [`frequência ${entry.count}`],
		});
	}

	// --- endpoints não documentados (§6) ---------------------------------
	for (const endpoint of inputs.undocumentedEndpoints ?? []) {
		gaps.push({
			kind: 'undocumented-api',
			title: `Documentar o endpoint \`${endpoint}\``,
			detail: 'Declarado na especificação e sem página que o documente.',
			// Endpoint publicado e não documentado é dívida certa, não hipótese: o
			// contrato existe, alguém vai chamar.
			priority: 'P1',
			frequency: 1,
			target: endpoint,
			factors: ['contrato de API existente', 'sem página correspondente'],
		});
	}

	// --- evidência que não confere (§6) ----------------------------------
	for (const page of inputs.untrustedPages ?? []) {
		const invalid = page.status === 'invalid';
		gaps.push({
			kind: 'untrusted',
			title: invalid ? `Corrigir a evidência de \`${page.path}\`` : `Reverificar \`${page.path}\``,
			detail: invalid
				? 'A fonte citada não confere mais — a página pode estar afirmando algo falso.'
				: 'A verificação passou do prazo de validade.',
			// Evidência inválida é o único sinal aqui que indica documentação
			// possivelmente **errada**, e por isso é o único que entra como P0.
			priority: invalid ? 'P0' : 'P2',
			frequency: 1,
			target: page.path,
			factors: [invalid ? 'evidência inválida' : 'verificação vencida'],
		});
	}

	// --- teste falhando (§6) ---------------------------------------------
	for (const failure of inputs.failingTests ?? []) {
		gaps.push({
			kind: 'failing-test',
			title: `Corrigir ${failure.id}: ${failure.name}`,
			detail: 'A Documentation Test Suite reprovou este item.',
			priority: 'P1',
			frequency: 1,
			target: failure.path,
			factors: ['teste de documentação reprovado'],
		});
	}

	// --- leitores dizendo que não serviu (§6) ----------------------------
	for (const page of inputs.negativePages ?? []) {
		const points = 3 + Math.min(5, page.down);
		gaps.push({
			kind: 'negative-feedback',
			title: `Revisar \`${page.path}\``,
			detail: `${page.down} de ${page.total} leitor(es) marcaram a página como não útil.`,
			priority: priorityFrom(points),
			frequency: page.down,
			target: page.path,
			factors: [`${page.down} voto(s) negativo(s)`],
		});
	}

	// --- páginas reprovadas pelo portão ----------------------------------
	for (const page of inputs.failingPages ?? []) {
		gaps.push({
			kind: 'low-quality',
			title: `Melhorar \`${page.path}\``,
			detail: `Nota ${page.score.toFixed(1)}/10, abaixo do mínimo do portão de qualidade.`,
			// Nota baixa é problema de escrita, não de correção: entra por último,
			// porque uma página malescrita e correta ainda ajuda quem a lê.
			priority: 'P2',
			frequency: 1,
			target: page.path,
			factors: [`nota ${page.score.toFixed(1)}`],
		});
	}

	return gaps.sort(
		(a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || b.frequency - a.frequency
	);
}

export interface Backlog {
	P0: Gap[];
	P1: Gap[];
	P2: Gap[];
}

export function buildBacklog(gaps: readonly Gap[]): Backlog {
	return {
		P0: gaps.filter((gap) => gap.priority === 'P0'),
		P1: gaps.filter((gap) => gap.priority === 'P1'),
		P2: gaps.filter((gap) => gap.priority === 'P2'),
	};
}

/**
 * Texto do alerta (§10).
 *
 * Um alerta precisa dizer o que quebrou, quanto, e o que fazer. "SLO violado"
 * sozinho é uma notificação que a equipe aprende a arquivar sem ler.
 */
export function composeAlert(input: {
	breached: ReadonlyArray<{ dimension: string; current: number; target: number }>;
	topGaps: readonly Gap[];
}): string {
	if (input.breached.length === 0) return '';

	const lines = ['🚨 SLO de documentação violado', ''];

	for (const item of input.breached) {
		lines.push(`- ${item.dimension}: ${item.current}% (alvo ${item.target}%)`);
	}

	if (input.topGaps.length > 0) {
		lines.push('', 'O que fazer primeiro:', '');
		for (const gap of input.topGaps.slice(0, 5)) {
			lines.push(`- [${gap.priority}] ${gap.title} — ${gap.detail}`);
		}
	}

	return lines.join('\n');
}
