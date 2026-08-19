/**
 * Do impacto para o Agent Orchestrator (P2.2 — § Integração).
 *
 * O ciclo que a spec descreve termina aqui: mudança de código → impacto → tarefa
 * de documentação. Este arquivo **propõe** a tarefa; ele não a executa e não
 * escreve nada. Fechar o ciclo até a publicação automática seria trocar o
 * guardrail que atravessa a camada de agentes — nada publicado sem aprovação
 * humana — por conveniência.
 */

import type { DocumentationTask } from '../agents/types';
import type { DocumentationImpact } from './types';

export interface TaskProposal extends DocumentationTask {
	/** Por que esta tarefa foi proposta, em uma frase legível. */
	rationale: string;
	/** Ordem de atendimento: entidade obrigatória sem página vem antes. */
	priority: 'alta' | 'média';
}

/**
 * As tarefas que este impacto justifica.
 *
 * Duas situações produzem tarefas diferentes, e confundi-las produziria trabalho
 * errado: entidade **sem página nenhuma** precisa de uma página nova; entidade
 * com página que ficou para trás precisa de atualização daquela página. A
 * segunda nunca vira `create` — criar uma segunda página para o mesmo endpoint é
 * como um portal ganha duas respostas para a mesma pergunta.
 */
export function tasksFromImpact(impact: DocumentationImpact, requiredTypes: readonly string[] = []): TaskProposal[] {
	const proposals: TaskProposal[] = [];

	for (const entity of impact.missingDocumentation) {
		proposals.push({
			id: `codeloop:create:${entity.entityId}`,
			type: 'create',
			instruction:
				`Documentar \`${entity.entityId}\` (${entity.detail}). Descrever o contrato — parâmetros, respostas e ` +
				'autenticação — a partir da especificação, e declarar o vínculo no frontmatter da página.',
			context: { productNodes: [entity.entityId] },
			rationale: `A mudança alterou \`${entity.entityId}\` e nenhuma página declara documentá-lo.`,
			priority: requiredTypes.includes(entity.entityType) ? 'alta' : 'média',
		});
	}

	for (const page of impact.affectedPages.filter((entry) => entry.stale)) {
		proposals.push({
			id: `codeloop:update:${page.path}`,
			type: 'update',
			target: page.path,
			instruction:
				`Revisar \`${page.path}\`: ${page.entities.join(', ')} mudou e a página não foi atualizada no mesmo conjunto. ` +
				'Verificar o que a especificação diz hoje e corrigir só o que divergir.',
			context: { productNodes: page.entities },
			// A tarefa restringe o Writer à própria página. O teto da política
			// continua valendo por cima disto — a restrição aqui é adicional, nunca
			// uma ampliação.
			constraints: { allowedPaths: [page.path] },
			rationale: `\`${page.path}\` documenta ${page.entities.join(', ')}, que mudou nesta branch.`,
			priority: 'alta',
		});
	}

	return proposals;
}
